import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import type { ExecutionContext } from '@nestjs/common';

import { AuthService } from './auth.service.js';
import { MinRole, MIN_ROLE_KEY, RolesGuard, type RoleRequest } from './roles.guard.js';
import type { SessionContext } from './session-context.js';

function execution(request: Partial<RoleRequest>, minRole?: 'member' | 'admin' | 'owner') {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () =>
      minRole ? Object.assign(() => undefined, { [MIN_ROLE_KEY]: minRole }) : () => undefined,
    getClass: () => () => undefined,
  } as unknown as ExecutionContext;
}

function session(activeOrganizationId: string | null): SessionContext {
  return {
    user: { id: 'usr_1', email: 'e@x.test', name: 'n' },
    session: { id: 'ses_1', userId: 'usr_1', activeOrganizationId, expiresAt: new Date() },
  };
}

describe('RolesGuard (REST guard edge branches)', () => {
  async function guardWith(role: Promise<'owner' | 'admin' | 'member' | null>) {
    const auth = { getMemberRole: vi.fn(() => role) };
    const reflector = { getAllAndOverride: vi.fn(() => undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [RolesGuard, { provide: AuthService, useValue: auth }],
    }).compile();
    const guard = moduleRef.get(RolesGuard);
    // The unit testing module wires the real Reflector; metadata on the
    // handler stub carries the MinRole decorator payload.
    void reflector;
    return guard;
  }

  it('rejects when the session is missing (guard ordering violation)', async () => {
    const guard = await guardWith(Promise.resolve(null));
    await expect(
      guard.canActivate(execution({ hooklineSession: undefined })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects when there is no active organization', async () => {
    const guard = await guardWith(Promise.resolve(null));
    await expect(
      guard.canActivate(execution({ hooklineSession: session(null) })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects when the user is not a member of the active organization', async () => {
    const guard = await guardWith(Promise.resolve(null));
    await expect(
      guard.canActivate(execution({ hooklineSession: session('org_1') })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('attaches the role and allows any member when no minimum is set', async () => {
    const guard = await guardWith(Promise.resolve('member'));
    const request = { hooklineSession: session('org_1') } as unknown as RoleRequest;
    await expect(guard.canActivate(execution(request))).resolves.toBe(true);
    expect(request.hooklineOrgRole).toBe('member');
  });

  it('enforces the MinRole metadata via a stubbed Reflector', async () => {
    const auth = { getMemberRole: vi.fn(() => Promise.resolve<'member'>('member')) };
    const reflector = {
      getAllAndOverride: vi.fn((_: string, targets: unknown[]) => {
        // Read the metadata payload attached to the handler decorator stub.
        const handler = targets![0] as { __minRole?: 'admin' };
        return handler.__minRole ?? undefined;
      }),
    };
    const guard = new RolesGuard(reflector as never, auth as never);
    const handler = Object.assign(() => undefined, {
      __minRole: 'admin' as const,
    }) as unknown as () => { __minRole?: 'admin' };
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ hooklineSession: session('org_1') }) }),
      getHandler: () => handler,
      getClass: () => () => undefined,
    } as never;
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 403 });
    void MinRole;
  });
});
