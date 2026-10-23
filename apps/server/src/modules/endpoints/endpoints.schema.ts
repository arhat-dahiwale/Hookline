import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const endpointStatusEnum = pgEnum('endpoint_status', ['active', 'disabled']);

export const breakerStateEnum = pgEnum('breaker_state', ['closed', 'open', 'half_open']);

export const endpoints = pgTable(
  'endpoints',
  {
    id: text().primaryKey(),
    organizationId: text('organization_id').notNull(),
    url: text().notNull(),
    description: text(),
    secretEncrypted: text('secret_encrypted').notNull(),
    previousSecretEncrypted: text('previous_secret_encrypted'),
    previousSecretExpiresAt: timestamp('previous_secret_expires_at', { withTimezone: true }),
    status: endpointStatusEnum().notNull().default('active'),
    disabledReason: text('disabled_reason'),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    eventTypes: text('event_types').array().notNull().default([]),
    timeoutMs: integer('timeout_ms').notNull().default(10_000),
    maxAttempts: integer('max_attempts').notNull().default(8),
    rateLimitPerSecond: integer('rate_limit_per_second').notNull().default(10),
    metadata: jsonb().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('endpoints_org_idx')
      .on(table.organizationId)
      .where(sql`deleted_at is null`),
    index('endpoints_org_status_idx').on(table.organizationId, table.status),
  ],
);

export const endpointHealth = pgTable('endpoint_health', {
  endpointId: text('endpoint_id')
    .primaryKey()
    .references(() => endpoints.id, { onDelete: 'cascade' }),
  state: breakerStateEnum().notNull().default('closed'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  openedAt: timestamp('opened_at', { withTimezone: true }),
  lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastProbeAt: timestamp('last_probe_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
