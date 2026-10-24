import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';

import { ApiKeyGuard, RequireScopes, type ApiKeyRequest } from '../api-keys/index.js';
import { WorkerOperations } from './test-endpoint.js';

/**
 * POST /v1/endpoints/{id}/test — synchronous sample send, executed by the
 * worker-role operations (in-process here; gRPC behind the same interface
 * once roles split, Phase 10). Lives in the delivery engine because only it
 * may perform outbound HTTP.
 */
@Controller('v1/endpoints')
@UseGuards(ApiKeyGuard)
export class WorkerTestController {
  constructor(private readonly workerOperations: WorkerOperations) {}

  @Post(':endpointId/test')
  @RequireScopes('endpoints:write')
  async test(
    @Param('endpointId') endpointId: string,
    @Body() body: unknown,
    @Req() request: ApiKeyRequest,
  ): Promise<unknown> {
    const eventType =
      typeof body === 'object' && body !== null && 'eventType' in body
        ? String((body as { eventType?: unknown }).eventType)
        : undefined;
    return this.workerOperations.testEndpoint({
      organizationId: request.apiKeyContext!.organizationId,
      endpointId,
      eventType,
    });
  }
}
