import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuthService, type OrgRole } from '../../src/modules/auth/index.js';
import { DeliveriesRepository } from '../../src/modules/deliveries/index.js';
import { CookieJar, createTestApplication, type TestApplication } from './test-app.js';
import { TestReceiver } from './support/test-receiver.js';

type InjectResponse = Awaited<ReturnType<TestApplication['instance']['inject']>>;

let test: TestApplication;
let receiver: TestReceiver;

beforeAll(async () => {
  test = await createTestApplication([], { ALLOW_INSECURE_ENDPOINTS: 'true' });
  receiver = new TestReceiver();
  await receiver.start();
});

afterAll(async () => {
  await test.app.close();
  await receiver.stop().catch(() => undefined);
});

interface Session {
  jar: CookieJar;
  organizationId: string;
  role: OrgRole;
}

function uniqueEmail(): string {
  return `user-${randomUUID()}@example.test`;
}

async function call(
  jar: CookieJar,
  method: string,
  url: string,
  payload?: unknown,
): Promise<InjectResponse> {
  const cookie = jar.header();
  const response = await test.instance.inject({
    method,
    url,
    ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
    headers: {
      ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
  });
  jar.capture(response);
  return response;
}

interface TrpcResult {
  status: number;
  body: {
    data?: unknown;
    error?: { data: { code: string; hooklineCode: string | null } };
  };
}

async function trpc(
  session: Session,
  name: string,
  input?: unknown,
  method: 'GET' | 'POST' = 'GET',
): Promise<TrpcResult> {
  let url = `/trpc/${name}`;
  let payload: string | undefined;
  if (method === 'GET' && input !== undefined) {
    url += `?input=${encodeURIComponent(JSON.stringify(input))}`;
  } else if (method === 'POST') {
    payload = JSON.stringify(input ?? {});
  }
  const cookie = session.jar.header();
  const response = await test.instance.inject({
    method,
    url,
    ...(payload !== undefined ? { payload } : {}),
    headers: {
      ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
  });
  session.jar.capture(response);
  const raw = response.json() as {
    result?: { data?: unknown };
    error?: { data: { code: string; hooklineCode: string | null } };
  };
  return {
    status: response.statusCode,
    body: raw.error === undefined ? { data: raw.result?.data } : { error: raw.error },
  };
}

async function makeSession(orgId?: string, role?: OrgRole): Promise<Session> {
  const jar = new CookieJar();
  const signUp = await call(jar, 'POST', '/api/auth/sign-up/email', {
    email: uniqueEmail(),
    password: 'password-123456',
    name: 'Router Tester',
  });
  expect(signUp.statusCode).toBeLessThan(300);
  const me = (await call(jar, 'GET', '/api/auth/get-session')).json();
  const userId = me.user.id as string;

  if (orgId === undefined) {
    const createOrg = await call(jar, 'POST', '/api/auth/organization/create', {
      name: `router-org-${randomUUID()}`,
      slug: `router-${randomUUID()}`,
    });
    expect(createOrg.statusCode).toBeLessThan(300);
    const organizationId = createOrg.json().id as string;
    await call(jar, 'POST', '/api/auth/organization/set-active', { organizationId });
    return { jar, organizationId, role: 'owner' };
  }
  const auth = test.app.get(AuthService);
  await auth.instance.api.addMember({
    body: { organizationId: orgId, userId, role: role ?? 'member' },
  });
  await call(jar, 'POST', '/api/auth/organization/set-active', { organizationId: orgId });
  return { jar, organizationId: orgId, role: role ?? 'member' };
}

async function adminEndpoint(actor: Session): Promise<string> {
  const created = await trpc(actor, 'endpoints.create', { url: receiver.url + '/ok' }, 'POST');
  expect(created.status).toBe(200);
  return (created.body.data as { id: string }).id;
}

describe('events router authorization', () => {
  it('members read, only admins send/replay, cross-tenant is 404', async () => {
    const owner = await makeSession();
    const member = await makeSession(owner.organizationId, 'member');
    const endpointId = await adminEndpoint(owner);

    const list = await trpc(member, 'events.list', {});
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual({ data: [], nextCursor: null });

    const memberSend = await trpc(member, 'events.send', { type: 'a.b', payload: {} }, 'POST');
    expect(memberSend.status).toBe(403);
    const memberReplay = await trpc(member, 'events.replay', { id: 'evt_x' }, 'POST');
    expect(memberReplay.status).toBe(403);

    const sent = await trpc(
      owner,
      'events.send',
      { type: 'router.test', payload: { n: 1 } },
      'POST',
    );
    expect(sent.status).toBe(200);
    const sentData = sent.body.data as {
      event: { id: string };
      deliveries: { endpointId: string }[];
    };
    expect(sentData.event.id).toMatch(/^evt_/);
    expect(sentData.deliveries).toHaveLength(1);
    expect(sentData.deliveries[0]!.endpointId).toBe(endpointId);

    const got = await trpc(member, 'events.get', { id: sentData.event.id });
    expect(got.status).toBe(200);
    expect((got.body.data as { payload: unknown }).payload).toEqual({ n: 1 });

    const outsider = await makeSession();
    const cross = await trpc(outsider, 'events.get', { id: sentData.event.id });
    expect(cross.status).toBe(404);
  });
});

describe('deliveries router authorization', () => {
  it('members read, admins replay single and bulk, since backfills', async () => {
    const owner = await makeSession();
    const member = await makeSession(owner.organizationId, 'member');
    const endpointId = await adminEndpoint(owner);

    const sent = await trpc(owner, 'events.send', { type: 'dlv.test', payload: {} }, 'POST');
    const delivery = (sent.body.data as { deliveries: { id: string }[] }).deliveries[0]!;

    const list = await trpc(member, 'deliveries.list', { endpointId });
    expect(list.status).toBe(200);
    expect((list.body.data as { data: unknown[] }).data).toHaveLength(1);

    const memberReplay = await trpc(member, 'deliveries.replay', { id: delivery.id }, 'POST');
    expect(memberReplay.status).toBe(403);

    const got = await trpc(member, 'deliveries.get', { id: delivery.id });
    expect(got.status).toBe(200);
    expect((got.body.data as { endpointId: string }).endpointId).toBe(endpointId);

    const attempts = await trpc(member, 'deliveries.attempts', { id: delivery.id });
    expect(attempts.status).toBe(200);
    // ROLE=all test app delivers to the /ok receiver, so attempt 1 exists.
    const attemptRows = (attempts.body.data as { data: { attemptNumber: number }[] }).data;
    expect(attemptRows.length).toBeGreaterThanOrEqual(1);
    expect(attemptRows[0]!.attemptNumber).toBe(1);

    // Single replay creates a linked delivery (admin).
    const replayed = await trpc(owner, 'deliveries.replay', { id: delivery.id }, 'POST');
    expect(replayed.status).toBe(200);
    const replayRow = replayed.body.data as { id: string; replayOfDeliveryId: string | null };
    expect(replayRow.replayOfDeliveryId).toBe(delivery.id);

    // since returns rows updated after the epoch (backfill window).
    const since = await trpc(member, 'deliveries.since', { since: new Date(0).toISOString() });
    expect(since.status).toBe(200);
    expect((since.body.data as { data: unknown[] }).data.length).toBeGreaterThanOrEqual(2);

    const outsider = await makeSession();
    const cross = await trpc(outsider, 'deliveries.get', { id: delivery.id });
    expect(cross.status).toBe(404);
  });

  it('bulk replay only touches terminal states and is scope-safe', async () => {
    const owner = await makeSession();
    const endpointId = await adminEndpoint(owner);

    // Event with a non-matching endpoint restriction: no real delivery is
    // fanned out, so no worker race can rewrite the row we insert by hand.
    const sent = await trpc(
      owner,
      'events.send',
      { type: 'bulk.test', payload: {}, endpointIds: [] },
      'POST',
    );
    const eventId = (sent.body.data as { event: { id: string } }).event.id;

    await test.app.get(DeliveriesRepository).insertMany([
      {
        organizationId: owner.organizationId,
        eventId,
        endpointId,
        maxAttempts: 3,
        status: 'dead',
        completedAt: new Date(),
      },
    ]);

    const nonTerminal = await trpc(owner, 'deliveries.replayBulk', { status: 'pending' }, 'POST');
    expect(nonTerminal.status).toBe(400);

    const bulk = await trpc(owner, 'deliveries.replayBulk', { status: 'dead', endpointId }, 'POST');
    expect(bulk.status).toBe(200);
    const bulkRows = (bulk.body.data as { deliveries: { replayOfDeliveryId: string | null }[] })
      .deliveries;
    expect(bulkRows.some((row) => row.replayOfDeliveryId !== null)).toBe(true);
  });
});

describe('apiKeys router authorization', () => {
  it('members are locked out; admins create (secret once), list, revoke', async () => {
    const owner = await makeSession();
    const member = await makeSession(owner.organizationId, 'member');

    const memberList = await trpc(member, 'apiKeys.list');
    expect(memberList.status).toBe(403);
    const memberCreate = await trpc(
      member,
      'apiKeys.create',
      { name: 'm', scopes: ['events:write'] },
      'POST',
    );
    expect(memberCreate.status).toBe(403);

    const created = await trpc(
      owner,
      'apiKeys.create',
      { name: 'dash-key', scopes: ['events:write', 'events:read'] },
      'POST',
    );
    expect(created.status).toBe(200);
    const { key, secret } = created.body.data as {
      key: { id: string; prefix: string };
      secret: string;
    };
    expect(secret).toMatch(/^hl_live_/);
    expect(key.prefix).toHaveLength(16);

    const list = await trpc(owner, 'apiKeys.list');
    const rows = (list.body.data as { data: { id: string; prefix: string }[] }).data;
    const listed = rows.find((row) => row.id === key.id)!;
    expect(listed.prefix).toBe(key.prefix);
    expect(JSON.stringify(list.body.data)).not.toContain(secret);

    const revoked = await trpc(owner, 'apiKeys.revoke', { id: key.id }, 'POST');
    expect(revoked.status).toBe(200);
    expect((revoked.body.data as { revokedAt: string | null }).revokedAt).not.toBeNull();

    const outsider = await makeSession();
    const cross = await trpc(outsider, 'apiKeys.revoke', { id: key.id }, 'POST');
    expect(cross.status).toBe(404);
  });
});

describe('audit + settings routers', () => {
  it('members are locked out; admins read audit and update settings', async () => {
    const owner = await makeSession();
    const member = await makeSession(owner.organizationId, 'member');

    const memberAudit = await trpc(member, 'audit.list');
    expect(memberAudit.status).toBe(403);
    const memberSettings = await trpc(member, 'settings.get');
    expect(memberSettings.status).toBe(403);

    const defaults = await trpc(owner, 'settings.get');
    expect(defaults.status).toBe(200);
    expect((defaults.body.data as { retentionDays: number | null }).retentionDays).toBeNull();

    const updated = await trpc(owner, 'settings.update', { retentionDays: 14 }, 'POST');
    expect(updated.status).toBe(200);
    expect((updated.body.data as { retentionDays: number }).retentionDays).toBe(14);

    const audit = await trpc(owner, 'audit.list');
    const actions = (audit.body.data as { data: { action: string }[] }).data.map((e) => e.action);
    expect(actions).toContain('settings.updated');
  });
});
