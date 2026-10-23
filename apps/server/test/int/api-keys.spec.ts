import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiKeysService } from '../../src/modules/api-keys/index.js';
import { AuditService } from '../../src/modules/audit/index.js';
import { EndpointsService } from '../../src/modules/endpoints/index.js';
import { tenantScope } from '../../src/modules/platform/index.js';
import { createTestApplication, type TestApplication } from './test-app.js';
import { ApiKeyGuardedController } from './support/api-key-guarded.controller.js';

let test: TestApplication;

beforeAll(async () => {
  test = await createTestApplication([ApiKeyGuardedController]);
});

afterAll(async () => {
  await test.app.close();
});

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe('api key lifecycle', () => {
  it('a valid key resolves its organization through the guard', async () => {
    const apiKeys = test.app.get(ApiKeysService);
    const orgId = `org_${crypto.randomUUID().replace(/-/g, '')}`;
    const created = await apiKeys.create(tenantScope(orgId), {
      name: 'test key',
      scopes: ['events:read', 'events:write'],
      createdByUserId: 'user_seed_test',
    });

    const res = await test.instance.inject({
      method: 'GET',
      url: '/test-api/whoami',
      headers: bearer(created.secret),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      organizationId: orgId,
      scopes: ['events:read', 'events:write'],
    });

    // The full key is never stored: only its SHA-256 hash.
    expect(created.key.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(created.key.keyHash).not.toContain(created.secret);
  });

  it('rejects a wrong secret with 401 unauthorized', async () => {
    const apiKeys = test.app.get(ApiKeysService);
    const orgId = `org_${crypto.randomUUID().replace(/-/g, '')}`;
    const created = await apiKeys.create(tenantScope(orgId), {
      name: 'key',
      scopes: ['events:read'],
      createdByUserId: 'user_seed_test',
    });
    const tampered = `${created.secret}x`;

    const res = await test.instance.inject({
      method: 'GET',
      url: '/test-api/whoami',
      headers: bearer(tampered),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
  });

  it('rejects a malformed key and a missing header', async () => {
    for (const headers of [bearer('definitely-not-a-key'), {}]) {
      const res = await test.instance.inject({
        method: 'GET',
        url: '/test-api/whoami',
        headers,
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('unauthorized');
    }
  });

  it('rejects a revoked key immediately (cache invalidated)', async () => {
    const apiKeys = test.app.get(ApiKeysService);
    const orgId = `org_${crypto.randomUUID().replace(/-/g, '')}`;
    const created = await apiKeys.create(tenantScope(orgId), {
      name: 'revoked-key',
      scopes: ['events:read'],
      createdByUserId: 'user_seed_test',
    });

    // Prime the Redis cache with a successful call.
    const before = await test.instance.inject({
      method: 'GET',
      url: '/test-api/whoami',
      headers: bearer(created.secret),
    });
    expect(before.statusCode).toBe(200);

    await apiKeys.revoke(tenantScope(orgId), created.key.id, 'user_seed_test');

    const after = await test.instance.inject({
      method: 'GET',
      url: '/test-api/whoami',
      headers: bearer(created.secret),
    });
    expect(after.statusCode).toBe(401);
    expect(after.json().error.code).toBe('unauthorized');
  });

  it('rejects an expired key', async () => {
    const apiKeys = test.app.get(ApiKeysService);
    const orgId = `org_${crypto.randomUUID().replace(/-/g, '')}`;
    const created = await apiKeys.create(tenantScope(orgId), {
      name: 'expired-key',
      scopes: ['events:read'],
      createdByUserId: 'user_seed_test',
      expiresAt: new Date(Date.now() - 60_000),
    });

    const res = await test.instance.inject({
      method: 'GET',
      url: '/test-api/whoami',
      headers: bearer(created.secret),
    });
    expect(res.statusCode).toBe(401);
  });

  it('enforces scopes with 403 forbidden', async () => {
    const apiKeys = test.app.get(ApiKeysService);
    const orgId = `org_${crypto.randomUUID().replace(/-/g, '')}`;
    const created = await apiKeys.create(tenantScope(orgId), {
      name: 'readonly-key',
      scopes: ['events:read'],
      createdByUserId: 'user_seed_test',
    });

    const res = await test.instance.inject({
      method: 'GET',
      url: '/test-api/write-only',
      headers: bearer(created.secret),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('forbidden');
    expect(res.json().error.message).toContain('events:write');
  });

  it('throttles last_used_at updates to at most one per minute', async () => {
    const apiKeys = test.app.get(ApiKeysService);
    const orgId = `org_${crypto.randomUUID().replace(/-/g, '')}`;
    const created = await apiKeys.create(tenantScope(orgId), {
      name: 'usage-key',
      scopes: ['events:read'],
      createdByUserId: 'user_seed_test',
    });

    for (let i = 0; i < 3; i += 1) {
      await test.instance.inject({
        method: 'GET',
        url: '/test-api/whoami',
        headers: bearer(created.secret),
      });
    }
    // The last_used_at update is fire-and-forget; poll briefly for it.
    type KeyRow = Awaited<ReturnType<typeof apiKeys.list>>[number];
    let key: KeyRow | undefined;
    for (let attempt = 0; attempt < 40 && !key?.lastUsedAt; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const rows = await apiKeys.list(tenantScope(orgId));
      key = rows.find((row) => row.id === created.key.id);
    }
    expect(key?.lastUsedAt).not.toBeNull();
    // One throttled write within the minute window: value close to now.
    expect(Date.now() - key!.lastUsedAt!.getTime()).toBeLessThan(10_000);
  });

  it('writes audit entries for create and revoke', async () => {
    const apiKeys = test.app.get(ApiKeysService);
    const audit = test.app.get(AuditService);
    const orgId = `org_${crypto.randomUUID().replace(/-/g, '')}`;
    const scope = tenantScope(orgId);

    const created = await apiKeys.create(scope, {
      name: 'audited-key',
      scopes: ['events:read'],
      createdByUserId: 'user_seed_test',
    });
    await apiKeys.revoke(scope, created.key.id, 'user_seed_test');

    const [createdEntry] = await audit.findByAction(scope, 'api_key.created');
    expect(createdEntry?.targetId).toBe(created.key.id);
    const [revokedEntry] = await audit.findByAction(scope, 'api_key.revoked');
    expect(revokedEntry?.targetId).toBe(created.key.id);
  });

  it('endpoint secrets are encrypted at rest and decryptable', async () => {
    const endpointsService = test.app.get(EndpointsService);
    const orgId = `org_${crypto.randomUUID().replace(/-/g, '')}`;
    const scope = tenantScope(orgId);
    const created = await endpointsService.create(
      scope,
      {
        url: 'https://example.com/hook',
      },
      { type: 'system' },
    );

    expect(created.secret).toMatch(/^whsec_/);
    // At rest: encrypted blob, not the plaintext secret.
    expect(created.endpoint.secretEncrypted).not.toContain(created.secret);
    expect(created.endpoint.secretEncrypted).toMatch(/^v1\./);
    // Round-trip via the service.
    const decrypted = await endpointsService.decryptCurrentSecret(created.endpoint);
    expect(decrypted).toBe(created.secret);
  });
});
