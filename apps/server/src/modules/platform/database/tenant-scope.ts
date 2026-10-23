import { eq } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

import { forbidden } from '../errors/app-error.js';

/**
 * Tenant scoping (AGENTS.md hard rule): every query against a tenant-owned
 * table must filter by organization_id. Repositories accept a TenantScope
 * and use `.whereColumn(table.organizationId)` instead of hand-building the
 * condition, so a missing scope fails loudly instead of leaking rows.
 */
export class TenantScope {
  constructor(readonly organizationId: string) {
    if (!organizationId || organizationId.trim() === '') {
      throw forbidden('missing organization scope');
    }
  }

  /** Condition for a table's organization_id column. */
  whereColumn(column: PgColumn): ReturnType<typeof eq> {
    return eq(column, this.organizationId);
  }
}

export function tenantScope(organizationId: string | null | undefined): TenantScope {
  return new TenantScope(organizationId ?? '');
}
