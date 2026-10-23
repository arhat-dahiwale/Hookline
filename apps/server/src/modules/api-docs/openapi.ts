import {
  OpenAPIRegistry,
  extendZodWithOpenApi,
  OpenApiGeneratorV3,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { createEndpointSchema, createEventSchema, updateEndpointSchema } from '@hookline/shared';

extendZodWithOpenApi(z);

const bearerAuth = 'bearerApiKey';

const registry = new OpenAPIRegistry();

registry.registerComponent('securitySchemes', bearerAuth, {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'hl_live_...',
  description: 'API key: `Authorization: Bearer hl_live_{prefix}_{secret}`',
});

const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
    requestId: z.string(),
  }),
});

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: errorSchema } },
});

const standardResponses = {
  '401': errorResponse('unauthorized'),
  '403': errorResponse('forbidden'),
  '500': errorResponse('internal error'),
};

function secured() {
  return { security: [{ [bearerAuth]: [] }] };
}

// --- events -------------------------------------------------------------------

registry.registerPath({
  method: 'post',
  path: '/v1/events',
  ...secured(),
  summary: 'Ingest an event and fan out',
  description:
    'API.md 1.3. Returns 202; an idempotent replay returns 200 with `Idempotent-Replay: true`.',
  request: {
    headers: z.object({ 'Idempotency-Key': z.string().max(255).optional() }),
    body: { content: { 'application/json': { schema: createEventSchema } } },
  },
  responses: {
    '202': {
      description: 'Accepted',
      content: {
        'application/json': {
          schema: z.object({
            id: z.string(),
            type: z.string(),
            createdAt: z.string(),
            deliveries: z.array(
              z.object({ id: z.string(), endpointId: z.string(), status: z.string() }),
            ),
          }),
        },
      },
    },
    '413': errorResponse('payload too large'),
    '422': errorResponse('idempotency key reuse'),
    '429': errorResponse('rate limited (RateLimit-* and Retry-After headers)'),
    ...standardResponses,
  },
});

registry.registerPath({
  method: 'get',
  path: '/v1/events',
  ...secured(),
  summary: 'List events (cursor pagination, filters: type, from, to)',
  responses: {
    '200': {
      description: 'ok',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(z.object({ id: z.string(), type: z.string(), createdAt: z.string() })),
            nextCursor: z.string().nullable(),
          }),
        },
      },
    },
    ...standardResponses,
  },
});

registry.registerPath({
  method: 'get',
  path: '/v1/events/{eventId}',
  ...secured(),
  summary: 'Get one event',
  request: { params: z.object({ eventId: z.string() }) },
  responses: {
    '200': {
      description: 'ok',
      content: {
        'application/json': {
          schema: z.object({
            id: z.string(),
            type: z.string(),
            createdAt: z.string(),
            payload: z.record(z.string(), z.unknown()),
          }),
        },
      },
    },
    '404': errorResponse('not found'),
    ...standardResponses,
  },
});

registry.registerPath({
  method: 'get',
  path: '/v1/events/{eventId}/deliveries',
  ...secured(),
  summary: 'Deliveries for an event',
  request: { params: z.object({ eventId: z.string() }) },
  responses: {
    '200': {
      description: 'ok',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(z.object({ id: z.string(), endpointId: z.string(), status: z.string() })),
            nextCursor: z.string().nullable(),
          }),
        },
      },
    },
    '404': errorResponse('not found'),
    ...standardResponses,
  },
});

// --- endpoints ------------------------------------------------------------------

registry.registerPath({
  method: 'post',
  path: '/v1/endpoints',
  ...secured(),
  summary: 'Create an endpoint (secret shown once)',
  request: { body: { content: { 'application/json': { schema: createEndpointSchema } } } },
  responses: {
    '201': {
      description: 'created',
      content: {
        'application/json': {
          schema: z.object({ id: z.string(), url: z.string(), secret: z.string() }).loose(),
        },
      },
    },
    '422': errorResponse('endpoint URL blocked (SSRF/HTTPS rules)'),
    ...standardResponses,
  },
});

registry.registerPath({
  method: 'get',
  path: '/v1/endpoints',
  ...secured(),
  summary: 'List endpoints',
  responses: {
    '200': {
      description: 'ok',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(z.object({ id: z.string(), url: z.string() }).loose()),
            nextCursor: z.string().nullable(),
          }),
        },
      },
    },
    ...standardResponses,
  },
});

registry.registerPath({
  method: 'get',
  path: '/v1/endpoints/{endpointId}',
  ...secured(),
  summary: 'Get one endpoint (no secret)',
  request: { params: z.object({ endpointId: z.string() }) },
  responses: {
    '200': {
      description: 'ok',
      content: {
        'application/json': { schema: z.object({ id: z.string(), url: z.string() }).loose() },
      },
    },
    '404': errorResponse('not found'),
    ...standardResponses,
  },
});

registry.registerPath({
  method: 'patch',
  path: '/v1/endpoints/{endpointId}',
  ...secured(),
  summary: 'Update endpoint fields',
  request: {
    params: z.object({ endpointId: z.string() }),
    body: { content: { 'application/json': { schema: updateEndpointSchema } } },
  },
  responses: {
    '200': {
      description: 'ok',
      content: { 'application/json': { schema: z.object({ id: z.string() }).loose() } },
    },
    '404': errorResponse('not found'),
    '422': errorResponse('endpoint URL blocked'),
    ...standardResponses,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/v1/endpoints/{endpointId}',
  ...secured(),
  summary: 'Soft delete (cancels in-flight deliveries)',
  request: { params: z.object({ endpointId: z.string() }) },
  responses: {
    '204': { description: 'deleted' },
    '404': errorResponse('not found'),
    ...standardResponses,
  },
});

registry.registerPath({
  method: 'post',
  path: '/v1/endpoints/{endpointId}/enable',
  ...secured(),
  summary: 'Enable an endpoint (also resets the breaker)',
  request: { params: z.object({ endpointId: z.string() }) },
  responses: {
    '200': {
      description: 'ok',
      content: { 'application/json': { schema: z.object({ id: z.string() }).loose() } },
    },
    '404': errorResponse('not found'),
    '409': errorResponse('already enabled'),
    ...standardResponses,
  },
});

registry.registerPath({
  method: 'post',
  path: '/v1/endpoints/{endpointId}/disable',
  ...secured(),
  summary: 'Disable an endpoint manually',
  request: { params: z.object({ endpointId: z.string() }) },
  responses: {
    '200': {
      description: 'ok',
      content: { 'application/json': { schema: z.object({ id: z.string() }).loose() } },
    },
    '404': errorResponse('not found'),
    '409': errorResponse('already disabled'),
    ...standardResponses,
  },
});

registry.registerPath({
  method: 'post',
  path: '/v1/endpoints/{endpointId}/rotate-secret',
  ...secured(),
  summary: 'Rotate the signing secret (old valid for the grace window)',
  request: {
    params: z.object({ endpointId: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({ gracePeriodHours: z.number().int().min(0).max(168).optional() }),
        },
      },
    },
  },
  responses: {
    '200': {
      description: 'ok (secret shown once)',
      content: {
        'application/json': { schema: z.object({ id: z.string(), secret: z.string() }).loose() },
      },
    },
    '404': errorResponse('not found'),
    ...standardResponses,
  },
});

registry.registerPath({
  method: 'get',
  path: '/v1/endpoints/{endpointId}/health',
  ...secured(),
  summary: 'Breaker state and recent stats',
  request: { params: z.object({ endpointId: z.string() }) },
  responses: {
    '200': {
      description: 'ok',
      content: {
        'application/json': {
          schema: z
            .object({
              state: z.enum(['closed', 'open', 'half_open']),
              consecutiveFailures: z.number().int(),
              stats24h: z.object({
                attempts: z.number().int(),
                succeeded: z.number().int(),
                failed: z.number().int(),
                p95Ms: z.number().int(),
              }),
            })
            .loose(),
        },
      },
    },
    '404': errorResponse('not found'),
    ...standardResponses,
  },
});

// --- deliveries -------------------------------------------------------------------

registry.registerPath({
  method: 'get',
  path: '/v1/deliveries',
  ...secured(),
  summary: 'List deliveries (filters: status, endpointId, eventId, from, to)',
  responses: {
    '200': {
      description: 'ok',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(z.object({ id: z.string(), status: z.string() }).loose()),
            nextCursor: z.string().nullable(),
          }),
        },
      },
    },
    ...standardResponses,
  },
});

registry.registerPath({
  method: 'get',
  path: '/v1/deliveries/{deliveryId}',
  ...secured(),
  summary: 'Get one delivery',
  request: { params: z.object({ deliveryId: z.string() }) },
  responses: {
    '200': {
      description: 'ok',
      content: {
        'application/json': { schema: z.object({ id: z.string(), status: z.string() }).loose() },
      },
    },
    '404': errorResponse('not found'),
    ...standardResponses,
  },
});

registry.registerPath({
  method: 'get',
  path: '/v1/deliveries/{deliveryId}/attempts',
  ...secured(),
  summary: 'All attempts for a delivery',
  request: { params: z.object({ deliveryId: z.string() }) },
  responses: {
    '200': {
      description: 'ok',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(z.object({ id: z.string(), attemptNumber: z.number().int() }).loose()),
            nextCursor: z.string().nullable(),
          }),
        },
      },
    },
    '404': errorResponse('not found'),
    ...standardResponses,
  },
});

export function buildOpenApiDocument(): Record<string, unknown> {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Hookline Public API',
      version: '1.0.0',
      description: 'Webhook delivery API. See API.md for the authoritative contract.',
    },
    servers: [{ url: '/' }],
  }) as unknown as Record<string, unknown>;
}
