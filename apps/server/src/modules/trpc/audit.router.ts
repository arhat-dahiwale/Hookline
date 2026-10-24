import { z } from 'zod';

import { minRole, router } from './trpc.js';
import { AuditService } from '../audit/index.js';
import { tenantScope } from '../platform/database/tenant-scope.js';

function presentEntry(entry: {
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  createdAt: Date;
}) {
  return {
    id: entry.id,
    actorType: entry.actorType,
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    metadata: entry.metadata,
    createdAt: entry.createdAt.toISOString(),
  };
}

/**
 * `audit` router (API.md section 3, role A): the settings page audit log.
 */
export function createAuditRouter(deps: { auditService: AuditService }) {
  const { auditService } = deps;

  return router({
    list: minRole('admin')
      .input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional())
      .query(({ ctx, input }) =>
        auditService
          .list(tenantScope(ctx.organizationId), input?.limit ?? 50)
          .then((entries) => ({ data: entries.map(presentEntry) })),
      ),
  });
}
