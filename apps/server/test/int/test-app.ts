import type { Type } from '@nestjs/common';
import type { FastifyInstance } from 'fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';

import { AppModule, type Role } from '../../src/app.module.js';
import { registerApiDocsRoutes } from '../../src/modules/api-docs/index.js';
import { registerBetterAuthRoutes } from '../../src/modules/auth/index.js';
import { registerTrpcRoutes } from '../../src/modules/trpc/index.js';
import { parseEnv } from '../../src/modules/platform/index.js';
import { loadTestEnv } from './test-env.js';

export interface TestApplication {
  app: NestFastifyApplication;
  /** Fastify instance: use `instance.inject(...)` for requests. */
  instance: FastifyInstance;
  role: Role;
}

/**
 * Boots the full application against the Testcontainers-backed Postgres and
 * Redis. Extra controllers (e.g. guard fixtures) join the root testing module.
 * `role` selects the module composition (default 'all').
 */
export async function createTestApplication(
  controllers: Type[] = [],
  envOverrides: Partial<ReturnType<typeof loadTestEnv>> = {},
  role: Role = 'all',
): Promise<TestApplication> {
  const config = parseEnv({ ...loadTestEnv(), ...envOverrides, ROLE: role });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRole(role, config)],
    controllers,
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    logger: false,
  });
  app.useWebSocketAdapter(new WsAdapter(app));
  registerBetterAuthRoutes(app);
  registerApiDocsRoutes(app);
  if (role !== 'worker') {
    registerTrpcRoutes(app, config);
  }
  await app.init();
  const instance = app.getHttpAdapter().getInstance() as FastifyInstance;
  return { app, instance, role };
}

/** Listens on an ephemeral port; returns the base URL. */
export async function listen(testApp: TestApplication): Promise<string> {
  await testApp.app.listen(0, '127.0.0.1');
  const url = await testApp.app.getUrl();
  return url.replace('[::1]', '127.0.0.1');
}

/** Minimal cookie jar for light-my-request responses. */
export class CookieJar {
  private cookies = new Map<string, string>();

  capture(response: { headers: Record<string, unknown> }): void {
    const raw = response.headers['set-cookie'];
    if (!raw) return;
    const entries = Array.isArray(raw) ? raw : [raw];
    for (const line of entries) {
      const [pair] = String(line).split(';');
      const equals = pair.indexOf('=');
      if (equals > 0) {
        this.cookies.set(pair.slice(0, equals), pair.slice(equals + 1));
      }
    }
  }

  header(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  clear(): void {
    this.cookies.clear();
  }
}
