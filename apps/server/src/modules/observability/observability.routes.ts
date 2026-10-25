import type { FastifyInstance } from 'fastify';
import type { INestApplication } from '@nestjs/common';

import { MetricsService } from './metrics.js';

/** Routes that carry IDs get a stable low-cardinality label instead. */
const UNMATCHED_ROUTE = 'unmatched';

/**
 * GET /metrics (Prometheus text format). Unauthenticated by design — scrape
 * target on a network-isolated interface in production deployments.
 */
export function registerObservabilityRoutes(app: INestApplication): void {
  const metrics = app.get(MetricsService);
  const instance = app.getHttpAdapter().getInstance() as FastifyInstance;
  instance.route({
    method: 'GET',
    url: '/metrics',
    handler: async (_request, reply) => {
      reply.header('content-type', metrics.contentType());
      return metrics.render();
    },
  });
  registerHttpDurationHook(instance, metrics);
}

/**
 * Records `hookline_http_request_duration_seconds{route,method,status}`
 * (ARCHITECTURE.md 7.3). The route label is the Fastify route TEMPLATE
 * (`/v1/events/:eventId`), never a raw path — IDs and query strings must
 * not become label values (cardinality rule).
 *
 * Must be called before the instance boots (listen/ready).
 */
export function registerHttpDurationHook(instance: FastifyInstance, metrics: MetricsService): void {
  instance.addHook('onResponse', (request, reply, done) => {
    const route = (request.routeOptions?.url as string | undefined) ?? UNMATCHED_ROUTE;
    metrics.httpRequestDuration.observe(
      { route, method: request.method, status: String(reply.statusCode) },
      reply.elapsedTime / 1000,
    );
    done();
  });
}
