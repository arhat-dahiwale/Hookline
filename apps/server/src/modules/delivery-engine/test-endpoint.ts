import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { deliveryHeaders } from './signing.js';
import { SsrfHttpClient, type SendResult } from './ssrf-http-client.js';
import { APP_CONFIG, type AppConfig } from '../platform/config/app-config.js';
import { EndpointsService } from '../endpoints/index.js';
import { tenantScope } from '../platform/database/tenant-scope.js';

export interface TestEndpointResult {
  outcome: SendResult['outcome'];
  responseStatus: number | null;
  durationMs: number;
  responseBodySnippet: string | null;
  error: string | null;
}

/**
 * Worker-role operations (ARCHITECTURE.md 5.4). In-process implementation,
 * used directly when ROLE=all/worker. When roles are split (Phase 10), the
 * api role reaches the same operations over gRPC behind this interface —
 * the api role itself never makes outbound requests.
 */
@Injectable()
export class WorkerOperations {
  private readonly httpClient: SsrfHttpClient;

  constructor(
    private readonly endpointsService: EndpointsService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.httpClient = new SsrfHttpClient({ allowInsecure: config.ALLOW_INSECURE_ENDPOINTS });
  }

  /** Synchronous test send (API.md POST /v1/endpoints/{id}/test). */
  async testEndpoint(input: {
    organizationId: string;
    endpointId: string;
    eventType?: string;
  }): Promise<TestEndpointResult> {
    const endpoint = await this.endpointsService.get(
      tenantScope(input.organizationId),
      input.endpointId,
    );
    const secrets = await this.endpointsService.decryptActiveSecrets(endpoint);
    const timestamp = Math.floor(Date.now() / 1000);
    const event = {
      id: `evt_test_${randomUUID().slice(0, 12)}`,
      type: input.eventType ?? 'hookline.test',
      createdAt: new Date(),
      payload: { test: true, endpointId: endpoint.id },
    };
    const { headers, body } = deliveryHeaders({
      deliveryId: `dlv_test_${randomUUID().slice(0, 12)}`,
      event,
      attemptNumber: 1,
      secrets,
      timestamp,
    });
    const result = await this.httpClient.send(endpoint.url, headers, body, endpoint.timeoutMs);
    return {
      outcome: result.outcome,
      responseStatus: result.responseStatus,
      durationMs: result.durationMs,
      responseBodySnippet: result.responseBodySnippet,
      error: result.errorMessage,
    };
  }

  async close(): Promise<void> {
    await this.httpClient.close();
  }
}
