import { Buffer } from 'node:buffer';

import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MAX_PAYLOAD_BYTES } from '@hookline/shared';

import { TenantScope } from '../platform/database/tenant-scope.js';
import { idempotencyKeyReuse, notFound, payloadTooLarge } from '../platform/errors/app-error.js';
import { UnitOfWork } from '../platform/database/unit-of-work.js';
import { decodeCursor } from '../platform/pagination.js';
import { RedisService } from '../platform/redis/redis.service.js';
import { DeliveryQueue } from '../delivery-queue/index.js';
import { DeliveriesRepository, type DeliveryRow } from '../deliveries/index.js';
import { EndpointsRepository } from '../endpoints/index.js';
import {
  canonicalizeJson,
  EventsRepository,
  payloadHash,
  type EventRow,
} from './events.repository.js';

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

export interface IngestInput {
  type: string;
  payload: Record<string, unknown>;
  endpointIds?: string[];
  idempotencyKey?: string | undefined;
}

export interface IngestResult {
  event: EventRow;
  deliveries: DeliveryRow[];
  replay: boolean;
}

/**
 * Event ingestion (ARCHITECTURE.md 5.1): idempotency check (Redis fast
 * path, Postgres unique constraint authoritative), then ONE transaction
 * inserting the event plus one pending delivery per matching endpoint.
 * After commit each delivery is enqueued; a crash in that window is healed
 * by the reconciler (Phase 6).
 */
@Injectable()
export class EventsService {
  constructor(
    private readonly eventsRepository: EventsRepository,
    private readonly endpointsRepository: EndpointsRepository,
    private readonly deliveriesRepository: DeliveriesRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly redis: RedisService,
    private readonly deliveryQueue: DeliveryQueue,
    private readonly emitter: EventEmitter2,
  ) {}

  async ingest(scope: TenantScope, input: IngestInput): Promise<IngestResult> {
    const serialized = Buffer.byteLength(canonicalizeJson(input.payload), 'utf8');
    if (serialized > MAX_PAYLOAD_BYTES) {
      throw payloadTooLarge(`payload exceeds ${Math.floor(MAX_PAYLOAD_BYTES / 1024)} KB`);
    }
    const hash = payloadHash(input.payload);

    if (input.idempotencyKey) {
      const replay = await this.resolveIdempotency(scope, input.idempotencyKey, hash);
      if (replay) return replay;
    }

    try {
      const { event, deliveries } = await this.unitOfWork.run(async (tx) => {
        const inserted = await this.eventsRepository.insertTx(tx, {
          organizationId: scope.organizationId,
          type: input.type,
          payload: input.payload,
          idempotencyKey: input.idempotencyKey ?? null,
        });
        const matches = await this.endpointsRepository.listActiveForEventTx(
          tx,
          scope,
          input.type,
          input.endpointIds,
        );
        const created = await this.deliveriesRepository.insertManyTx(
          tx,
          matches.map((endpoint) => ({
            organizationId: scope.organizationId,
            eventId: inserted.id,
            endpointId: endpoint.id,
            maxAttempts: endpoint.maxAttempts,
            status: 'pending' as const,
          })),
        );
        return { event: inserted, deliveries: created };
      });

      if (input.idempotencyKey) {
        await this.redis.client.set(
          this.idemKey(scope.organizationId, input.idempotencyKey),
          `${event.id}:${hash}`,
          'EX',
          IDEMPOTENCY_TTL_SECONDS,
        );
      }
      // Enqueue AFTER commit (ARCHITECTURE.md 5.1).
      for (const delivery of deliveries) {
        await this.deliveryQueue.enqueueAttempt({
          id: delivery.id,
          organizationId: delivery.organizationId,
          attemptCount: delivery.attemptCount,
          status: delivery.status,
        });
      }
      // Same-process reactions only (ARCHITECTURE.md 7.4): the realtime
      // module bridges these onto Redis for WebSocket fan-out.
      await this.emitter.emitAsync('event.created', {
        organizationId: scope.organizationId,
        event: { id: event.id, type: event.type, createdAt: event.createdAt.toISOString() },
        deliveries: deliveries.map((delivery) => ({
          id: delivery.id,
          endpointId: delivery.endpointId,
          status: delivery.status,
        })),
      });
      for (const delivery of deliveries) {
        await this.emitter.emitAsync('delivery.created', {
          organizationId: scope.organizationId,
          delivery: {
            id: delivery.id,
            eventId: delivery.eventId,
            endpointId: delivery.endpointId,
            status: delivery.status,
          },
        });
      }
      return { event, deliveries, replay: false };
    } catch (error) {
      if (
        input.idempotencyKey &&
        error instanceof Error &&
        error.message.includes('events_org_idem_uidx')
      ) {
        // Lost a race against the unique constraint: resolve the winner.
        const replay = await this.resolveIdempotency(scope, input.idempotencyKey, hash);
        if (replay) return replay;
      }
      throw error;
    }
  }

  private async resolveIdempotency(
    scope: TenantScope,
    idempotencyKey: string,
    hash: string,
  ): Promise<IngestResult | null> {
    const key = this.idemKey(scope.organizationId, idempotencyKey);

    const cached = await this.redis.client.get(key).catch(() => null);
    if (cached) {
      const [eventId, cachedHash] = cached.split(':');
      if (cachedHash !== hash)
        throw idempotencyKeyReuse('idempotency key already used with a different payload');
      const replay = await this.loadEventWithDeliveries(scope, eventId!);
      if (replay) return replay;
    }

    const existing = await this.eventsRepository.findByIdempotencyKey(
      scope.organizationId,
      idempotencyKey,
    );
    if (!existing) return null;
    if (existing.payloadHash !== hash) {
      throw idempotencyKeyReuse('idempotency key already used with a different payload');
    }
    const replay = await this.loadEventWithDeliveries(scope, existing.id);
    if (replay) {
      await this.redis.client.set(key, `${existing.id}:${hash}`, 'EX', IDEMPOTENCY_TTL_SECONDS);
      return replay;
    }
    return null;
  }

  private async loadEventWithDeliveries(
    scope: TenantScope,
    eventId: string,
  ): Promise<IngestResult | null> {
    const event = await this.eventsRepository.findById(scope, eventId);
    if (!event) return null;
    const deliveries = await this.deliveriesRepository.listForEvent(scope, eventId);
    return { event, deliveries, replay: true };
  }

  async get(scope: TenantScope, id: string): Promise<EventRow> {
    const event = await this.eventsRepository.findById(scope, id);
    if (!event) throw notFound('event not found');
    return event;
  }

  async list(
    scope: TenantScope,
    filters: { type?: string; from?: Date; to?: Date },
    limit: number,
    cursor?: string | null,
  ) {
    return this.eventsRepository.list(scope, filters, limit, cursor ? decodeCursor(cursor) : null);
  }

  /** Replay an event to all matching (or given) endpoints (FR-28). */
  async replayEvent(
    scope: TenantScope,
    eventId: string,
    endpointIds?: string[],
  ): Promise<DeliveryRow[]> {
    const event = await this.eventsRepository.findById(scope, eventId);
    if (!event) throw notFound('event not found');
    const active = await this.endpointsRepository.listActive(scope);
    const matches = active.filter(
      (endpoint) =>
        (!endpointIds || endpointIds.includes(endpoint.id)) &&
        (endpoint.eventTypes.length === 0 ||
          endpoint.eventTypes.some(
            (pattern) =>
              pattern === event.type ||
              (pattern.endsWith('.*') && event.type.startsWith(pattern.slice(0, -1))),
          )),
    );
    if (matches.length === 0) throw notFound('no matching endpoints');

    // Link replays to the original delivery for the endpoint: the partial
    // unique (event_id, endpoint_id) index only applies to non-replays.
    const existing = await this.deliveriesRepository.listForEvent(scope, event.id);
    const originalByEndpoint = new Map(existing.map((row) => [row.endpointId, row.id]));

    const created = await this.deliveriesRepository.insertMany(
      matches.map((endpoint) => ({
        organizationId: scope.organizationId,
        eventId: event.id,
        endpointId: endpoint.id,
        replayOfDeliveryId: originalByEndpoint.get(endpoint.id) ?? null,
        maxAttempts: endpoint.maxAttempts,
        status: 'pending' as const,
      })),
    );
    for (const delivery of created) {
      await this.deliveryQueue.enqueueAttempt({
        id: delivery.id,
        organizationId: delivery.organizationId,
        attemptCount: 0,
        status: 'pending',
      });
    }
    return created;
  }

  private idemKey(organizationId: string, idempotencyKey: string): string {
    return `hl:idem:${organizationId}:${idempotencyKey}`;
  }
}
