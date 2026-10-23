import { describe, expect, it } from 'vitest';
import { index, pgTable, text } from 'drizzle-orm/pg-core';

import { AppError } from '../errors/app-error.js';
import { tenantScope } from './tenant-scope.js';

// A stand-in tenant-owned table (the real ones live in feature modules).
const example = pgTable(
  'example_tenant_rows',
  {
    id: text().primaryKey(),
    organizationId: text('organization_id').notNull(),
  },
  (table) => [index('example_org_idx').on(table.organizationId)],
);

describe('TenantScope', () => {
  it('builds an equality condition on the organization column', () => {
    const scope = tenantScope('org_01ABC');
    const condition = scope.whereColumn(example.organizationId);
    expect(condition).toBeDefined();
  });

  it('rejects empty or missing organization ids loudly', () => {
    expect(() => tenantScope('')).toThrow(AppError);
    expect(() => tenantScope(null)).toThrow(/missing organization scope/);
    expect(() => tenantScope('   ')).toThrow(AppError);
  });
});
