import { Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { listDeliveriesQuerySchema } from '@hookline/shared';

import { ApiKeyGuard, RequireScopes, type ApiKeyRequest } from '../api-keys/index.js';
import { tenantScope } from '../platform/database/tenant-scope.js';
import { notFound } from '../platform/errors/app-error.js';
import {
  DeliveriesRepository,
  type DeliveryAttemptRow,
  type DeliveryRow,
} from './deliveries.repository.js';
import { DeliveriesService } from './deliveries.service.js';
import { encodeCursor } from '../platform/pagination.js';

const DEFAULT_LIMIT = 50;

function presentDelivery(delivery: DeliveryRow) {
  return {
    id: delivery.id,
    eventId: delivery.eventId,
    endpointId: delivery.endpointId,
    replayOfDeliveryId: delivery.replayOfDeliveryId,
    status: delivery.status,
    attemptCount: delivery.attemptCount,
    maxAttempts: delivery.maxAttempts,
    nextAttemptAt: delivery.nextAttemptAt?.toISOString() ?? null,
    lastAttemptAt: delivery.lastAttemptAt?.toISOString() ?? null,
    completedAt: delivery.completedAt?.toISOString() ?? null,
    lastResponseStatus: delivery.lastResponseStatus,
    lastError: delivery.lastError,
    createdAt: delivery.createdAt.toISOString(),
  };
}

function presentAttempt(attempt: DeliveryAttemptRow) {
  return {
    id: attempt.id,
    deliveryId: attempt.deliveryId,
    attemptNumber: attempt.attemptNumber,
    outcome: attempt.outcome,
    requestHeaders: attempt.requestHeaders,
    responseStatus: attempt.responseStatus,
    responseHeaders: attempt.responseHeaders,
    responseBodySnippet: attempt.responseBodySnippet,
    errorMessage: attempt.errorMessage,
    durationMs: attempt.durationMs,
    startedAt: attempt.startedAt.toISOString(),
    finishedAt: attempt.finishedAt?.toISOString() ?? null,
  };
}

@Controller('v1/deliveries')
@UseGuards(ApiKeyGuard)
export class DeliveriesController {
  constructor(
    private readonly deliveriesRepository: DeliveriesRepository,
    private readonly deliveriesService: DeliveriesService,
  ) {}

  @Get()
  @RequireScopes('deliveries:read')
  async list(
    @Query() query: Record<string, string | undefined>,
    @Req() request: ApiKeyRequest,
  ): Promise<unknown> {
    const parsed = listDeliveriesQuerySchema.parse(query);
    const limit = parsed.limit ?? DEFAULT_LIMIT;
    const rows = await this.deliveriesRepository.list(
      tenantScope(request.apiKeyContext!.organizationId),
      {
        status: parsed.status,
        endpointId: parsed.endpointId,
        eventId: parsed.eventId,
      },
      limit,
      parsed.cursor ? decodeCursorOrThrow(parsed.cursor) : null,
    );
    const last = rows[rows.length - 1];
    return {
      data: rows.map(presentDelivery),
      nextCursor: rows.length === limit && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  @Get(':deliveryId')
  @RequireScopes('deliveries:read')
  async get(
    @Param('deliveryId') deliveryId: string,
    @Req() request: ApiKeyRequest,
  ): Promise<unknown> {
    const row = await this.deliveriesRepository.findById(
      tenantScope(request.apiKeyContext!.organizationId),
      deliveryId,
    );
    if (!row) throw notFound('delivery not found');
    return presentDelivery(row);
  }

  @Get(':deliveryId/attempts')
  @RequireScopes('deliveries:read')
  async attempts(
    @Param('deliveryId') deliveryId: string,
    @Req() request: ApiKeyRequest,
  ): Promise<unknown> {
    const row = await this.deliveriesRepository.findById(
      tenantScope(request.apiKeyContext!.organizationId),
      deliveryId,
    );
    if (!row) throw notFound('delivery not found');
    const attempts = await this.deliveriesRepository.findAttempts(row.id);
    return { data: attempts.map(presentAttempt), nextCursor: null };
  }

  @Post(':deliveryId/replay')
  @RequireScopes('deliveries:write')
  @HttpCode(202)
  async replay(
    @Param('deliveryId') deliveryId: string,
    @Req() request: ApiKeyRequest,
  ): Promise<unknown> {
    const replayed = await this.deliveriesService.replayDelivery(
      tenantScope(request.apiKeyContext!.organizationId),
      deliveryId,
    );
    return presentDelivery(replayed);
  }
}

function decodeCursorOrThrow(cursor: string): { createdAt: Date; id: string } {
  // Same encoding as events (keyset pagination); invalid cursors are a 400.
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const separator = decoded.lastIndexOf('|');
  const createdAt = new Date(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (Number.isNaN(createdAt.getTime()) || id.length === 0) {
    throw notFound('invalid cursor');
  }
  return { createdAt, id };
}
