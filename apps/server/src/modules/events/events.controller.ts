import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { IDEMPOTENCY_KEY_MAX, createEventSchema, listEventsQuerySchema } from '@hookline/shared';

import { ApiKeyGuard, RequireScopes, type ApiKeyRequest } from '../api-keys/index.js';
import { tenantScope } from '../platform/database/tenant-scope.js';
import { badRequest, notFound } from '../platform/errors/app-error.js';
import { DeliveriesRepository, type DeliveryRow } from '../deliveries/index.js';
import type { EventRow } from './events.repository.js';
import { encodeCursor } from '../platform/pagination.js';
import { EventsService } from './events.service.js';
import { IngestionRateLimitGuard } from './ingestion-rate-limit.guard.js';

const DEFAULT_LIMIT = 50;

function presentEvent(event: EventRow) {
  return {
    id: event.id,
    type: event.type,
    createdAt: event.createdAt.toISOString(),
  };
}

function presentDelivery(delivery: DeliveryRow) {
  return {
    id: delivery.id,
    endpointId: delivery.endpointId,
    status: delivery.status,
  };
}

@Controller('v1/events')
@UseGuards(ApiKeyGuard)
export class EventsController {
  constructor(
    private readonly eventsService: EventsService,
    private readonly deliveriesRepository: DeliveriesRepository,
  ) {}

  @Post()
  @RequireScopes('events:write')
  @UseGuards(IngestionRateLimitGuard)
  @HttpCode(202)
  async ingest(
    @Body() body: unknown,
    @Req() request: ApiKeyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const parsed = createEventSchema.parse(body ?? {});
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
    if (idempotencyKey !== undefined && idempotencyKey.length > IDEMPOTENCY_KEY_MAX) {
      throw badRequest(`Idempotency-Key must be at most ${IDEMPOTENCY_KEY_MAX} characters`);
    }

    const result = await this.eventsService.ingest(
      tenantScope(request.apiKeyContext!.organizationId),
      {
        type: parsed.type,
        payload: parsed.payload,
        endpointIds: parsed.endpointIds,
        idempotencyKey: idempotencyKey || undefined,
      },
    );

    const response = {
      id: result.event.id,
      type: result.event.type,
      createdAt: result.event.createdAt.toISOString(),
      deliveries: result.deliveries.map(presentDelivery),
    };
    if (result.replay) {
      reply.code(200).header('Idempotent-Replay', 'true');
    }
    return response;
  }

  @Get()
  @RequireScopes('events:read')
  async list(
    @Query() query: Record<string, string | undefined>,
    @Req() request: ApiKeyRequest,
  ): Promise<unknown> {
    const parsed = listEventsQuerySchema.parse(query);
    const limit = parsed.limit ?? DEFAULT_LIMIT;
    const rows = await this.eventsService.list(
      tenantScope(request.apiKeyContext!.organizationId),
      { type: parsed.type, from: parsed.from, to: parsed.to },
      limit,
      parsed.cursor,
    );
    const last = rows[rows.length - 1];
    return {
      data: rows.map(presentEvent),
      nextCursor: rows.length === limit && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  @Get(':eventId')
  @RequireScopes('events:read')
  async get(@Param('eventId') eventId: string, @Req() request: ApiKeyRequest): Promise<unknown> {
    const event = await this.eventsService.get(
      tenantScope(request.apiKeyContext!.organizationId),
      eventId,
    );
    return { ...presentEvent(event), payload: event.payload };
  }

  @Get(':eventId/deliveries')
  @RequireScopes('deliveries:read')
  async deliveries(
    @Param('eventId') eventId: string,
    @Req() request: ApiKeyRequest,
  ): Promise<unknown> {
    const scope = tenantScope(request.apiKeyContext!.organizationId);
    const event = await this.eventsService.get(scope, eventId).catch(() => {
      throw notFound('event not found');
    });
    const rows = await this.deliveriesRepository.listForEvent(scope, event.id);
    return { data: rows.map(presentDelivery), nextCursor: null };
  }
}
