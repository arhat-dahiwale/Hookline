import { z } from 'zod';

import { createApiKeySchema, idSchema } from '@hookline/shared';

import { minRole, router } from './trpc.js';
import { ApiKeysService, presentApiKey } from '../api-keys/index.js';
import { tenantScope } from '../platform/database/tenant-scope.js';

/**
 * `apiKeys` router (API.md section 3). The full key is returned exactly once
 * by create; list/revoke never expose secrets.
 */
export function createApiKeysRouter(deps: { apiKeysService: ApiKeysService }) {
  const { apiKeysService } = deps;

  return router({
    list: minRole('admin')
      .input(z.void().optional())
      .query(({ ctx }) =>
        apiKeysService
          .list(tenantScope(ctx.organizationId))
          .then((keys) => ({ data: keys.map(presentApiKey) })),
      ),

    create: minRole('admin')
      .input(createApiKeySchema)
      .mutation(({ ctx, input }) =>
        apiKeysService
          .create(tenantScope(ctx.organizationId), {
            name: input.name,
            scopes: input.scopes,
            createdByUserId: ctx.session.user.id,
            expiresAt: input.expiresAt ?? null,
          })
          .then((created) => ({ key: presentApiKey(created.key), secret: created.secret })),
      ),

    revoke: minRole('admin')
      .input(z.object({ id: idSchema }))
      .mutation(({ ctx, input }) =>
        apiKeysService
          .revoke(tenantScope(ctx.organizationId), input.id, ctx.session.user.id)
          .then(presentApiKey),
      ),
  });
}
