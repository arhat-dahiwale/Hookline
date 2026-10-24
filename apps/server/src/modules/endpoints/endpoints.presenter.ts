import type { EndpointRow } from './endpoints.repository.js';

/**
 * Wire format for an endpoint (no secret — secrets are returned exactly once
 * by create/rotate). Shared by the REST controller and the tRPC router.
 */
export function presentEndpoint(endpoint: EndpointRow) {
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
