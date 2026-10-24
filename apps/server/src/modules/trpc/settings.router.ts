import { updateOrgSettingsSchema } from '@hookline/shared';

import { minRole, router } from './trpc.js';
import { SettingsService } from '../settings/index.js';
import { tenantScope } from '../platform/database/tenant-scope.js';

/**
 * `settings` router (API.md section 3): org-level preferences (retention).
 * Updates are admin-only and audited by the service.
 */
export function createSettingsRouter(deps: { settingsService: SettingsService }) {
  const { settingsService } = deps;

  return router({
    get: minRole('admin').query(({ ctx }) => settingsService.get(tenantScope(ctx.organizationId))),

    update: minRole('admin')
      .input(updateOrgSettingsSchema)
      .mutation(({ ctx, input }) =>
        settingsService.update(
          tenantScope(ctx.organizationId),
          { retentionDays: input.retentionDays },
          { type: 'user', id: ctx.session.user.id },
        ),
      ),
  });
}
