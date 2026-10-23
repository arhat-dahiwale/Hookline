import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { endpoints } from '../endpoints/endpoints.schema.js';
import { events } from '../events/events.schema.js';

export const deliveryStatusEnum = pgEnum('delivery_status', [
  'pending',
  'in_progress',
  'retrying',
  'succeeded',
  'dead',
  'cancelled',
]);

export const attemptOutcomeEnum = pgEnum('attempt_outcome', [
  'success',
  'http_error',
  'timeout',
  'network_error',
  'blocked',
]);

export const deliveries = pgTable(
  'deliveries',
  {
    id: text().primaryKey(),
    organizationId: text('organization_id').notNull(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    endpointId: text('endpoint_id')
      .notNull()
      .references(() => endpoints.id),
    replayOfDeliveryId: text('replay_of_delivery_id'),
    status: deliveryStatusEnum().notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull(),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    lastResponseStatus: integer('last_response_status'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('deliveries_event_endpoint_uidx')
      .on(table.eventId, table.endpointId)
      .where(sql`replay_of_delivery_id is null`),
    index('deliveries_org_created_idx').on(
      table.organizationId,
      sql`${table.createdAt} desc`,
      sql`${table.id} desc`,
    ),
    index('deliveries_endpoint_created_idx').on(table.endpointId, sql`${table.createdAt} desc`),
    index('deliveries_org_status_created_idx').on(
      table.organizationId,
      table.status,
      sql`${table.createdAt} desc`,
    ),
    index('deliveries_pending_idx')
      .on(table.createdAt)
      .where(sql`status = 'pending'`),
    index('deliveries_retrying_idx')
      .on(table.nextAttemptAt)
      .where(sql`status = 'retrying'`),
  ],
);

export const deliveryAttempts = pgTable(
  'delivery_attempts',
  {
    id: text().primaryKey(),
    deliveryId: text('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').notNull(),
    endpointId: text('endpoint_id').notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    outcome: attemptOutcomeEnum().notNull(),
    requestHeaders: jsonb().notNull(),
    responseStatus: integer('response_status'),
    responseHeaders: jsonb(),
    responseBodySnippet: text('response_body_snippet'),
    errorMessage: text('error_message'),
    durationMs: integer('duration_ms'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('delivery_attempts_delivery_number_uidx').on(table.deliveryId, table.attemptNumber),
    index('delivery_attempts_org_started_idx').on(
      table.organizationId,
      sql`${table.startedAt} desc`,
    ),
    index('delivery_attempts_endpoint_started_idx').on(
      table.endpointId,
      sql`${table.startedAt} desc`,
    ),
  ],
);
