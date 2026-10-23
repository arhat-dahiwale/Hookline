import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import type { INestApplication } from '@nestjs/common';

const nodeRequire = createRequire(__filename);

/**
 * Serves Swagger UI at /docs (static assets from swagger-ui-dist under
 * /docs/*) and the OpenAPI spec at /openapi.json (controller).
 */
export function registerApiDocsRoutes(app: INestApplication): void {
  const instance = app.getHttpAdapter().getInstance() as FastifyInstance;
  const swaggerDist = dirname(nodeRequire.resolve('swagger-ui-dist/swagger-ui.css'));
  const specPath = '/openapi.json';

  void instance.register(async (scope) => {
    void scope.register(fastifyStatic, {
      root: swaggerDist,
      prefix: '/docs/',
      decorateReply: false,
      index: false,
    });

    scope.route({
      method: 'GET',
      url: '/docs',
      handler: async (_request, reply) => {
        const html = await readFile(join(swaggerDist, 'index.html'), 'utf8');
        reply
          .type('text/html')
          .send(
            html.replace(
              '</head>',
              `<script>window.onload = function() { window.ui = SwaggerUIBundle({ url: '${specPath}', dom_id: '#swagger-ui' }); };</script></head>`,
            ),
          );
      },
    });
  });
}
