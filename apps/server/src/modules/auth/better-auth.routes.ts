import type { FastifyInstance } from 'fastify';

import type { INestApplication } from '@nestjs/common';

import { AuthService } from './auth.service.js';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const;

/**
 * Mounts Better Auth at /api/auth/* on the Fastify instance. The BA instance
 * itself is a Fetch-style handler (`auth.handler(request)`).
 *
 * Registered BEFORE the instance becomes ready (call between app creation
 * and app.listen/init). Fastify's JSON parser has already parsed the body;
 * JSON bodies are re-serialized (equivalent for BA, which parses JSON itself).
 */
export function registerBetterAuthRoutes(app: INestApplication): void {
  const authService = app.get(AuthService);
  const instance = app.getHttpAdapter().getInstance() as FastifyInstance;
  const handler = authService.instance.handler;

  instance.register(async (scope) => {
    scope.route({
      method: [...METHODS],
      url: '/api/auth/*',
      handler: async (request, reply) => {
        const origin = `http://${(request.headers.host as string | undefined) ?? 'localhost'}`;
        const url = new URL(request.url, origin);
        const headers = new Headers();
        for (const [key, value] of Object.entries(request.headers)) {
          if (value === undefined) continue;
          headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
        }
        let body: Uint8Array | undefined;
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          if (Buffer.isBuffer(request.body) && request.body.length > 0) {
            body = new Uint8Array(request.body);
          } else if (
            typeof request.body === 'object' &&
            request.body !== null &&
            Object.keys(request.body).length > 0
          ) {
            body = new TextEncoder().encode(JSON.stringify(request.body));
          }
        }
        const webRequest = new Request(url, {
          method: request.method,
          headers,
          body,
          redirect: 'manual',
        });
        const response = await handler(webRequest);

        reply.status(response.status);
        response.headers.forEach((value: string, key: string) => {
          if (key !== 'set-cookie') reply.header(key, value);
        });
        const setCookies = response.headers.getSetCookie();
        if (setCookies.length > 0) reply.header('set-cookie', setCookies);

        const buffer = Buffer.from(await response.arrayBuffer());
        return reply.send(buffer.length > 0 ? buffer : null);
      },
    });
  });
}
