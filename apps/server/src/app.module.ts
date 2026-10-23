import type { DynamicModule } from '@nestjs/common';

import { AnalyticsModule } from './modules/analytics/index.js';
import { ApiDocsModule } from './modules/api-docs/index.js';
import { ApiKeysModule } from './modules/api-keys/index.js';
import { AuditModule } from './modules/audit/index.js';
import { AuthModule } from './modules/auth/index.js';
import { DeliveriesModule } from './modules/deliveries/index.js';
import { EndpointsModule } from './modules/endpoints/index.js';
import { EventsModule } from './modules/events/index.js';
import { HealthModule } from './modules/health/index.js';
import { PlatformModule } from './modules/platform/index.js';
import type { AppConfig } from './modules/platform/index.js';

export type Role = 'api' | 'worker' | 'all';

/**
 * Role-based module composition (ARCHITECTURE.md section 3):
 * - `api`: HTTP-serving modules (REST, health, later tRPC/WS/auth)
 * - `worker`: queue processors and schedulers (Phase 5+), no HTTP
 * - `all`: both, with in-process adapters (local development)
 */
export class AppModule {
  static forRole(role: Role, config: AppConfig): DynamicModule {
    const httpModules =
      role !== 'worker'
        ? [
            AuthModule.forRoot(),
            AuditModule.forRoot(),
            ApiKeysModule.forRoot(),
            EndpointsModule.forRoot(),
            EventsModule.forRoot(),
            DeliveriesModule.forRoot(),
            AnalyticsModule.forRoot(),
            ApiDocsModule.forRoot(),
            HealthModule.forRoot(),
          ]
        : [];
    const workerModules = role !== 'api' ? [] : []; // Phase 5: delivery engine

    return {
      module: AppModule,
      imports: [PlatformModule.withConfig(config), ...httpModules, ...workerModules],
      // Re-exported so test root modules (and protocol layers) can resolve
      // guards and services without importing each feature module directly.
      exports: [...httpModules],
    };
  }
}
