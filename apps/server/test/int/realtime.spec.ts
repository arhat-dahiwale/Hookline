import { randomUUID } from 'node:crypto';

import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiKeysService } from '../../src/modules/api-keys/index.js';
import { tenantScope } from '../../src/modules/platform/database/tenant-scope.js';
import { AuthService, type OrgRole } from '../../src/modules/auth/index.js';
import { RealtimeService, type WsEnvelope } from '../../src/modules/realtime/index.js';
import { CookieJar, createTestApplication, listen, type TestApplication } from './test-app.js';
import { TestReceiver } from './support/test-receiver.js';

const TIMEOUT = 15_000;

let api: TestApplication;
let worker: TestApplication;
let receiver: TestReceiver;
let baseUrl: string;
let wsUrl: string;

interface Session {
  jar: CookieJar;
  organizationId: string;
  role: OrgRole;
}

beforeAll(async () => {
  // api + worker as separate "instances" over shared PG/Redis: the exact
  // production split the fan-out must survive.
  api = await createTestApplication([], { ALLOW_INSECURE_ENDPOINTS: 'true' }, 'api');
  worker = await createTestApplication([], { ALLOW_INSECURE_ENDPOINTS: 'true' }, 'worker');
  receiver = new TestReceiver();
  await receiver.start();
  baseUrl = await listen(api);
  wsUrl = baseUrl.replace('http://', 'ws://') + '/ws';
});

afterAll(async () => {
  await api.app.close();
  await worker.app.close();
  await receiver.stop().catch(() => undefined);
});

function uniqueEmail(): string {
  return `user-${randomUUID()}@example.test`;
}

async function call(
  jar: CookieJar,
  method: string,
  url: string,
  payload?: unknown,
): Promise<{
  statusCode: number;
  json: () => Record<string, unknown>;
  headers: Record<string, unknown>;
}> {
  const cookie = jar.header();
  const response = await api.instance.inject({
    method,
    url,
    ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
    headers: {
      ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
  });
  jar.capture(response);
  return response as never;
}

async function makeSession(orgId?: string, role?: OrgRole): Promise<Session> {
  const jar = new CookieJar();
  const signUp = await call(jar, 'POST', '/api/auth/sign-up/email', {
    email: uniqueEmail(),
    password: 'password-123456',
    name: 'Ws Tester',
  });
  expect(signUp.statusCode).toBeLessThan(300);
  const me = (await call(jar, 'GET', '/api/auth/get-session')).json() as { user: { id: string } };
  const userId = me.user.id as string;
  if (orgId === undefined) {
    const createOrg = await call(jar, 'POST', '/api/auth/organization/create', {
      name: `ws-org-${randomUUID()}`,
      slug: `ws-${randomUUID()}`,
    });
    const organizationId = createOrg.json().id as string;
    await call(jar, 'POST', '/api/auth/organization/set-active', { organizationId });
    return { jar, organizationId, role: 'owner' };
  }
  const auth = api.app.get(AuthService);
  await auth.instance.api.addMember({
    body: { organizationId: orgId, userId, role: role ?? 'member' },
  });
  await call(jar, 'POST', '/api/auth/organization/set-active', { organizationId: orgId });
  return { jar, organizationId: orgId, role: role ?? 'member' };
}

interface BufferedSocket extends WebSocket {
  /** Envelopes received before any assertion attaches — never lost. */
  inbox: WsEnvelope[];
}

function openSocket(cookie: string | undefined): Promise<BufferedSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl, {
      headers: cookie ? { cookie } : {},
      handshakeTimeout: 5000,
    }) as BufferedSocket;
    socket.inbox = [];
    socket.on('message', (raw) => {
      socket.inbox.push(JSON.parse(String(raw)) as WsEnvelope);
    });
    const timer = setTimeout(() => reject(new Error('ws open timeout')), 8000);
    socket.once('open', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function nextMessage(socket: WebSocket, timeoutMs = TIMEOUT): Promise<WsEnvelope> {
  const buffered = socket as BufferedSocket;
  return new Promise((resolve, reject) => {
    // The socket's permanent listener (attached in openSocket) is the only
    // producer; this drains the queue without adding duplicate listeners.
    const timer = setInterval(() => {
      const next = buffered.inbox.shift();
      if (next !== undefined) {
        clearInterval(timer);
        clearTimeout(failTimer);
        resolve(next);
      }
    }, 10);
    const failTimer = setTimeout(() => {
      clearInterval(timer);
      reject(new Error('message timeout'));
    }, timeoutMs);
  });
}

/** Resolves when the socket closes; captures code/reason. */
function closeInfo(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  });
}

function waitForClose(
  socket: WebSocket,
  timeoutMs = 8000,
): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ code: -1, reason: 'timeout' }), timeoutMs);
    socket.once('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
  });
}

async function ingestViaRest(_session: Session, apiKey: string, type: string): Promise<string> {
  const response = await fetch(`${baseUrl}/v1/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ type, payload: { run: randomUUID() } }),
  });
  expect(response.status).toBe(202);
  const body = (await response.json()) as { eventId: string };
  return body.eventId;
}

async function createApiKey(session: Session, scopes: string[]): Promise<string> {
  const auth = api.app.get(ApiKeysService);
  // Sign-in user id is needed; resolve from the session cookie.
  const me = (await call(session.jar, 'GET', '/api/auth/get-session')).json() as {
    user: { id: string };
  };
  const created = await auth.create(tenantScope(session.organizationId), {
    name: 'ws-test',
    scopes: scopes as never,
    createdByUserId: me.user.id,
  });
  return created.secret;
}

describe('websocket auth and protocol', () => {
  it('closes unauthenticated handshakes with 4401', async () => {
    const socket = await openSocket(undefined);
    const closed = await waitForClose(socket);
    expect(closed.code).toBe(4401);
  });

  it('answers ping with pong and confirms subscriptions', async () => {
    const session = await makeSession();
    const socket = await openSocket(session.jar.header());
    socket.send(JSON.stringify({ op: 'ping' }));
    const pong = await nextMessage(socket);
    expect(pong.type).toBe('pong');

    socket.send(JSON.stringify({ op: 'subscribe', channel: 'org' }));
    const subscribed = await nextMessage(socket);
    expect(subscribed.type).toBe('subscribed');
    expect(subscribed.data).toEqual({ channel: 'org' });

    socket.send('not json');
    const error = await nextMessage(socket);
    expect(error.type).toBe('error');
    socket.close();
  });

  it('closes subscriptions to foreign resources with 4403', async () => {
    const ownerA = await makeSession();
    const ownerB = await makeSession();

    // B creates an endpoint with their own key; A tries to subscribe to it.
    const me = (await call(ownerB.jar, 'GET', '/api/auth/get-session')).json() as {
      user: { id: string };
    };
    const keyB = await api.app
      .get(ApiKeysService)
      .create(tenantScope(ownerB.organizationId), {
        name: 'b',
        scopes: ['endpoints:write'],
        createdByUserId: me.user.id,
      });
    const created = await fetch(`${baseUrl}/v1/endpoints`, {
      method: 'POST',
      headers: { authorization: `Bearer ${keyB.secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ url: receiver.url + '/ok' }),
    });
    const endpointId = ((await created.json()) as { id: string }).id;

    const socket = await openSocket(ownerA.jar.header());
    socket.send(JSON.stringify({ op: 'subscribe', channel: `endpoint:${endpointId}` }));
    const closed = await closeInfo(socket);
    expect(closed.code).toBe(4403);
  });
});

describe('websocket fan-out', () => {
  it('delivers the full delivery lifecycle to an org subscriber', async () => {
    const session = await makeSession();
    const key = await createApiKey(session, ['events:write', 'endpoints:write']);
    // An endpoint to fan out to — no endpoint, no deliveries, no events.
    const endpoint = await fetch(`${baseUrl}/v1/endpoints`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ url: receiver.url + '/ok' }),
    });
    expect(endpoint.status).toBe(201);

    const socket = await openSocket(session.jar.header());
    socket.send(JSON.stringify({ op: 'subscribe', channel: 'org' }));
    await nextMessage(socket); // subscribed

    await ingestViaRest(session, key, 'ws.local.test');

    const types: string[] = [];
    for (let i = 0; i < 10 && !types.includes('delivery.status.changed'); i += 1) {
      const message = await nextMessage(socket, 20_000);
      types.push(message.type);
    }
    expect(types).toContain('event.created');
    expect(types).toContain('delivery.created');
    expect(types).toContain('delivery.attempt.completed');
    expect(types).toContain('delivery.status.changed');
    socket.close();
  }, 45_000);

  it('fans out across instances: events executed by the worker instance reach a client on the api instance', async () => {
    const session = await makeSession();
    const key = await createApiKey(session, ['events:write', 'endpoints:write']);
    const endpoint = await fetch(`${baseUrl}/v1/endpoints`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ url: receiver.url + '/ok' }),
    });
    expect(endpoint.status).toBe(201);

    const socket = await openSocket(session.jar.header());
    socket.send(JSON.stringify({ op: 'subscribe', channel: 'org' }));
    await nextMessage(socket);

    // Ingest on the api instance; the WORKER instance processes the job and
    // publishes from its own process — the api instance's Redis subscription
    // must deliver it to the local socket.
    await ingestViaRest(session, key, 'ws.cross.instance');

    let sawStatus = false;
    for (let i = 0; i < 10 && !sawStatus; i += 1) {
      const message = await nextMessage(socket, 20_000);
      if (
        message.type === 'delivery.status.changed' &&
        (message.data as { status?: string }).status === 'succeeded'
      ) {
        sawStatus = true;
      }
    }
    expect(sawStatus).toBe(true);
    socket.close();
  }, 45_000);

  it('never delivers another organization’s events (cross-tenant isolation)', async () => {
    const orgA = await makeSession();
    const keyB = await makeSession();
    const keyBFull = await createApiKey(keyB, ['events:write']);

    const socket = await openSocket(orgA.jar.header());
    socket.send(JSON.stringify({ op: 'subscribe', channel: 'org' }));
    await nextMessage(socket);

    await ingestViaRest(keyB, keyBFull, 'ws.other.org');

    // Give the pipeline time to (wrongly) deliver; the message timeout is
    // the success path here — any envelope would be a leak.
    await expect(nextMessage(socket, 3000)).rejects.toThrow('message timeout');
    socket.close();
  });

  it('enforces the per-user connection limit with close code 4429', async () => {
    const session = await makeSession();
    const sockets: WebSocket[] = [];
    for (let i = 0; i < 10; i += 1) {
      sockets.push(await openSocket(session.jar.header()));
    }
    const eleventh = await openSocket(session.jar.header());
    const closed = await waitForClose(eleventh);
    expect(closed.code).toBe(4429);
    for (const socket of sockets) socket.close();
  }, 30_000);

  it('publish() from the service reaches subscribed clients (bridge unit path)', async () => {
    const session = await makeSession();
    const socket = await openSocket(session.jar.header());
    socket.send(JSON.stringify({ op: 'subscribe', channel: 'org' }));
    await nextMessage(socket);

    const realtime = api.app.get(RealtimeService);
    await realtime.publish(session.organizationId, {
      type: 'endpoint.health.changed',
      ts: new Date().toISOString(),
      data: { endpointId: 'end_test', state: 'open', reason: 'failures' },
    });
    const message = await nextMessage(socket);
    expect(message.type).toBe('endpoint.health.changed');
    socket.close();
  });
});
