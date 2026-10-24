import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuthService, type OrgRole } from '../../src/modules/auth/index.js';
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
  userId: string;
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

/** Calls a tRPC procedure with the session's cookies; returns unwrapped body. */
async function trpc(
  session: Session,
  name: string,
  input?: unknown,
  method: 'GET' | 'POST' = 'GET',
): Promise<{ status: number; body: { data?: unknown; error?: TrpcErrorShape } }> {
  let url = `/trpc/${name}`;
  let payload: string | undefined;
  if (method === 'GET' && input !== undefined) {
    // No data transformer: GET input is the raw JSON (not `{ json: ... }`).
    url += `?input=${encodeURIComponent(JSON.stringify(input))}`;
  } else if (method === 'POST') {
    payload = JSON.stringify(input === undefined ? {} : input);
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
  const raw = response.json() as { result?: { data?: unknown }; error?: TrpcErrorShape };
  // v11 envelope: successes are `{ result: { data: <output> } }`, errors `{ error }`.
  return {
    status: response.statusCode,
    body: (raw.error === undefined ? { data: raw.result?.data } : { error: raw.error }) as {
      data?: unknown;
      error?: TrpcErrorShape;
    },
  };
}

interface TrpcErrorShape {
  message: string;
  data: {
    code: string;
    httpStatus: number;
    hooklineCode: string | null;
    zodIssues?: { path: string; message: string }[] | null;
  };
}

/** Signs a user up, creates (or joins) the org, and activates it. */
async function makeSession(orgId?: string, role?: OrgRole): Promise<Session> {
  const jar = new CookieJar();
  const signUp = await call(jar, 'POST', '/api/auth/sign-up/email', {
    email: uniqueEmail(),
    password: 'password-123456',
    name: 'Trpc Tester',
  });
  expect(signUp.statusCode).toBeLessThan(300);
  const me = (await call(jar, 'GET', '/api/auth/get-session')).json();
  const userId = me.user.id as string;

  let organizationId: string;
  if (orgId === undefined) {
    const createOrg = await call(jar, 'POST', '/api/auth/organization/create', {
      name: `trpc-org-${randomUUID()}`,
      slug: `trpc-${randomUUID()}`,
    });
    expect(createOrg.statusCode).toBeLessThan(300);
    organizationId = createOrg.json().id as string;
    await call(jar, 'POST', '/api/auth/organization/set-active', { organizationId });
    return { jar, userId, organizationId, role: 'owner' };
  }

  // Join an existing org with the given role via the Better Auth server API.
  const auth = test.app.get(AuthService);
  await auth.instance.api.addMember({
    body: { organizationId: orgId, userId, role: role ?? 'member' },
  });
  await call(jar, 'POST', '/api/auth/organization/set-active', { organizationId: orgId });
  return { jar, userId, organizationId: orgId, role: role ?? 'member' };
}

async function createEndpointViaTrpc(
  actor: Session,
  url: string,
): Promise<{ id: string; secret: string }> {
  const created = await trpc(
    actor,
    'endpoints.create',
    {
      url,
      description: 'trpc test endpoint',
    },
    'POST',
  );
  if (created.status !== 200) {
    throw new Error(`endpoint.create failed: ${JSON.stringify(created.body)}`);
  }
  const data = created.body.data as { id: string; secret: string };
  return { id: data.id, secret: data.secret };
}

describe('tRPC auth gating', () => {
  it('rejects unauthenticated calls with UNAUTHORIZED and hooklineCode', async () => {
    const anonymous: Session = {
      jar: new CookieJar(),
      userId: '',
      organizationId: '',
      role: 'member',
    };
    const result = await trpc(anonymous, 'endpoints.list');
    expect(result.status).toBe(401);
    expect(result.body.error?.data.code).toBe('UNAUTHORIZED');
    expect(result.body.error?.data.hooklineCode).toBe('unauthorized');
  });

  it('rejects a session without an active organization with FORBIDDEN', async () => {
    const jar = new CookieJar();
    await call(jar, 'POST', '/api/auth/sign-up/email', {
      email: uniqueEmail(),
      password: 'password-123456',
      name: 'No Org',
    });
    const session: Session = { jar, userId: '', organizationId: '', role: 'member' };
    const result = await trpc(session, 'endpoints.list');
    expect(result.status).toBe(403);
    expect(result.body.error?.data.code).toBe('FORBIDDEN');
  });

  it('enforces the role matrix: member reads, admin writes', async () => {
    const owner = await makeSession();
    const admin = await makeSession(owner.organizationId, 'admin');
    const member = await makeSession(owner.organizationId, 'member');

    // Member (M) reads pass.
    const list = await trpc(member, 'endpoints.list');
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual({ data: [] });

    // Member mutations at admin minimum fail.
    const memberCreate = await trpc(
      member,
      'endpoints.create',
      {
        url: receiver.url + '/ok',
      },
      'POST',
    );
    expect(memberCreate.status).toBe(403);
    expect(memberCreate.body.error?.data.code).toBe('FORBIDDEN');
    const memberRotate = await trpc(member, 'endpoints.rotateSecret', { id: 'ep_x' }, 'POST');
    expect(memberRotate.status).toBe(403);

    // Admin (A) mutations pass.
    const created = await createEndpointViaTrpc(admin, receiver.url + '/ok');
    expect(created.secret).toMatch(/^whsec_/);

    // Secret is not part of reads.
    const got = await trpc(member, 'endpoints.get', { id: created.id });
    expect(got.status).toBe(200);
    expect((got.body.data as { secret?: string }).secret).toBeUndefined();

    // Validation errors render in the tRPC error shape with details. The test
    // app runs with ALLOW_INSECURE_ENDPOINTS=true, so only malformed URLs are
    // rejected here (the private-range SSRF matrix is covered by the shared
    // validator unit tests and the REST contract test).
    const bad = await trpc(admin, 'endpoints.create', { url: 'not-a-url' }, 'POST');
    expect(bad.status).toBe(400);
    expect(bad.body.error?.data.code).toBe('BAD_REQUEST');
    expect(bad.body.error?.data.hooklineCode).toBe('endpoint_url_blocked');

    // Owner passes admin minimums.
    const ownerCreate = await createEndpointViaTrpc(owner, receiver.url + '/ok');
    expect(ownerCreate.id).not.toEqual(created.id);
  });

  it('never leaks another tenant’s endpoints (cross-tenant NOT_FOUND)', async () => {
    const orgA = await makeSession();
    const orgB = await makeSession();
    const created = await createEndpointViaTrpc(orgA, receiver.url + '/ok');

    const crossGet = await trpc(orgB, 'endpoints.get', { id: created.id });
    expect(crossGet.status).toBe(404);
    expect(crossGet.body.error?.data.hooklineCode).toBe('not_found');

    const crossList = await trpc(orgB, 'endpoints.list');
    const ids = (crossList.body.data as { data: { id: string }[] }).data.map((e) => e.id);
    expect(ids).not.toContain(created.id);
  });

  it('renders zod validation issues in the error shape', async () => {
    const owner = await makeSession();
    const bad = await trpc(owner, 'endpoints.create', { url: '' }, 'POST');
    expect(bad.status).toBe(400);
    expect(bad.body.error?.data.code).toBe('BAD_REQUEST');
    expect(bad.body.error?.data.zodIssues?.length).toBeGreaterThan(0);
  });

  it('test send runs through the worker operations and reports the outcome', async () => {
    const owner = await makeSession();
    const created = await createEndpointViaTrpc(owner, receiver.url + '/ok');
    const result = await trpc(owner, 'endpoints.test', { id: created.id }, 'POST');
    expect(result.status).toBe(200);
    const data = result.body.data as { outcome: string; responseStatus: number | null };
    expect(data.outcome).toBe('success');
    expect(data.responseStatus).toBe(200);
  });

  it('health and status transitions work end to end', async () => {
    const owner = await makeSession();
    const created = await createEndpointViaTrpc(owner, receiver.url + '/ok');

    const health = await trpc(owner, 'endpoints.health', { id: created.id });
    expect(health.status).toBe(200);
    expect((health.body.data as { state: string }).state).toBe('closed');

    const disabled = await trpc(
      owner,
      'endpoints.setStatus',
      { id: created.id, status: 'disabled' },
      'POST',
    );
    expect(disabled.status).toBe(200);
    expect((disabled.body.data as { status: string }).status).toBe('disabled');

    const enabled = await trpc(
      owner,
      'endpoints.setStatus',
      { id: created.id, status: 'active' },
      'POST',
    );
    expect((enabled.body.data as { status: string }).status).toBe('active');
  });
});
