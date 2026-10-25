import { Injectable } from '@nestjs/common';

import type { TestEndpointResult } from '../delivery-engine/index.js';
import { WorkerOperations } from '../delivery-engine/index.js';
import {
  DeliveriesRepository,
  DeliveriesService,
  type DeliveryAttemptRow,
} from '../deliveries/index.js';
import { EventsService } from '../events/index.js';
import { EndpointsRepository } from '../endpoints/index.js';
import { tenantScope } from '../platform/database/tenant-scope.js';
import { notFound } from '../platform/errors/app-error.js';
import type {
  DeliveryAttemptEvent,
  EndpointHealthOutput,
  ReplayDeliveryInput,
  ReplayDeliveryOutput,
  ReplayEventInput,
  ReplayEventOutput,
  StreamAttemptsInput,
  TestEndpointInput,
  WorkerOperationsService,
} from './worker-operations.js';

const STREAM_POLL_INTERVAL_MS = 500;
const STREAM_MAX_DURATION_MS = 120_000;

/**
 * In-process adapter (ROLE=all/worker): the exact same code path the queues
 * and processors use, no serialization. Interchangeable with the gRPC
 * adapter behind WorkerOperationsService.
 */
@Injectable()
export class InProcessWorkerOperations implements WorkerOperationsService {
  constructor(
    private readonly workerOperations: WorkerOperations,
    private readonly deliveriesRepository: DeliveriesRepository,
    private readonly deliveriesService: DeliveriesService,
    private readonly eventsService: EventsService,
    private readonly endpointsRepository: EndpointsRepository,
  ) {}

  async replayDelivery(input: ReplayDeliveryInput): Promise<ReplayDeliveryOutput> {
    const created = await this.deliveriesService.replayDelivery(
      tenantScope(input.organizationId),
      input.deliveryId,
    );
    let firstAttempt: ReplayDeliveryOutput['firstAttempt'];
    if (input.waitForFirstAttempt) {
      firstAttempt = await this.waitForFirstAttempt(created.id);
    }
    return { newDeliveryId: created.id, status: created.status, firstAttempt };
  }

  /** Polls until the replay records attempt 1 (bounded; null if it does not). */
  private async waitForFirstAttempt(
    deliveryId: string,
    timeoutMs = 30_000,
  ): Promise<ReplayDeliveryOutput['firstAttempt']> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const attempts = await this.deliveriesRepository.findAttempts(deliveryId);
      const first = attempts.find((attempt) => attempt.attemptNumber === 1);
      if (first && first.finishedAt !== null) {
        return {
          outcome: first.outcome,
          responseStatus: first.responseStatus,
          durationMs: first.durationMs,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return undefined;
  }

  async replayEvent(input: ReplayEventInput): Promise<ReplayEventOutput> {
    const deliveries = await this.eventsService.replayEvent(
      tenantScope(input.organizationId),
      input.eventId,
      input.endpointIds && input.endpointIds.length > 0 ? input.endpointIds : undefined,
    );
    return { newDeliveryIds: deliveries.map((delivery) => delivery.id) };
  }

  async testEndpoint(input: TestEndpointInput): Promise<TestEndpointResult> {
    return this.workerOperations.testEndpoint(input);
  }

  async getEndpointHealth(input: {
    organizationId: string;
    endpointId: string;
  }): Promise<EndpointHealthOutput> {
    const scope = tenantScope(input.organizationId);
    const endpoint = await this.endpointsRepository.findById(scope, input.endpointId);
    if (!endpoint) throw notFound('endpoint not found');
    const health = await this.endpointsRepository.findHealth(endpoint.id);
    return {
      state: health?.state ?? 'closed',
      consecutiveFailures: health?.consecutiveFailures ?? 0,
      openedAt: health?.openedAt?.toISOString() ?? null,
      lastSuccessAt: health?.lastSuccessAt?.toISOString() ?? null,
      lastFailureAt: health?.lastFailureAt?.toISOString() ?? null,
    };
  }

  async *streamDeliveryAttempts(
    input: StreamAttemptsInput,
    options: { signal: AbortSignal; maxDurationMs?: number },
  ): AsyncGenerator<DeliveryAttemptEvent, void, undefined> {
    const scope = tenantScope(input.organizationId);
    const endpoint = await this.endpointsRepository.findById(scope, input.endpointId);
    if (!endpoint) throw notFound('endpoint not found');

    const maxDurationMs = options.maxDurationMs ?? STREAM_MAX_DURATION_MS;
    const deadline = Date.now() + maxDurationMs;
    const seen = new Set<string>();
    let cursor: Date | null = null;

    while (!options.signal.aborted && Date.now() < deadline) {
      let attempts: DeliveryAttemptRow[];
      if (cursor === null) {
        // First pass: everything already recorded for this endpoint.
        attempts = await this.deliveriesRepository.listAttemptsForEndpoint(scope, endpoint.id);
      } else {
        attempts = await this.deliveriesRepository.listAttemptsForEndpointSince(
          scope,
          endpoint.id,
          cursor,
        );
      }
      for (const attempt of attempts) {
        if (seen.has(attempt.id)) continue;
        seen.add(attempt.id);
        if (cursor === null || attempt.startedAt > cursor) cursor = new Date(attempt.startedAt);
        yield {
          deliveryId: attempt.deliveryId,
          attemptNumber: attempt.attemptNumber,
          outcome: attempt.outcome,
          responseStatus: attempt.responseStatus,
          durationMs: attempt.durationMs,
          finishedAt: attempt.finishedAt?.toISOString() ?? null,
        };
      }
      if (options.signal.aborted) return;
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, STREAM_POLL_INTERVAL_MS);
        options.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            resolve(undefined);
          },
          { once: true },
        );
      });
    }
  }
}
