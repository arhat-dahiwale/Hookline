import { Injectable } from '@nestjs/common';

import { and, eq } from 'drizzle-orm';

import { DatabaseService } from '../platform/database/database.service.js';
import { TenantScope } from '../platform/database/tenant-scope.js';
import { deliveryStatsHourly } from './analytics.schema.js';

export type StatsHourlyRow = typeof deliveryStatsHourly.$inferSelect;

/** Rollups and stats queries land in Phase 11; ownership established here. */
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
}
