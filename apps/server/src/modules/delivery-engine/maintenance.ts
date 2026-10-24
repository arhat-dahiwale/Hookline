import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';

import {
  BULLMQ_PREFIX,
  DeliveryQueue,
  deliveryJobId,
  MAINTENANCE_QUEUE_NAME,
} from '../delivery-queue/index.js';
import { RedisService } from '../platform/redis/redis.service.js';
import { DeliveriesRepository } from '../deliveries/index.js';
import { EndpointsRepository, EndpointsService } from '../endpoints/index.js';
import { tenantScope } from '../platform/database/tenant-scope.js';
import { BREAKER_24H_MS, CircuitBreakerService } from './breaker.js';

/** Pending deliveries older than this without a live job are re-enqueued. */
const PENDING_GRACE_MS = 60_000;
/** Retry jobs overdue by this much are considered lost and re-enqueued. */
const RETRY_GRACE_MS = 15_000;
const RECONCILER_INTERVAL_MS = 30_000;
const SWEEP_INTERVAL_MS = 30_000;
const BATCH_LIMIT = 200;

interface MaintenanceJobData {
  task: 'reconcile' | 'breaker-sweep';
}

/**
 * Maintenance jobs (worker role only, ARCHITECTURE.md 6.5 + 7.1): the
 * reconciler heals persisted-but-never-enqueued deliveries and lost retry
 * jobs; the breaker sweep auto-disables endpoints that stayed open 24h.
 * Schedules are registered as BullMQ job schedulers so many worker
 * replicas produce a single firing.
 */
@Injectable()
export class MaintenanceService implements OnApplicationShutdown {
  private readonly logger = new Logger(MaintenanceService.name);
  private queue: Queue<MaintenanceJobData> | undefined;
  private worker: Worker<MaintenanceJobData> | undefined;

  constructor(
    private readonly redisService: RedisService,
    private readonly deliveriesRepository: DeliveriesRepository,
    private readonly endpointsRepository: EndpointsRepository,
    private readonly endpointsService: EndpointsService,
    private readonly deliveryQueue: DeliveryQueue,
    private readonly breaker: CircuitBreakerService,
  ) {}

  async start(): Promise<void> {
    this.queue = new Queue<MaintenanceJobData>(MAINTENANCE_QUEUE_NAME, {
      prefix: BULLMQ_PREFIX,
      connection: this.redisService.duplicateForBullMq(),
    });
    // Idempotent across replicas: the scheduler key dedupes.
    await this.queue.upsertJobScheduler(
      'reconciler',
      { every: RECONCILER_INTERVAL_MS },
      { data: { task: 'reconcile' } },
    );
    await this.queue.upsertJobScheduler(
      'breaker-sweep',
      { every: SWEEP_INTERVAL_MS },
      { data: { task: 'breaker-sweep' } },
    );

    this.worker = new Worker<MaintenanceJobData>(
      MAINTENANCE_QUEUE_NAME,
      async (job: Job<MaintenanceJobData>) => {
        if (job.data.task === 'reconcile') {
          await this.runReconciler();
        } else {
          await this.runBreakerSweep();
        }
      },
      {
        prefix: BULLMQ_PREFIX,
        connection: this.redisService.duplicateForBullMq(),
        concurrency: 1,
      },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(`maintenance job ${job?.name ?? '?'} failed: ${error.message}`);
    });
    this.logger.log('maintenance schedulers started (reconciler, breaker-sweep)');
  }

  /** Reconciler: heal pending deliveries without live jobs (ARCH 6.5). */
  async runReconciler(): Promise<number> {
    let healed = 0;

    const stalePending = await this.deliveriesRepository.findStalePending(
      new Date(Date.now() - PENDING_GRACE_MS),
      BATCH_LIMIT,
    );
    for (const delivery of stalePending) {
      if (await this.deliveryQueue.hasLiveJob(delivery.id, 1)) continue;
      await this.deliveryQueue.enqueueAttempt({
        id: delivery.id,
        organizationId: delivery.organizationId,
        attemptCount: delivery.attemptCount,
        status: delivery.status,
      });
      healed += 1;
    }

    const overdueRetrying = await this.deliveriesRepository.findOverdueRetrying(
      new Date(Date.now() - RETRY_GRACE_MS),
      BATCH_LIMIT,
    );
    for (const delivery of overdueRetrying) {
      const nextAttempt = delivery.attemptCount + 1;
      if (await this.deliveryQueue.hasLiveJob(delivery.id, nextAttempt)) continue;
      // Avoid duplicate completed jobIds: BullMQ keeps completed jobs with
      // the same id; removing first guarantees the re-add lands.
      await this.deliveryQueue.queue
        .getJob(deliveryJobId(delivery.id, nextAttempt))
        .then((job) => (job ? job.remove().catch(() => undefined) : undefined));
      await this.deliveryQueue.enqueueAttempt(
        {
          id: delivery.id,
          organizationId: delivery.organizationId,
          attemptCount: delivery.attemptCount,
          status: delivery.status,
        },
        { delayMs: 0 },
      );
      healed += 1;
    }

    if (healed > 0) {
      this.logger.log(`reconciler healed ${healed} delivery job(s)`);
    }
    return healed;
  }

  /** Auto-disable endpoints whose breaker stayed open for 24h (ARCH 6.3). */
  async runBreakerSweep(): Promise<string[]> {
    const endpointIds = await this.breaker.findSustainedOpen(BREAKER_24H_MS);
    const disabled: string[] = [];
    for (const endpointId of endpointIds) {
      const endpoint = await this.endpointsRepository.findByIdUnscoped(endpointId);
      if (!endpoint || endpoint.deletedAt || endpoint.status !== 'active') continue;
      try {
        await this.endpointsService.setStatus(
          tenantScope(endpoint.organizationId),
          endpointId,
          'disabled',
          'circuit_breaker',
          { type: 'system' },
        );
        disabled.push(endpointId);
      } catch {
        // setStatus throws on already-disabled; harmless in a race.
      }
    }
    if (disabled.length > 0) {
      this.logger.warn(`auto-disabled endpoints (breaker open 24h): ${disabled.join(', ')}`);
    }
    return disabled;
  }

  /** Names of the registered BullMQ job schedulers (observability/tests). */
  async getSchedulerNames(): Promise<string[]> {
    if (!this.queue) return [];
    const schedulers = await this.queue.getJobSchedulers();
    return schedulers.map((scheduler) => scheduler.name);
  }

  async stop(): Promise<void> {
    await this.onApplicationShutdown();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
