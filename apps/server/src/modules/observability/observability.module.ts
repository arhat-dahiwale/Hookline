import {
  Injectable,
  type DynamicModule,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Inject, Logger } from '@nestjs/common';
import { createServer, type Server } from 'node:http';

import type { Role } from '../../app.module.js';
import { APP_CONFIG, type AppConfig } from '../platform/config/app-config.js';
import { MetricsService } from './metrics.js';

/** Serves /metrics from a standalone HTTP server for the worker role. */
@Injectable()
export class WorkerMetricsServer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerMetricsServer.name);
  private server: Server | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly metrics: MetricsService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.ROLE !== 'worker') return;
    const server = createServer((request, response) => {
      if (request.url !== '/metrics') {
        response.writeHead(404).end();
        return;
      }
      void this.metrics.render().then(
        (body) => {
          response.writeHead(200, { 'content-type': this.metrics.contentType() });
          response.end(body);
        },
        (error: unknown) => {
          this.logger.error(
            `metrics render failed: ${error instanceof Error ? error.message : error}`,
          );
          response.writeHead(500).end();
        },
      );
    });
    server.listen(this.config.PORT, '0.0.0.0', () => {
      this.logger.log(`worker metrics server listening on ${this.config.PORT}/metrics`);
    });
    this.server = server;
  }

  onApplicationShutdown(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return Promise.resolve();
    return new Promise((resolve) => {
      server.close(() => resolve());
    });
  }
}

/**
 * Observability (ARCHITECTURE.md 7.3): the metrics registry on every role,
 * /metrics on the API instance(s) via a Fastify route, and a standalone
 * metrics HTTP server for the worker role.
 *
 * The module is cached on first forRole() call, and feature modules import
 * it with forRole('api') BEFORE AppModule's own forRole(role) is evaluated
 * (their arrays are built first) — so role-specific PROVIDERS must never
 * depend on this argument. WorkerMetricsServer is therefore always provided
 * and gates itself on config.ROLE inside its bootstrap hook.
 */
let cachedModule: DynamicModule | undefined;

export class ObservabilityModule {
  static forRole(_role: Role): DynamicModule {
    cachedModule ??= {
      module: ObservabilityModule,
      imports: [],
      providers: [MetricsService, WorkerMetricsServer],
      exports: [MetricsService],
    };
    return cachedModule;
  }
}
