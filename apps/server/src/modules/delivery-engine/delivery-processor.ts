import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Worker, type Job } from 'bullmq';

import {
  DELIVERY_QUEUE_NAME,
  BULLMQ_PREFIX,
  DeliveryQueue,
  deliveryJobId,
  jitteredDelayForAttempt,
  type DeliveryJobData,
} from '../delivery-queue/index.js';
import { SsrfHttpClient } from './ssrf-http-client.js';
import { deliveryHeaders } from './signing.js';
import { CircuitBreakerService } from './breaker.js';
import { TokenBucketRateLimiter } from '../platform/rate-limiter/token-bucket.js';
import { APP_CONFIG, type AppConfig } from '../platform/config/app-config.js';
import { tenantScope } from '../platform/database/tenant-scope.js';
import { RedisService } from '../platform/redis/redis.service.js';
import { DeliveriesRepository } from '../deliveries/index.js';
import { EndpointsService, EndpointsRepository } from '../endpoints/index.js';
import { EventsRepository } from '../events/index.js';

export interface AttemptCompletedEvent {
  organizationId: string;
  deliveryId: string;
  /** Routing fields for scoped WebSocket subscriptions (API.md 4). */
  eventId: string;
  endpointId: string;
  attemptNumber: number;
  outcome: 'success' | 'http_error' | 'timeout' | 'network_error' | 'blocked';
  responseStatus: number | null;
  durationMs: number | null;
}

export interface DeliveryStatusChangedEvent {
  organizationId: string;
  deliveryId: string;
  /** Routing fields for scoped WebSocket subscriptions (API.md 4). */
  eventId: string;
  endpointId: string;
  status: 'pending' | 'in_progress' | 'retrying' | 'succeeded' | 'dead' | 'cancelled';
  attemptCount: number;
  nextAttemptAt: Date | null;
}

/**
 * The delivery worker (ARCHITECTURE.md 5.2). Runs only in the worker role
 * (and `all`). One job = one attempt. Attempts are claimed atomically in
 * Postgres, so duplicate job execution is a no-op (idempotency 6.4). All
 * table access goes through the owning modules' repositories.
 */
@Injectable()
export class DeliveryProcessor implements OnApplicationShutdown {
  private readonly logger = new Logger(DeliveryProcessor.name);
  private readonly httpClient: SsrfHttpClient;
  private worker: Worker<DeliveryJobData> | undefined;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly redisService: RedisService,
    private readonly deliveriesRepository: DeliveriesRepository,
    private readonly endpointsRepository: EndpointsRepository,
    private readonly endpointsService: EndpointsService,
    private readonly eventsRepository: EventsRepository,
    private readonly deliveryQueue: DeliveryQueue,
    private readonly breaker: CircuitBreakerService,
    private readonly outboundRateLimiter: TokenBucketRateLimiter,
    private readonly emitter: EventEmitter2,
  ) {
    this.httpClient = new SsrfHttpClient({ allowInsecure: config.ALLOW_INSECURE_ENDPOINTS });
  }

  /** Processes one delivery attempt end to end. Exposed for direct testing. */
  async process(
    deliveryId: string,
    organizationId: string,
    job?: Job<DeliveryJobData>,
  ): Promise<void> {
    const delivery = await this.deliveriesRepository.findByIdUnscoped(deliveryId);
    if (!delivery || delivery.organizationId !== organizationId) return;
    if (delivery.status !== 'pending' && delivery.status !== 'retrying') return;

    const endpoint = await this.endpointsRepository.findByIdUnscoped(delivery.endpointId);
    if (!endpoint || endpoint.deletedAt || endpoint.status !== 'active') {
      await this.deliveriesRepository.markCancelled(delivery.id, 'endpoint unavailable');
      await this.emitStatusChanged(delivery, 'cancelled', 0, null);
      return;
    }
    const event = await this.eventsRepository.findById(
      tenantScope(organizationId),
      delivery.eventId,
    );
    if (!event) {
      await this.deliveriesRepository.markCancelled(delivery.id, 'event missing');
      await this.emitStatusChanged(delivery, 'cancelled', 0, null);
      return;
    }

    // Breaker gate and outbound rate limit (ARCHITECTURE.md 5.2 step 2): a
    // blocked job is re-delayed WITHOUT consuming an attempt.
    const gate = await this.breaker.beforeAttempt(endpoint.id);
    if (!gate.allowed) {
      await this.redelay(delivery, gate.retryAfterMs, job);
      return;
    }
    const outbound = await this.outboundRateLimiter.take(`hl:rl:endpoint:${endpoint.id}`, {
      ratePerSecond: endpoint.rateLimitPerSecond,
      capacity: Math.max(endpoint.rateLimitPerSecond * 2, 1),
    });
    if (!outbound.allowed) {
      await this.redelay(delivery, Math.max(outbound.retryAfterMs, 100), job);
      return;
    }

    // Atomic attempt claim: a duplicate run of the same job loses and exits.
    const attemptNumber = delivery.attemptCount + 1;
    const claimed = await this.deliveriesRepository.claimAttempt(
      delivery.id,
      delivery.attemptCount,
    );
    if (claimed === null) {
      this.logger.warn(`duplicate execution skipped for ${delivery.id} attempt ${attemptNumber}`);
      return;
    }

    const secrets = await this.endpointsService.decryptActiveSecrets(endpoint);
    const timestamp = Math.floor(Date.now() / 1000);
    const { headers, body } = deliveryHeaders({
      deliveryId: delivery.id,
      event: {
        id: event.id,
        type: event.type,
        createdAt: event.createdAt,
        payload: event.payload,
      },
      attemptNumber,
      secrets,
      timestamp,
    });

    const startedAt = new Date();
    const result = await this.httpClient.send(endpoint.url, headers, body, endpoint.timeoutMs);
    const finishedAt = new Date();

    await this.deliveriesRepository.insertAttempt({
      deliveryId: delivery.id,
      organizationId: delivery.organizationId,
      endpointId: delivery.endpointId,
      attemptNumber,
      outcome: result.outcome,
      requestHeaders: headers,
      responseStatus: result.responseStatus,
      responseHeaders: result.responseHeaders,
      responseBodySnippet: result.responseBodySnippet,
      errorMessage: result.errorMessage,
      durationMs: result.durationMs,
      startedAt,
      finishedAt,
    });

    await this.emitter.emitAsync('delivery.attempt.completed', {
      organizationId: delivery.organizationId,
      deliveryId: delivery.id,
      eventId: delivery.eventId,
      endpointId: delivery.endpointId,
      attemptNumber,
      outcome: result.outcome,
      responseStatus: result.responseStatus,
      durationMs: result.durationMs,
    } satisfies AttemptCompletedEvent);

    if (result.outcome === 'success') {
      await this.breaker.recordSuccess(endpoint.id);
    } else {
      await this.breaker.recordFailure(endpoint.id);
    }

    const lastError = result.errorMessage ?? `${result.outcome} (status ${result.responseStatus})`;

    if (result.outcome === 'success') {
      await this.deliveriesRepository.markSucceeded(delivery.id, {
        attemptNumber,
        responseStatus: result.responseStatus,
        completedAt: finishedAt,
      });
      await this.emitStatusChanged(delivery, 'succeeded', attemptNumber, null);
      return;
    }

    if (attemptNumber >= delivery.maxAttempts) {
      await this.deliveriesRepository.markDead(delivery.id, {
        responseStatus: result.responseStatus,
        lastError,
        completedAt: finishedAt,
      });
      await this.emitStatusChanged(delivery, 'dead', attemptNumber, null);
      return;
    }

    const nextAttemptAt = new Date(Date.now() + jitteredDelayForAttempt(attemptNumber + 1));
    await this.deliveriesRepository.markRetrying(delivery.id, {
      responseStatus: result.responseStatus,
      lastError,
      nextAttemptAt,
    });
    await this.emitStatusChanged(delivery, 'retrying', attemptNumber, nextAttemptAt);

    // Enqueue the next attempt with the scheduled (jittered) delay.
    await this.deliveryQueue.enqueueAttempt(
      {
        id: delivery.id,
        organizationId: delivery.organizationId,
        attemptCount: attemptNumber,
        status: 'retrying',
      },
      { delayMs: Math.max(nextAttemptAt.getTime() - Date.now(), 0) },
    );
  }

  /**
   * Re-delay the current job (or ensure a delayed job exists for manual
   * runs) without consuming an attempt. Breaker/rate-limit path only.
   */
  private async redelay(
    delivery: { id: string; organizationId: string; attemptCount: number; status: string },
    delayMs: number,
    job?: Job<DeliveryJobData>,
  ): Promise<void> {
    const clamped = Math.min(Math.max(delayMs, 250), 60_000);
    if (job) {
      await job.moveToDelayed(Date.now() + clamped, job.token).catch(async () => {
        await this.deliveryQueue.enqueueAttempt(delivery, { delayMs: clamped });
      });
      return;
    }
    const existing = await this.deliveryQueue.queue.getJob(
      deliveryJobId(delivery.id, delivery.attemptCount + 1),
    );
    if (!existing) {
      await this.deliveryQueue.enqueueAttempt(delivery, { delayMs: clamped });
    }
  }

  private async emitStatusChanged(
    delivery: { organizationId: string; id: string; eventId: string; endpointId: string },
    status: DeliveryStatusChangedEvent['status'],
    attemptCount: number,
    nextAttemptAt: Date | null,
  ): Promise<void> {
    await this.emitter.emitAsync('delivery.status.changed', {
      organizationId: delivery.organizationId,
      deliveryId: delivery.id,
      eventId: delivery.eventId,
      endpointId: delivery.endpointId,
      status,
      attemptCount,
      nextAttemptAt,
    } satisfies DeliveryStatusChangedEvent);
  }

  /** Starts the BullMQ worker (worker/all roles only). */
  start(concurrency: number): void {
    this.worker = new Worker<DeliveryJobData>(
      DELIVERY_QUEUE_NAME,
      async (job: Job<DeliveryJobData>) => {
        await this.process(job.data.deliveryId, job.data.organizationId, job);
      },
      {
        prefix: BULLMQ_PREFIX,
        connection: this.redisService.duplicateForBullMq(),
        concurrency,
        // Stalled (killed mid-run) jobs are retried; the atomic attempt
        // claim makes re-execution safe.
        stalledInterval: 8_000,
        maxStalledCount: 3,
      },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(`delivery job ${job?.id ?? '?'} failed: ${error.message}`);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.httpClient.close();
  }
}
