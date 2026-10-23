import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const events = pgTable(
  'events',
  {
    id: text().primaryKey(),
    organizationId: text('organization_id').notNull(),
    type: text().notNull(),
    payload: jsonb().notNull(),
    payloadHash: text('payload_hash').notNull(),
    idempotencyKey: text('idempotency_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('events_org_idem_uidx')
      .on(table.organizationId, table.idempotencyKey)
      .where(sql`idempotency_key is not null`),
    index('events_org_created_idx').on(
      table.organizationId,
      sql`${table.createdAt} desc`,
      sql`${table.id} desc`,
    ),
    index('events_org_type_created_idx').on(
      table.organizationId,
      table.type,
      sql`${table.createdAt} desc`,
    ),
  ],
);
