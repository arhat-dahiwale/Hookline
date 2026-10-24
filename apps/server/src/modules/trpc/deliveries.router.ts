import { z } from 'zod';

import {
  idSchema,
  listDeliveriesQuerySchema,
  replayBulkSchema,
  replayDeliverySchema,
} from '@hookline/shared';

import { minRole, router } from './trpc.js';
import {
  DeliveriesRepository,
  DeliveriesService,
  presentAttempt,
  presentDelivery,
} from '../deliveries/index.js';
import { tenantScope } from '../platform/database/tenant-scope.js';
import { notFound } from '../platform/errors/app-error.js';
import { decodeCursor, encodeCursor } from '../platform/pagination.js';

const DEFAULT_LIMIT = 50;

/**
 * `deliveries` router (API.md section 3). `since` powers the WebSocket
 * reconnect backfill (Phase 9); replays go through DeliveriesService, which
 * enqueues via the delivery queue (api role never sends HTTP itself).
 */
export function createDeliveriesRouter(deps: {
  deliveriesRepository: DeliveriesRepository;
  deliveriesService: DeliveriesService;
}) {
  const { deliveriesRepository, deliveriesService } = deps;

  return router({
    list: minRole('member')
      .input(listDeliveriesQuerySchema)
      .query(({ ctx, input }) => {
        const limit = input.limit ?? DEFAULT_LIMIT;
        return deliveriesRepository
          .list(
            tenantScope(ctx.organizationId),
            {
              status: input.status,
              endpointId: input.endpointId,
              eventId: input.eventId,
              from: input.from,
              to: input.to,
            },
            limit,
            input.cursor ? decodeCursor(input.cursor) : null,
          )
          .then((rows) => {
            const last = rows[rows.length - 1];
            return {
              data: rows.map(presentDelivery),
              nextCursor:
                rows.length === limit && last ? encodeCursor(last.createdAt, last.id) : null,
            };
          });
      }),

    get: minRole('member')
      .input(z.object({ id: idSchema }))
      .query(({ ctx, input }) =>
        deliveriesRepository.findById(tenantScope(ctx.organizationId), input.id).then((row) => {
          if (!row) throw notFound('delivery not found');
          return presentDelivery(row);
        }),
      ),

    attempts: minRole('member')
      .input(z.object({ id: idSchema }))
      .query(({ ctx, input }) =>
        // Scope check first: a foreign delivery id must look like a 404.
        deliveriesRepository
          .findById(tenantScope(ctx.organizationId), input.id)
          .then((row) => {
            if (!row) throw notFound('delivery not found');
            return deliveriesRepository.findAttempts(row.id);
          })
          .then((attempts) => ({ data: attempts.map(presentAttempt) })),
      ),

    replay: minRole('admin')
      .input(replayDeliverySchema)
      .mutation(({ ctx, input }) =>
        deliveriesService
          .replayDelivery(tenantScope(ctx.organizationId), input.id)
          .then(presentDelivery),
      ),

    replayBulk: minRole('admin')
      .input(replayBulkSchema)
      .mutation(({ ctx, input }) =>
        deliveriesService
          .replayBulk(tenantScope(ctx.organizationId), {
            status: input.status,
            endpointId: input.endpointId,
            from: input.from,
            to: input.to,
          })
          .then((deliveries) => ({ deliveries: deliveries.map(presentDelivery) })),
      ),

    since: minRole('member')
      .input(
        z.object({ since: z.coerce.date(), limit: z.number().int().min(1).max(200).optional() }),
      )
      .query(({ ctx, input }) =>
        deliveriesRepository
          .listSince(tenantScope(ctx.organizationId), input.since, input.limit ?? 100)
          .then((rows) => ({
            data: rows.map(presentDelivery),
            // The next backfill page starts after the newest update seen.
            nextSince: rows.length > 0 ? rows[rows.length - 1]!.updatedAt.toISOString() : null,
          })),
      ),
  });
}
