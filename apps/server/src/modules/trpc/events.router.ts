import { z } from 'zod';

import { createEventSchema, idSchema, listEventsQuerySchema } from '@hookline/shared';

import { minRole, router } from './trpc.js';
import { presentDelivery } from '../deliveries/index.js';
import { EventsService } from '../events/index.js';
import { presentEvent, presentEventDetailed } from '../events/events.presenter.js';
import { tenantScope } from '../platform/database/tenant-scope.js';
import { encodeCursor } from '../platform/pagination.js';

const DEFAULT_LIMIT = 50;

/**
 * `events` router (API.md section 3). The dashboard send is a manual event
 * triggered by a signed-in admin — same ingestion path as the REST API, so
 * idempotency, fan-out and payload limits apply identically.
 */
export function createEventsRouter(deps: { eventsService: EventsService }) {
  const { eventsService } = deps;

  return router({
    list: minRole('member')
      .input(listEventsQuerySchema)
      .query(({ ctx, input }) =>
        eventsService
          .list(
            tenantScope(ctx.organizationId),
            { type: input.type, from: input.from, to: input.to },
            input.limit ?? DEFAULT_LIMIT,
            input.cursor ?? null,
          )
          .then((rows) => {
            const last = rows[rows.length - 1];
            return {
              data: rows.map(presentEvent),
              nextCursor:
                rows.length === (input.limit ?? DEFAULT_LIMIT) && last
                  ? encodeCursor(last.createdAt, last.id)
                  : null,
            };
          }),
      ),

    get: minRole('member')
      .input(z.object({ id: idSchema }))
      .query(({ ctx, input }) =>
        eventsService.get(tenantScope(ctx.organizationId), input.id).then(presentEventDetailed),
      ),

    send: minRole('admin')
      .input(createEventSchema)
      .mutation(async ({ ctx, input }) => {
        const result = await eventsService.ingest(tenantScope(ctx.organizationId), {
          type: input.type,
          payload: input.payload,
          endpointIds: input.endpointIds,
        });
        return {
          event: presentEventDetailed(result.event),
          deliveries: result.deliveries.map(presentDelivery),
          replay: result.replay,
        };
      }),

    replay: minRole('admin')
      .input(z.object({ id: idSchema, endpointIds: z.array(idSchema).optional() }))
      .mutation(({ ctx, input }) =>
        eventsService
          .replayEvent(tenantScope(ctx.organizationId), input.id, input.endpointIds)
          .then((deliveries) => ({ deliveries: deliveries.map(presentDelivery) })),
      ),
  });
}
