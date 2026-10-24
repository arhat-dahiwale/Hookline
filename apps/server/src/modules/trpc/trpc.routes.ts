import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import type { FastifyInstance } from 'fastify';
import type { INestApplication } from '@nestjs/common';

import type { AppConfig } from '../platform/config/app-config.js';
import { PinoLoggerService } from '../platform/logger/pino-logger.service.js';
import { EndpointsRepository } from '../endpoints/index.js';
import { EndpointsService } from '../endpoints/index.js';
import { DeliveriesRepository } from '../deliveries/index.js';
import { TrpcContextFactory } from './trpc-context.factory.js';
import { createAppRouter } from './app-router.js';

const METHODS = ['GET', 'POST'] as const;

/**
 * Mounts the tRPC router at /trpc on the Fastify instance (API.md section 3).
 * Fastify has already parsed JSON bodies; the payload is re-serialized into a
 * Fetch request for the tRPC fetch adapter (same approach as Better Auth).
 * Registered BEFORE app.listen/init.
 */
export function registerTrpcRoutes(app: INestApplication, config: AppConfig): void {
  const contextFactory = app.get(TrpcContextFactory);
  const logger = app.get(PinoLoggerService).child({ module: 'trpc' });

  const appRouter = createAppRouter({
    config,
    endpointsService: app.get(EndpointsService),
    endpointsRepository: app.get(EndpointsRepository),
    deliveriesRepository: app.get(DeliveriesRepository),
    getWorkerOperations: () => contextFactory.getWorkerOperations(),
  });

  const instance = app.getHttpAdapter().getInstance() as FastifyInstance;
  instance.register(async (scope) => {
    for (const method of METHODS) {
      scope.route({
        method,
        url: '/trpc/*',
        handler: async (request, reply) => {
          const origin = `http://${(request.headers.host as string | undefined) ?? 'localhost'}`;
          const url = new URL(request.url, origin);
          const headers = new Headers();
          for (const [key, value] of Object.entries(request.headers)) {
            if (value === undefined) continue;
            headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
          }
          const body =
            method === 'POST' && request.body !== undefined && request.body !== null
              ? JSON.stringify(request.body)
              : undefined;
          const webRequest = new Request(url, {
            method,
            headers,
            body,
          });

          const response = await fetchRequestHandler({
            endpoint: '/trpc',
            req: webRequest,
            router: appRouter,
            createContext: () => contextFactory.createFromCookie(request.headers.cookie),
            onError({ error }) {
              logger.error({ path: request.url, err: error }, 'trpc request failed');
            },
          });

          reply.status(response.status);
          response.headers.forEach((value: string, key: string) => {
            reply.header(key, value);
          });
          const text = await response.text();
          return reply.send(text.length > 0 ? text : null);
        },
      });
    }
  });
}
