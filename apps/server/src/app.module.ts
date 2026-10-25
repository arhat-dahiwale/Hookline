import type { DynamicModule } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { AnalyticsModule } from './modules/analytics/index.js';
import { ApiDocsModule } from './modules/api-docs/index.js';
import { ApiKeysModule } from './modules/api-keys/index.js';
import { AuditModule } from './modules/audit/index.js';
import { AuthModule } from './modules/auth/index.js';
import { DeliveriesModule } from './modules/deliveries/index.js';
import { DeliveryEngineModule } from './modules/delivery-engine/index.js';
import { EndpointsModule } from './modules/endpoints/index.js';
import { EventsModule } from './modules/events/index.js';
import { HealthModule } from './modules/health/index.js';
import { PlatformModule } from './modules/platform/index.js';
import { RealtimeModule } from './modules/realtime/index.js';
import { ObservabilityModule } from './modules/observability/index.js';
import { WorkerOpsModule } from './modules/worker-ops/index.js';
import { TrpcModule } from './modules/trpc/index.js';
import type { AppConfig } from './modules/platform/index.js';

export type Role = 'api' | 'worker' | 'all';

/**
 * Role-based module composition (ARCHITECTURE.md section 3):
 * - `api`: HTTP-serving modules (REST, health, later tRPC/WS/auth)
 * - `worker`: queue processors and schedulers, no HTTP
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
            AnalyticsModule.forRole(role),
            ApiDocsModule.forRoot(),
            HealthModule.forRoot(),
            TrpcModule.forRoot(),
          ]
        : [];
    // The delivery engine (processor) runs only in worker/all roles.
    const workerModules = role !== 'api' ? [DeliveryEngineModule.forRoot()] : [];

    return {
      module: AppModule,
      imports: [
        EventEmitterModule.forRoot(),
        PlatformModule.withConfig(config),
        ObservabilityModule.forRole(role),
        // Workers publish bus events to Redis; APIs fan out to WS sockets.
        RealtimeModule.forRoot(),
        // Adapter selection: gRPC client on api, in-process on worker/all.
        WorkerOpsModule.forRole(role),
        ...httpModules,
        ...workerModules,
      ],
      // Re-exported so test root modules (and protocol layers) can resolve
      // guards and services without importing each feature module directly.
      exports: [...httpModules, ...workerModules],
    };
  }
}
