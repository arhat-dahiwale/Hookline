import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuthService } from '../../src/modules/auth/index.js';
import { CookieJar, createTestApplication, type TestApplication } from './test-app.js';
import { GuardedController } from './support/guarded.controller.js';

type InjectResponse = Awaited<ReturnType<TestApplication['instance']['inject']>>;

let test: TestApplication;
let jar: CookieJar;

beforeAll(async () => {
  test = await createTestApplication([GuardedController]);
  jar = new CookieJar();
});

afterAll(async () => {
  await test.app.close();
});

function uniqueEmail(): string {
  return `user-${randomUUID()}@example.test`;
}

async function call(method: string, url: string, payload?: unknown): Promise<InjectResponse> {
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

async function signUpAndCreateOrg(
  email: string,
  password = 'password-123456',
  orgName: string,
): Promise<{ userId: string; organizationId: string }> {
  const signUp = await call('POST', '/api/auth/sign-up/email', {
    email,
    password,
    name: 'Test User',
  });
  expect(signUp.statusCode).toBeLessThan(300);

  const session = await call('GET', '/api/auth/get-session');
  const me = session.json();
  expect(me).not.toBeNull();
  const createOrg = await call('POST', '/api/auth/organization/create', {
    name: orgName,
    slug: `org-${randomUUID()}`,
  });
  expect(createOrg.statusCode).toBeLessThan(300);
  const org = createOrg.json();
  const setActive = await call('POST', '/api/auth/organization/set-active', {
    organizationId: org.id,
  });
  expect(setActive.statusCode).toBeLessThan(300);
  return { userId: me.user.id as string, organizationId: org.id as string };
}

describe('auth integration', () => {
  it('signs up with email/password and returns a session cookie', async () => {
    jar.clear();
    const response = await call('POST', '/api/auth/sign-up/email', {
      email: uniqueEmail(),
      password: 'password-123456',
      name: 'Signup User',
    });
    expect(response.statusCode).toBeLessThan(300);
    expect(response.headers['set-cookie']).toBeDefined();

    const session = await call('GET', '/api/auth/get-session');
    expect(session.statusCode).toBe(200);
    const body = session.json();
    expect(body.user).toMatchObject({ name: 'Signup User' });
  });

  it('rejects wrong credentials with 401', async () => {
    jar.clear();
    const email = uniqueEmail();
    await call('POST', '/api/auth/sign-up/email', {
      email,
      password: 'password-123456',
      name: 'A',
    });

    jar.clear();
    const bad = await test.instance.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      payload: JSON.stringify({ email, password: 'wrong-password' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(bad.statusCode).toBe(401);
  });

  it('signs in an existing user', async () => {
    const email = uniqueEmail();
    await call('POST', '/api/auth/sign-up/email', {
      email,
      password: 'password-123456',
      name: 'B',
    });
    jar.clear();
    const signIn = await call('POST', '/api/auth/sign-in/email', {
      email,
      password: 'password-123456',
    });
    expect(signIn.statusCode).toBeLessThan(300);
    const session = await call('GET', '/api/auth/get-session');
    expect(session.json().user.email).toBe(email);
  });

  it('signs out and invalidates the session', async () => {
    await call('POST', '/api/auth/sign-up/email', {
      email: uniqueEmail(),
      password: 'password-123456',
      name: 'C',
    });
    const out = await call('POST', '/api/auth/sign-out');
    expect(out.statusCode).toBeLessThan(300);
    const session = await call('GET', '/api/auth/get-session');
    expect(session.json()).toBeNull();
  });

  it('creates an organization, sets it active, and resolves roles', async () => {
    jar.clear();
    const email = uniqueEmail();
    const { userId, organizationId } = await signUpAndCreateOrg(
      email,
      'password-123456',
      'Role Org',
    );

    const me = await call('GET', '/test-guard/me');
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ userId, activeOrganizationId: organizationId });

    const org = await call('GET', '/test-guard/org');
    expect(org.statusCode).toBe(200);
    expect(org.json()).toEqual({ organizationId, role: 'owner' });

    // Owner satisfies the admin minimum.
    const adminAction = await call('POST', '/test-guard/admin-action');
    expect(adminAction.statusCode).toBe(201);
  });

  it('denies member role below the required minimum', async () => {
    jar.clear();
    const ownerEmail = uniqueEmail();
    const { organizationId } = await signUpAndCreateOrg(
      ownerEmail,
      'password-123456',
      'Admins Only',
    );
    const authService = test.app.get(AuthService);

    const memberEmail = uniqueEmail();
    jar.clear();
    await call('POST', '/api/auth/sign-up/email', {
      email: memberEmail,
      password: 'password-123456',
      name: 'M',
    });
    const memberSession = await call('GET', '/api/auth/get-session');
    const memberUserId = memberSession.json().user.id as string;

    const added = await authService.instance.api.addMember({
      body: { organizationId, userId: memberUserId, role: 'member' },
    });
    expect(added?.userId).toBe(memberUserId);

    // Sign in as the member and activate the organization.
    jar.clear();
    await call('POST', '/api/auth/sign-in/email', {
      email: memberEmail,
      password: 'password-123456',
    });
    await call('POST', '/api/auth/organization/set-active', { organizationId });

    const org = await call('GET', '/test-guard/org');
    expect(org.statusCode).toBe(200);
    expect(org.json()).toEqual({ organizationId, role: 'member' });

    const adminAction = await call('POST', '/test-guard/admin-action');
    expect(adminAction.statusCode).toBe(403);
    expect(adminAction.json().error.code).toBe('forbidden');
  });

  it('isolates tenants: another org member cannot see this org', async () => {
    jar.clear();
    const { organizationId: orgA } = await signUpAndCreateOrg(
      uniqueEmail(),
      'password-123456',
      'Org A',
    );

    jar.clear();
    const { organizationId: orgB } = await signUpAndCreateOrg(
      uniqueEmail(),
      'password-123456',
      'Org B',
    );

    // User B's active org is B, not A.
    const me = await call('GET', '/test-guard/me');
    expect(me.json().activeOrganizationId).toBe(orgB);
    expect(me.json().activeOrganizationId).not.toBe(orgA);

    // User B is not a member of org A: roles guard must reject org A paths.
    const authService = test.app.get(AuthService);
    const sessionB = await authService.resolveSession(jar.header());
    expect(await authService.getMemberRole(sessionB!.user.id, orgA)).toBeNull();
    expect(await authService.getMemberRole(sessionB!.user.id, orgB)).toBe('owner');
  });

  it('rejects unauthenticated access to guarded routes with the standard 401', async () => {
    jar.clear();
    const response = await test.instance.inject({ method: 'GET', url: '/test-guard/me' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('unauthorized');
  });
});
