import { index, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

/** Rolled up by the maintenance job (Phase 11); table exists from Phase 3. */
export const deliveryStatsHourly = pgTable(
  'delivery_stats_hourly',
  {
    organizationId: text('organization_id').notNull(),
    endpointId: text('endpoint_id').notNull(),
    bucketStart: timestamp('bucket_start', { withTimezone: true }).notNull(),
    attemptsTotal: integer('attempts_total').notNull(),
    attemptsSucceeded: integer('attempts_succeeded').notNull(),
    attemptsFailed: integer('attempts_failed').notNull(),
    deliveriesDead: integer('deliveries_dead').notNull(),
    latencyP50Ms: integer('latency_p50_ms'),
    latencyP95Ms: integer('latency_p95_ms'),
    latencyP99Ms: integer('latency_p99_ms'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    primaryKey({
      name: 'delivery_stats_hourly_pk',
      columns: [table.organizationId, table.endpointId, table.bucketStart],
    }),
    index('delivery_stats_hourly_bucket_idx').on(table.bucketStart),
  ],
);
