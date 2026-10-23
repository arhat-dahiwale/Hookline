import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  createEndpointSchema,
  rotateSecretSchema,
  updateEndpointSchema,
  validateEndpointUrl,
} from '@hookline/shared';

import { ApiKeyGuard, RequireScopes, type ApiKeyRequest } from '../api-keys/index.js';
import { APP_CONFIG, type AppConfig } from '../platform/config/app-config.js';
import { tenantScope } from '../platform/database/tenant-scope.js';
import { endpointUrlBlocked, notFound } from '../platform/errors/app-error.js';
import { DeliveriesRepository } from '../deliveries/index.js';
import { EndpointsService } from './endpoints.service.js';
import type { EndpointRow } from './endpoints.repository.js';
import { EndpointsRepository } from './endpoints.repository.js';

function presentEndpoint(endpoint: EndpointRow) {
  return {
    id: endpoint.id,
    url: endpoint.url,
    description: endpoint.description,
    status: endpoint.status,
    eventTypes: endpoint.eventTypes,
    timeoutMs: endpoint.timeoutMs,
    maxAttempts: endpoint.maxAttempts,
    rateLimitPerSecond: endpoint.rateLimitPerSecond,
    metadata: endpoint.metadata,
    createdAt: endpoint.createdAt.toISOString(),
    updatedAt: endpoint.updatedAt.toISOString(),
  };
}

function since24h(): Date {
  return new Date(Date.now() - 24 * 60 * 60 * 1000);
}

@Controller('v1/endpoints')
@UseGuards(ApiKeyGuard)
export class EndpointsController {
  constructor(
    private readonly endpointsService: EndpointsService,
    private readonly endpointsRepository: EndpointsRepository,
    private readonly deliveriesRepository: DeliveriesRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post()
  @RequireScopes('endpoints:write')
  async create(
    @Body() body: unknown,
    @Req() request: ApiKeyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const parsed = createEndpointSchema.parse(body);
    const urlCheck = validateEndpointUrl(parsed.url, {
      allowInsecure: this.config.ALLOW_INSECURE_ENDPOINTS,
    });
    if (!urlCheck.ok) {
      throw endpointUrlBlocked(urlCheck.reason ?? 'URL not allowed');
    }
    const created = await this.endpointsService.create(
      tenantScope(request.apiKeyContext!.organizationId),
      {
        url: parsed.url,
        description: parsed.description,
        eventTypes: parsed.eventTypes,
        timeoutMs: parsed.timeoutMs,
        maxAttempts: parsed.maxAttempts,
        rateLimitPerSecond: parsed.rateLimitPerSecond,
        metadata: parsed.metadata,
      },
      { type: 'api_key', id: request.apiKeyContext!.apiKeyId },
    );
    reply.code(201);
    return { ...presentEndpoint(created.endpoint), secret: created.secret };
  }

  @Get()
  @RequireScopes('endpoints:read')
  async list(@Req() request: ApiKeyRequest): Promise<unknown> {
    const rows = await this.endpointsService.list(
      tenantScope(request.apiKeyContext!.organizationId),
    );
    return { data: rows.map(presentEndpoint), nextCursor: null };
  }

  @Get(':endpointId')
  @RequireScopes('endpoints:read')
  async get(
    @Param('endpointId') endpointId: string,
    @Req() request: ApiKeyRequest,
  ): Promise<unknown> {
    const endpoint = await this.endpointsService.get(
      tenantScope(request.apiKeyContext!.organizationId),
      endpointId,
    );
    return presentEndpoint(endpoint);
  }

  @Patch(':endpointId')
  @RequireScopes('endpoints:write')
  async update(
    @Param('endpointId') endpointId: string,
    @Body() body: unknown,
    @Req() request: ApiKeyRequest,
  ): Promise<unknown> {
    const parsed = updateEndpointSchema.parse(body);
    if (parsed.url !== undefined) {
      const urlCheck = validateEndpointUrl(parsed.url, {
        allowInsecure: this.config.ALLOW_INSECURE_ENDPOINTS,
      });
      if (!urlCheck.ok) {
        throw endpointUrlBlocked(urlCheck.reason ?? 'URL not allowed');
      }
    }
    const scope = tenantScope(request.apiKeyContext!.organizationId);
    const updated = await this.endpointsRepository.update(scope, endpointId, {
      ...(parsed.url !== undefined ? { url: parsed.url } : {}),
      ...(parsed.description !== undefined ? { description: parsed.description } : {}),
      ...(parsed.eventTypes !== undefined ? { eventTypes: parsed.eventTypes } : {}),
      ...(parsed.timeoutMs !== undefined ? { timeoutMs: parsed.timeoutMs } : {}),
      ...(parsed.maxAttempts !== undefined ? { maxAttempts: parsed.maxAttempts } : {}),
      ...(parsed.rateLimitPerSecond !== undefined
        ? { rateLimitPerSecond: parsed.rateLimitPerSecond }
        : {}),
      ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
    });
    if (!updated) throw notFound('endpoint not found');
    return presentEndpoint(updated);
  }

  @Delete(':endpointId')
  @RequireScopes('endpoints:write')
  @HttpCode(204)
  async delete(
    @Param('endpointId') endpointId: string,
    @Req() request: ApiKeyRequest,
  ): Promise<void> {
    await this.endpointsService.softDelete(
      tenantScope(request.apiKeyContext!.organizationId),
      endpointId,
      { type: 'api_key', id: request.apiKeyContext!.apiKeyId },
    );
  }

  @Post(':endpointId/enable')
  @RequireScopes('endpoints:write')
  @HttpCode(200)
  async enable(
    @Param('endpointId') endpointId: string,
    @Req() request: ApiKeyRequest,
  ): Promise<unknown> {
    const endpoint = await this.endpointsService.setStatus(
      tenantScope(request.apiKeyContext!.organizationId),
      endpointId,
      'active',
      'manual',
      { type: 'api_key', id: request.apiKeyContext!.apiKeyId },
    );
    return presentEndpoint(endpoint);
  }

  @Post(':endpointId/disable')
  @RequireScopes('endpoints:write')
  @HttpCode(200)
  async disable(
    @Param('endpointId') endpointId: string,
    @Req() request: ApiKeyRequest,
  ): Promise<unknown> {
    const endpoint = await this.endpointsService.setStatus(
      tenantScope(request.apiKeyContext!.organizationId),
      endpointId,
      'disabled',
      'manual',
      { type: 'api_key', id: request.apiKeyContext!.apiKeyId },
    );
    return presentEndpoint(endpoint);
  }

  @Post(':endpointId/rotate-secret')
  @RequireScopes('endpoints:write')
  @HttpCode(200)
  async rotateSecret(
    @Param('endpointId') endpointId: string,
    @Body() body: unknown,
    @Req() request: ApiKeyRequest,
  ): Promise<unknown> {
    const parsed = rotateSecretSchema.parse(body ?? {});
    const rotated = await this.endpointsService.rotateSecret(
      tenantScope(request.apiKeyContext!.organizationId),
      endpointId,
      parsed.gracePeriodHours ?? this.endpointsService.defaultGraceHours,
      { type: 'api_key', id: request.apiKeyContext!.apiKeyId },
    );
    return { ...presentEndpoint(rotated.endpoint), secret: rotated.secret };
  }

  @Get(':endpointId/health')
  @RequireScopes('endpoints:read')
  async health(
    @Param('endpointId') endpointId: string,
    @Req() request: ApiKeyRequest,
  ): Promise<unknown> {
    const scope = tenantScope(request.apiKeyContext!.organizationId);
    const endpoint = await this.endpointsService.get(scope, endpointId);
    const health = await this.endpointsRepository.findHealth(endpoint.id);
    const stats = await this.deliveriesRepository.attemptStatsSince(endpoint.id, since24h());
    return {
      state: health?.state ?? 'closed',
      consecutiveFailures: health?.consecutiveFailures ?? 0,
      lastSuccessAt: health?.lastSuccessAt?.toISOString() ?? null,
      lastFailureAt: health?.lastFailureAt?.toISOString() ?? null,
      openedAt: health?.openedAt?.toISOString() ?? null,
      stats24h: {
        attempts: stats.attempts,
        succeeded: stats.succeeded,
        failed: stats.attempts - stats.succeeded,
        p95Ms: stats.p95Ms,
      },
    };
  }
}
