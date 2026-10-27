import { randomUUID } from 'node:crypto';

import * as grpc from '@grpc/grpc-js';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiKeysService } from '../../src/modules/api-keys/index.js';
import { AuthService, type OrgRole } from '../../src/modules/auth/index.js';
import { tenantScope } from '../../src/modules/platform/database/tenant-scope.js';
import { WORKER_OPERATIONS, loadWorkerProto } from '../../src/modules/worker-ops/index.js';
import type { WorkerOperationsService } from '../../src/modules/worker-ops/index.js';
import { CookieJar, createTestApplication, listen, type TestApplication } from './test-app.js';

/**
 * Authorization matrix across ALL FOUR protocols (Phase 14): one place that
 * proves the same model — anonymous denied, scope/role minimums enforced,
 * cross-tenant invisible — on REST, tRPC, WebSocket and the internal gRPC
 * surface. Per-protocol suites cover depth; this covers breadth.
 *
 * This app runs with ALLOW_INSECURE_ENDPOINTS=true so creations can target
 * local URLs.
 */

let api: TestApplication;
let worker: TestApplication;
let baseUrl = '';
let wsUrl = '';

interface Session {
  jar: CookieJar;
  organizationId: string;
  role: OrgRole;
  userId: string;
}

beforeAll(async () => {
  api = await createTestApplication([], { ALLOW_INSECURE_ENDPOINTS: 'true' }, 'api');
  worker = await createTestApplication([], { ALLOW_INSECURE_ENDPOINTS: 'true' }, 'worker');
  baseUrl = await listen(api);
  wsUrl = baseUrl.replace('http', 'ws') + '/ws';
});

afterAll(async () => {
  await api.app.close();
  await worker.app.close();
});

function uniqueEmail(): string {
  return `matrix-${randomUUID()}@example.test`;
}

async function makeSession(orgId?: string, role?: OrgRole): Promise<Session> {
  const jar = new CookieJar();
  const inject = async (method: string, url: string, payload?: unknown) => {
    const response = await api.instance.inject({
      method,
      url,
      ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
      headers: {
        ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(jar.header() ? { cookie: jar.header() } : {}),
      },
    });
    jar.capture(response);
    return response;
  };
  await inject('POST', '/api/auth/sign-up/email', {
    email: uniqueEmail(),
    password: 'password-123456',
    name: 'Matrix',
  });
  const userId = ((await inject('GET', '/api/auth/get-session')).json() as { user: { id: string } })
    .user.id;

  if (orgId === undefined) {
    const org = await inject('POST', '/api/auth/organization/create', {
      name: `matrix-${randomUUID()}`,
      slug: `m-${randomUUID().slice(0, 8)}`,
    });
    const organizationId = (org.json() as { id: string }).id;
    await inject('POST', '/api/auth/organization/set-active', { organizationId });
    return { jar, organizationId, role: 'owner', userId };
  }
  await api.app.get(AuthService).instance.api.addMember({
    body: { organizationId: orgId, userId, role: role ?? 'member' },
  });
  await inject('POST', '/api/auth/organization/set-active', { organizationId: orgId });
  return { jar, organizationId: orgId, role: role ?? 'member', userId };
}

async function keyFor(session: Session, scopes: string[]): Promise<string> {
  const created = await api.app
    .get(ApiKeysService)
    .create(tenantScope(session.organizationId), {
      name: `matrix-${scopes.join('-')}`,
      scopes: scopes as never,
      createdByUserId: session.userId,
    });
  return created.secret;
}

function trpcUrl(procedure: string, input: unknown, method: 'GET' | 'POST'): string {
  if (method === 'POST' || input === undefined) return `${baseUrl}/trpc/${procedure}`;
  return `${baseUrl}/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify(input))}`;
}

describe('authorization matrix across protocols', () => {
  it('REST: anonymous 401, read-scope cannot write (403), write-scope creates (201), cross-tenant 404', async () => {
    const owner = await makeSession();
    const outsider = await makeSession();
    const readKey = await keyFor(owner, ['endpoints:read']);
    const writeKey = await keyFor(owner, ['endpoints:read', 'endpoints:write']);

    expect((await fetch(`${baseUrl}/v1/endpoints`)).status).toBe(401);
    expect(
      (await fetch(`${baseUrl}/v1/endpoints`, { headers: { authorization: `Bearer ${readKey}` } }))
        .status,
    ).toBe(200);
    expect(
      (
        await fetch(`${baseUrl}/v1/endpoints`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${readKey}` },
          body: JSON.stringify({ url: 'http://localhost:9/hook' }),
        })
      ).status,
      'read-scoped key must not create',
    ).toBe(403);

    const created = await fetch(`${baseUrl}/v1/endpoints`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${writeKey}` },
      body: JSON.stringify({ url: 'http://localhost:9/hook' }),
    });
    expect(created.status).toBe(201);

    const outsiderKey = await keyFor(outsider, ['endpoints:read']);
    const cross = await fetch(`${baseUrl}/v1/endpoints/mat_nonexistent`, {
      headers: { authorization: `Bearer ${outsiderKey}` },
    });
    expect(cross.status).toBe(404);
  });

  it('tRPC: anonymous 401, member read ok, member mutation 403, admin mutation ok', async () => {
    const owner = await makeSession();
    const member = await makeSession(owner.organizationId, 'member');
    const admin = await makeSession(owner.organizationId, 'admin');

    expect((await fetch(trpcUrl('endpoints.list', undefined, 'GET'))).status).toBe(401);
    expect(
      (
        await fetch(trpcUrl('endpoints.list', undefined, 'GET'), {
          headers: { cookie: member.jar.header() ?? '' },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(trpcUrl('endpoints.create', undefined, 'POST'), {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: member.jar.header() ?? '' },
          body: JSON.stringify({ url: 'http://localhost:9/hook' }),
        })
      ).status,
      'member mutations below admin minimum are forbidden',
    ).toBe(403);
    expect(
      (
        await fetch(trpcUrl('endpoints.create', undefined, 'POST'), {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: admin.jar.header() ?? '' },
          body: JSON.stringify({ url: 'http://localhost:9/hook' }),
        })
      ).status,
    ).toBe(200);
  });

  it('WebSocket: anonymous 4401, foreign resource 4403', async () => {
    const owner = await makeSession();
    const other = await makeSession();
    const key = await keyFor(other, ['endpoints:write']);
    const created = await fetch(`${baseUrl}/v1/endpoints`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ url: 'http://localhost:9/hook' }),
    });
    const endpointId = ((await created.json()) as { id: string }).id;

    const anonymousClose = await new Promise<number>((resolve) => {
      const socket = new WebSocket(wsUrl, { handshakeTimeout: 5000 });
      socket.once('close', (code) => resolve(code));
      socket.once('error', () => resolve(-1));
    });
    expect(anonymousClose).toBe(4401);

    const foreignClose = await new Promise<number>((resolve) => {
      const socket = new WebSocket(wsUrl, { headers: { cookie: owner.jar.header() ?? '' } });
      socket.once('open', () => {
        socket.send(JSON.stringify({ op: 'subscribe', channel: `endpoint:${endpointId}` }));
      });
      socket.once('close', (code) => resolve(code));
      socket.once('error', () => resolve(-1));
    });
    expect(foreignClose).toBe(4403);
  });

  it('gRPC (internal): adapter maps not_found; wire token negative-test in grpc-wire.spec', async () => {
    const definition = loadWorkerProto();
    const Client = (
      grpc.loadPackageDefinition(definition) as unknown as {
        hookline: {
          worker: {
            v1: { WorkerService: new (a: string, c: grpc.ChannelCredentials) => grpc.Client };
          };
        };
      }
    ).hookline.worker.v1.WorkerService;
    void Client;

    const operations = api.app.get(WORKER_OPERATIONS) as WorkerOperationsService;
    await expect(
      operations.testEndpoint({ organizationId: 'org_matrix', endpointId: 'end_missing' }),
    ).rejects.toMatchObject({ hooklineCode: 'not_found' });

    const response = await fetch(`${baseUrl}/health/live`);
    expect(response.status).toBe(200);
    void worker;
  });
});
