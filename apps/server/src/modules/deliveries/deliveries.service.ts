import { Injectable } from '@nestjs/common';

import { DeliveryQueue } from '../delivery-queue/index.js';
import { DeliveriesRepository, type DeliveryRow } from './deliveries.repository.js';
import { TenantScope } from '../platform/database/tenant-scope.js';
import { notFound } from '../platform/errors/app-error.js';

/**
 * Replay of a single delivery (FR-27): creates a FRESH delivery linked to
 * the original via `replay_of_delivery_id` and enqueues it immediately.
 * The unique (event_id, endpoint_id) index only applies to non-replays, so
 * repeated replays are allowed. Event-level replay lives in EventsService
 * (it needs endpoint matching, which belongs to the events flow).
 */
@Injectable()
export class DeliveriesService {
  constructor(
    private readonly deliveriesRepository: DeliveriesRepository,
    private readonly deliveryQueue: DeliveryQueue,
  ) {}

  async replayDelivery(scope: TenantScope, deliveryId: string): Promise<DeliveryRow> {
    const original = await this.deliveriesRepository.findById(scope, deliveryId);
    if (!original) throw notFound('delivery not found');
    const [replay] = await this.deliveriesRepository.insertMany([
      {
        organizationId: original.organizationId,
        eventId: original.eventId,
        endpointId: original.endpointId,
        replayOfDeliveryId: original.id,
        maxAttempts: original.maxAttempts,
        status: 'pending',
      },
    ]);
    await this.deliveryQueue.enqueueAttempt({
      id: replay!.id,
      organizationId: replay!.organizationId,
      attemptCount: 0,
      status: 'pending',
    });
    return replay!;
  }
}
