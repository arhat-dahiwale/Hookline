import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';

import { jitteredDelayForAttempt } from './backoff.js';
import { APP_CONFIG, type AppConfig } from '../platform/config/app-config.js';
import { RedisService } from '../platform/redis/redis.service.js';
import { serializeTraceContext } from '../observability/trace-context.js';

export const DELIVERY_QUEUE_NAME = 'delivery';
export const MAINTENANCE_QUEUE_NAME = 'maintenance';
export const BULLMQ_PREFIX = 'hl:bull';

export interface DeliveryJobData {
  deliveryId: string;
  organizationId: string;
  /** W3C trace-context carrier (JSON) from the enqueueing API request. */
  traceContext?: string;
}

/**
 * Job id for one attempt: `{deliveryId}.{attemptNumber}`. BullMQ reserves':'
 * as its internal separator and rejects custom ids containing it, so the
 * documented `{deliveryId}:{attemptNumber}` convention maps to ".".
 */
export function deliveryJobId(deliveryId: string, attemptNumber: number): string {
  return `${deliveryId}.${attemptNumber}`;
}

/**
 * Enqueue side of the delivery queue. Loaded by the api role (post-commit
 * enqueue) and the worker role. Jobs are one-per-attempt with
 * `jobId = {deliveryId}:{attemptNumber}`; BullMQ skips duplicate jobIds,
 * which makes re-enqueues (reconciler, replay races) safe.
 */
@Injectable()
export class DeliveryQueue implements OnApplicationShutdown {
  readonly queue: Queue<DeliveryJobData>;

  constructor(@Inject(APP_CONFIG) config: AppConfig, redisService: RedisService) {
    // Config participates in validation order (queue is built per process);
    // the values it contributes are reflected via RedisService.
    void config;
    this.queue = new Queue<DeliveryJobData>(DELIVERY_QUEUE_NAME, {
      prefix: BULLMQ_PREFIX,
      connection: redisService.duplicateForBullMq(),
      defaultJobOptions: {
        // Manual re-enqueue per attempt: no built-in BullMQ retries.
        attempts: 1,
        removeOnComplete: { age: 3_600, count: 5_000 },
        removeOnFail: { age: 86_400 },
      },
    });
  }

  /** Enqueue the next attempt (1-based). Delay comes from the retry schedule. */
  async enqueueAttempt(
    delivery: { id: string; organizationId: string; attemptCount: number; status: string },
    options: { delayMs?: number } = {},
  ): Promise<void> {
    const nextAttempt = delivery.attemptCount + 1;
    const delay = options.delayMs ?? jitteredDelayForAttempt(nextAttempt);
    // Trace context travels in job data (ARCHITECTURE.md 7.3): the worker
    // continues the API request's trace across the queue boundary.
    await this.queue.add(
      'deliver',
      {
        deliveryId: delivery.id,
        organizationId: delivery.organizationId,
        traceContext: serializeTraceContext(),
      },
      {
        jobId: deliveryJobId(delivery.id, nextAttempt),
        delay,
      },
    );
  }

  /** True when a non-finished job exists for the attempt. */
  async hasLiveJob(deliveryId: string, attemptNumber: number): Promise<boolean> {
    const job = await this.queue.getJob(deliveryJobId(deliveryId, attemptNumber));
    if (!job) return false;
    return !(await job.isCompleted());
  }

  async removeJobsFor(deliveryId: string): Promise<void> {
    for (let attempt = 1; attempt <= 13; attempt += 1) {
      const job = await this.queue.getJob(deliveryJobId(deliveryId, attempt));
      if (job) await job.remove().catch(() => undefined);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
