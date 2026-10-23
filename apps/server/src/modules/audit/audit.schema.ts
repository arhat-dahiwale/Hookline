import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: text().primaryKey(),
    organizationId: text('organization_id').notNull(),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id'),
    action: text().notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    metadata: jsonb().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_logs_org_created_idx').on(table.organizationId, sql`${table.createdAt} desc`),
  ],
);
