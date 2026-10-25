import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';

import { BULLMQ_PREFIX, MAINTENANCE_QUEUE_NAME } from '../delivery-queue/index.js';
import { APP_CONFIG, type AppConfig } from '../platform/config/app-config.js';
import { RedisService } from '../platform/redis/redis.service.js';
import type { TenantScope } from '../platform/database/tenant-scope.js';
import { EventsService } from '../events/index.js';
import { SettingsRepository } from '../settings/index.js';
import type {
  EndpointBreakdownRow,
  OverviewStats,
  TimeseriesPoint,
} from './analytics.repository.js';
import { AnalyticsRepository } from './analytics.repository.js';

const SCHEDULER_INTERVAL_MS = 5 * 60_000;
const RETENTION_INTERVAL_MS = 60 * 60_000;
const RETENTION_BATCH_SIZE = 500;
const RETENTION_MAX_BATCHES_PER_RUN = 20;
const ROLLUP_WINDOW_HOURS = 6;

export interface StatsWindow {
  from: Date;
  to: Date;
}

/**
 * Analytics service (Phase 11): hourly rollups into `delivery_stats_hourly`
 * and batched retention cleanup, both on BullMQ job schedulers on the shared
 * maintenance queue (single firing across replicas), plus stats queries over
 * the raw tables.
 */
@Injectable()
export class AnalyticsService implements OnApplicationShutdown {
  private readonly logger = new Logger(AnalyticsService.name);
  private queue: Queue<{ task: 'stats-rollup' | 'retention-cleanup' }> | undefined;
  private worker: Worker<{ task: 'stats-rollup' | 'retention-cleanup' }> | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly repository: AnalyticsRepository,
    private readonly eventsService: EventsService,
    private readonly settingsRepository: SettingsRepository,
    private readonly redis: RedisService,
  ) {}

  /** Registers the BullMQ schedulers and worker (worker/all roles only). */
  async start(): Promise<void> {
    if (this.queue) return;
    this.queue = new Queue<{ task: 'stats-rollup' | 'retention-cleanup' }>(MAINTENANCE_QUEUE_NAME, {
      prefix: BULLMQ_PREFIX,
      connection: this.redis.duplicateForBullMq(),
    });
    await this.queue.upsertJobScheduler(
      'stats-rollup',
      { every: SCHEDULER_INTERVAL_MS },
      { data: { task: 'stats-rollup' } },
    );
    await this.queue.upsertJobScheduler(
      'retention-cleanup',
      { every: RETENTION_INTERVAL_MS },
      { data: { task: 'retention-cleanup' } },
    );

    this.worker = new Worker<{ task: 'stats-rollup' | 'retention-cleanup' }>(
      MAINTENANCE_QUEUE_NAME,
      (job: Job<{ task: 'stats-rollup' | 'retention-cleanup' }>) => this.handleJob(job),
      {
        prefix: BULLMQ_PREFIX,
        connection: this.redis.duplicateForBullMq(),
        concurrency: 1,
      },
    );
    this.logger.log('analytics schedulers started (stats-rollup, retention-cleanup)');
  }

  private async handleJob(job: Job<{ task: 'stats-rollup' | 'retention-cleanup' }>): Promise<void> {
    if (job.data.task === 'stats-rollup') {
      const buckets = await this.runRollup();
      this.logger.log(`stats rollup wrote ${buckets} bucket upsert(s)`);
      return;
    }
    const deleted = await this.runRetentionCleanup();
    if (deleted > 0) {
      this.logger.log(`retention cleanup deleted ${deleted} event(s)`);
    }
  }

  /**
   * Recomputes the recent window (covers the scheduler interval plus late
   * attempts; idempotent). Returns the number of bucket upserts.
   */
  async runRollup(): Promise<number> {
    const to = new Date();
    const from = new Date(to.getTime() - ROLLUP_WINDOW_HOURS * 3_600_000);
    return this.repository.rollupWindow(from, to);
  }

  /**
   * Deletes events older than the effective retention per organization
   * (override from org settings, else RETENTION_DAYS) in bounded batches.
   * Deliveries and attempts cascade via FKs. Returns the total deleted.
   */
  async runRetentionCleanup(): Promise<number> {
    const overrides = new Map(
      (await this.settingsRepository.listAll()).map(
        (row) => [row.organizationId, row.retentionDays] as const,
      ),
    );

    let total = 0;
    for (const [organizationId, retentionDays] of overrides) {
      total += await this.cleanupOrg(organizationId, retentionDays);
    }
    // The global default covers orgs without an override row.
    for (const organizationId of await this.eventsService.listDistinctOrgIds()) {
      if (overrides.has(organizationId)) continue;
      total += await this.cleanupOrg(organizationId, null);
    }
    return total;
  }

  private async cleanupOrg(organizationId: string, retentionDays: number | null): Promise<number> {
    const effective = retentionDays ?? this.config.RETENTION_DAYS;
    if (effective <= 0) return 0;
    const cutoff = new Date(Date.now() - effective * 86_400_000);
    let deleted = 0;
    for (let batch = 0; batch < RETENTION_MAX_BATCHES_PER_RUN; batch += 1) {
      const count = await this.eventsService.deleteOlderThan(
        organizationId,
        cutoff,
        RETENTION_BATCH_SIZE,
      );
      deleted += count;
      if (count < RETENTION_BATCH_SIZE) break;
    }
    return deleted;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  async overview(scope: TenantScope, window: StatsWindow): Promise<OverviewStats> {
    return this.repository.overview(scope, window.from, window.to);
  }

  async timeseries(scope: TenantScope, window: StatsWindow): Promise<TimeseriesPoint[]> {
    return this.repository.timeseries(scope, window.from, window.to);
  }

  async endpointBreakdown(
    scope: TenantScope,
    window: StatsWindow,
  ): Promise<EndpointBreakdownRow[]> {
    return this.repository.endpointBreakdown(scope, window.from, window.to);
  }
}
