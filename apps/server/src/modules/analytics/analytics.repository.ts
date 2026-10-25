import { Injectable } from '@nestjs/common';

import { and, eq, gte, lte, sql } from 'drizzle-orm';

import { DatabaseService } from '../platform/database/database.service.js';
import { TenantScope } from '../platform/database/tenant-scope.js';
import { deliveryStatsHourly } from './analytics.schema.js';

export type StatsHourlyRow = typeof deliveryStatsHourly.$inferSelect;

export interface RollupBucket {
  organizationId: string;
  endpointId: string;
  bucketStart: Date;
  attemptsTotal: number;
  attemptsSucceeded: number;
  attemptsFailed: number;
  deliveriesDead: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  latencyP99Ms: number | null;
}

export interface OverviewStats {
  events: number;
  deliveries: number;
  attempts: number;
  succeeded: number;
  failed: number;
  dead: number;
  successRate: number | null;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  latencyP99Ms: number | null;
}

export interface TimeseriesPoint {
  bucketStart: string;
  attempts: number;
  succeeded: number;
  failed: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  latencyP99Ms: number | null;
}

export interface EndpointBreakdownRow {
  endpointId: string;
  url: string;
  status: string;
  breakerState: string;
  attempts: number;
  succeeded: number;
  failed: number;
  dead: number;
  successRate: number | null;
  latencyP95Ms: number | null;
}

/**
 * Stats read model. The hourly rollup lives in `delivery_stats_hourly`
 * (idempotent full recompute of affected buckets from raw attempts); the
 * stats.* queries aggregate the raw tables directly so they are always
 * accurate for the requested window.
 */
@Injectable()
export class AnalyticsRepository {
  constructor(private readonly database: DatabaseService) {}

  async upsertBucket(row: Omit<StatsHourlyRow, 'updatedAt'>): Promise<void> {
    await this.database.db
      .insert(deliveryStatsHourly)
      .values(row)
      .onConflictDoUpdate({
        target: [
          deliveryStatsHourly.organizationId,
          deliveryStatsHourly.endpointId,
          deliveryStatsHourly.bucketStart,
        ],
        set: {
          attemptsTotal: row.attemptsTotal,
          attemptsSucceeded: row.attemptsSucceeded,
          attemptsFailed: row.attemptsFailed,
          deliveriesDead: row.deliveriesDead,
          latencyP50Ms: row.latencyP50Ms,
          latencyP95Ms: row.latencyP95Ms,
          latencyP99Ms: row.latencyP99Ms,
        },
      });
  }

  async findBuckets(scope: TenantScope, endpointId: string): Promise<StatsHourlyRow[]> {
    return this.database.db
      .select()
      .from(deliveryStatsHourly)
      .where(
        and(
          scope.whereColumn(deliveryStatsHourly.organizationId),
          eq(deliveryStatsHourly.endpointId, endpointId),
        ),
      );
  }

  /**
   * Recomputes hourly buckets from raw data: attempts aggregates with
   * percentile latencies, plus dead-delivery counts by completion time.
   * Idempotent — the same raw rows always produce the same bucket values.
   * The dead-delivery pass ADDS to the existing count (the attempts pass
   * resets the other columns of the same bucket).
   */
  async rollupWindow(from: Date, to: Date): Promise<number> {
    const attemptsResult = await this.database.db.execute(sql`
      INSERT INTO delivery_stats_hourly
        (organization_id, endpoint_id, bucket_start, attempts_total, attempts_succeeded,
         attempts_failed, deliveries_dead, latency_p50_ms, latency_p95_ms, latency_p99_ms, updated_at)
      SELECT
        d.organization_id,
        d.endpoint_id,
        date_trunc('hour', a.started_at) AS bucket_start,
        count(*)::int,
        count(*) FILTER (WHERE a.outcome = 'success')::int,
        count(*) FILTER (WHERE a.outcome <> 'success')::int,
        0,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY a.duration_ms)::int,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY a.duration_ms)::int,
        percentile_cont(0.99) WITHIN GROUP (ORDER BY a.duration_ms)::int,
        now()
      FROM delivery_attempts a
      JOIN deliveries d ON d.id = a.delivery_id
      WHERE a.started_at >= ${from.toISOString()} AND a.started_at < ${to.toISOString()}
      GROUP BY d.organization_id, d.endpoint_id, bucket_start
      ON CONFLICT (organization_id, endpoint_id, bucket_start) DO UPDATE SET
        attempts_total = EXCLUDED.attempts_total,
        attempts_succeeded = EXCLUDED.attempts_succeeded,
        attempts_failed = EXCLUDED.attempts_failed,
        deliveries_dead = 0,
        latency_p50_ms = EXCLUDED.latency_p50_ms,
        latency_p95_ms = EXCLUDED.latency_p95_ms,
        latency_p99_ms = EXCLUDED.latency_p99_ms,
        updated_at = now()
    `);

    const deadResult = await this.database.db.execute(sql`
      INSERT INTO delivery_stats_hourly
        (organization_id, endpoint_id, bucket_start, attempts_total, attempts_succeeded,
         attempts_failed, deliveries_dead, updated_at)
      SELECT
        d.organization_id,
        d.endpoint_id,
        date_trunc('hour', d.completed_at) AS bucket_start,
        0, 0, 0,
        count(*)::int,
        now()
      FROM deliveries d
      WHERE d.status = 'dead'
        AND d.completed_at >= ${from.toISOString()} AND d.completed_at < ${to.toISOString()}
      GROUP BY d.organization_id, d.endpoint_id, bucket_start
      ON CONFLICT (organization_id, endpoint_id, bucket_start) DO UPDATE SET
        deliveries_dead = delivery_stats_hourly.deliveries_dead + EXCLUDED.deliveries_dead,
        updated_at = now()
    `);

    const rowCount = (result: unknown): number => {
      const raw = result as { rowCount?: number };
      return raw.rowCount ?? 0;
    };
    return rowCount(attemptsResult) + rowCount(deadResult);
  }

  /** Window of buckets written by the last rollup (observability/tests). */
  async rollupWindowBuckets(scope: TenantScope, from: Date, to: Date): Promise<StatsHourlyRow[]> {
    return this.database.db
      .select()
      .from(deliveryStatsHourly)
      .where(
        and(
          scope.whereColumn(deliveryStatsHourly.organizationId),
          gte(deliveryStatsHourly.bucketStart, from),
          lte(deliveryStatsHourly.bucketStart, to),
        ),
      );
  }

  async overview(scope: TenantScope, from: Date, to: Date): Promise<OverviewStats> {
    const result = await this.database.db.execute(sql`
      WITH window_deliveries AS (
        SELECT * FROM deliveries d
        WHERE d.organization_id = ${scope.organizationId}
          AND d.created_at >= ${from.toISOString()} AND d.created_at < ${to.toISOString()}
      ),
      window_attempts AS (
        SELECT a.* FROM delivery_attempts a
        JOIN window_deliveries wd ON wd.id = a.delivery_id
      )
      SELECT
        (SELECT count(*)::int FROM events e
          WHERE e.organization_id = ${scope.organizationId}
            AND e.created_at >= ${from.toISOString()} AND e.created_at < ${to.toISOString()}) AS events,
        (SELECT count(*)::int FROM window_deliveries) AS deliveries,
        (SELECT count(*)::int FROM window_attempts) AS attempts,
        (SELECT count(*)::int FROM window_attempts WHERE outcome = 'success') AS succeeded,
        (SELECT count(*)::int FROM window_attempts WHERE outcome <> 'success') AS failed,
        (SELECT count(*)::int FROM window_deliveries WHERE status = 'dead') AS dead,
        (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::int FROM window_attempts) AS p50,
        (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::int FROM window_attempts) AS p95,
        (SELECT percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms)::int FROM window_attempts) AS p99
    `);
    const row = (result.rows as Record<string, number | null>[])[0];
    const attempts = row?.attempts ?? 0;
    const succeeded = row?.succeeded ?? 0;
    return {
      events: row?.events ?? 0,
      deliveries: row?.deliveries ?? 0,
      attempts,
      succeeded,
      failed: row?.failed ?? 0,
      dead: row?.dead ?? 0,
      successRate: attempts > 0 ? succeeded / attempts : null,
      latencyP50Ms: row?.p50,
      latencyP95Ms: row?.p95,
      latencyP99Ms: row?.p99,
    };
  }

  async timeseries(scope: TenantScope, from: Date, to: Date): Promise<TimeseriesPoint[]> {
    const result = await this.database.db.execute(sql`
      SELECT
        date_trunc('hour', a.started_at) AS bucket_start,
        count(*)::int AS attempts,
        count(*) FILTER (WHERE a.outcome = 'success')::int AS succeeded,
        count(*) FILTER (WHERE a.outcome <> 'success')::int AS failed,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY a.duration_ms)::int AS p50,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY a.duration_ms)::int AS p95,
        percentile_cont(0.99) WITHIN GROUP (ORDER BY a.duration_ms)::int AS p99
      FROM delivery_attempts a
      JOIN deliveries d ON d.id = a.delivery_id
      WHERE d.organization_id = ${scope.organizationId}
        AND a.started_at >= ${from.toISOString()} AND a.started_at < ${to.toISOString()}
      GROUP BY bucket_start
      ORDER BY bucket_start ASC
    `);
    return (
      result.rows as {
        bucket_start: Date | string;
        attempts: number;
        succeeded: number;
        failed: number;
        p50: number | null;
        p95: number | null;
        p99: number | null;
      }[]
    ).map((row) => ({
      bucketStart: new Date(row.bucket_start).toISOString(),
      attempts: row.attempts,
      succeeded: row.succeeded,
      failed: row.failed,
      latencyP50Ms: row.p50,
      latencyP95Ms: row.p95,
      latencyP99Ms: row.p99,
    }));
  }

  async endpointBreakdown(
    scope: TenantScope,
    from: Date,
    to: Date,
  ): Promise<EndpointBreakdownRow[]> {
    const result = await this.database.db.execute(sql`
      SELECT
        e.id AS endpoint_id,
        e.url AS url,
        e.status AS status,
        COALESCE(h.state, 'closed') AS breaker_state,
        count(a.id)::int AS attempts,
        count(*) FILTER (WHERE a.outcome = 'success')::int AS succeeded,
        count(*) FILTER (WHERE a.outcome <> 'success')::int AS failed,
        (SELECT count(*)::int FROM deliveries dd
          WHERE dd.endpoint_id = e.id AND dd.status = 'dead'
            AND dd.completed_at >= ${from.toISOString()} AND dd.completed_at < ${to.toISOString()}) AS dead,
        CASE WHEN count(a.id) > 0
          THEN (count(*) FILTER (WHERE a.outcome = 'success'))::float / count(a.id)::float
          ELSE NULL END AS success_rate,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY a.duration_ms)::int AS p95
      FROM endpoints e
      LEFT JOIN endpoint_health h ON h.endpoint_id = e.id
      LEFT JOIN deliveries d ON d.endpoint_id = e.id
        AND d.created_at >= ${from.toISOString()} AND d.created_at < ${to.toISOString()}
      LEFT JOIN delivery_attempts a ON a.delivery_id = d.id
        AND a.started_at >= ${from.toISOString()} AND a.started_at < ${to.toISOString()}
      WHERE e.organization_id = ${scope.organizationId} AND e.deleted_at IS NULL
      GROUP BY e.id, e.url, e.status, h.state
      ORDER BY attempts DESC
    `);
    return (
      result.rows as {
        endpoint_id: string;
        url: string;
        status: string;
        breaker_state: string;
        attempts: number;
        succeeded: number;
        failed: number;
        dead: number;
        success_rate: number | null;
        p95: number | null;
      }[]
    ).map((row) => ({
      endpointId: row.endpoint_id,
      url: row.url,
      status: row.status,
      breakerState: row.breaker_state,
      attempts: row.attempts,
      succeeded: row.succeeded,
      failed: row.failed,
      dead: row.dead,
      successRate: row.success_rate,
      latencyP95Ms: row.p95,
    }));
  }
}
