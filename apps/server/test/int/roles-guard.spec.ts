import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SetMetadata, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AuthService } from '../../src/modules/auth/index.js';
import { MIN_ROLE_KEY, RolesGuard, type RoleRequest } from '../../src/modules/auth/roles.guard.js';
import { CookieJar, createTestApplication, type TestApplication } from './test-app.js';

/**
 * RolesGuard forbidden branches against the REAL AuthService and database
 * (Phase 14 coverage): missing session, no active organization, and a user
 * who is not a member of their active organization never reach a handler.
 * The happy paths are also covered over HTTP in auth.spec.ts and
 * authz-matrix.spec.ts.
 */

let test: TestApplication;
let guard: RolesGuard;
let ownerId = '';
let memberId = '';
let outsiderId = '';
let organizationId = '';

beforeAll(async () => {
  test = await createTestApplication();
  guard = new RolesGuard(test.app.get(Reflector), test.app.get(AuthService) as never) as RolesGuard;

  const jar = new CookieJar();
  const call = async (method: string, url: string, payload?: unknown) => {
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
  };
  const signUp = async (name: string): Promise<string> => {
    await call('POST', '/api/auth/sign-up/email', {
      email: `rg-${name.toLowerCase()}-${crypto.randomUUID()}@example.test`,
      password: 'password-123456',
      name,
    });
    return ((await call('GET', '/api/auth/get-session')).json() as { user: { id: string } }).user
      .id;
  };

  ownerId = await signUp('Owner');
  const org = await call('POST', '/api/auth/organization/create', {
    name: 'rg-org',
    slug: `rg-${crypto.randomUUID()}`,
  });
  organizationId = (org.json() as { id: string }).id;

  // A plain member (not the owner — owners satisfy every role minimum).
  memberId = await signUp('Member');
  await test.app.get(AuthService).instance.api.addMember({
    body: { organizationId, userId: memberId, role: 'member' },
  });

  // A user who signs up but joins nothing.
  outsiderId = await signUp('Outsider');
});

afterAll(async () => {
  await test.app.close();
});

function contextFor(request: Partial<RoleRequest>, minRole?: 'member' | 'admin' | 'owner') {
  const handler = Object.assign(() => undefined, {});
  if (minRole) SetMetadata(MIN_ROLE_KEY, minRole)(handler);
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => () => undefined,
  } as unknown as ExecutionContext;
}

function sessionFor(userId: string, activeOrganizationId: string | null) {
  return {
    user: { id: userId, email: 'rg@example.test', name: 'RG' },
    session: { id: 'ses_rg', userId, activeOrganizationId, expiresAt: new Date() },
  };
}

describe('RolesGuard forbidden branches', () => {
  it('rejects a request without a session', async () => {
    await expect(guard.canActivate(contextFor({}))).rejects.toMatchObject({ status: 403 });
  });

  it('rejects a session with no active organization', async () => {
    await expect(
      guard.canActivate(contextFor({ hooklineSession: sessionFor(ownerId, null) })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects a user who is not a member of the active organization', async () => {
    // The outsider points their session at another org they never joined.
    await expect(
      guard.canActivate(contextFor({ hooklineSession: sessionFor(outsiderId, organizationId) })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('enforces MinRole and attaches the resolved role on success', async () => {
    const request = {
      hooklineSession: sessionFor(memberId, organizationId),
    } as unknown as RoleRequest;

    await expect(guard.canActivate(contextFor(request, 'admin'))).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining('admin'),
    });

    const ok = { hooklineSession: sessionFor(memberId, organizationId) } as unknown as RoleRequest;
    await expect(guard.canActivate(contextFor(ok))).resolves.toBe(true);
    expect(ok.hooklineOrgRole).toBe('member');
  });
});
