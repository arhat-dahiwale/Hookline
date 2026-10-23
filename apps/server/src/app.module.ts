import type { DynamicModule } from '@nestjs/common';

import { AuthModule } from './modules/auth/index.js';
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
    const auth = role !== 'worker' ? [AuthModule.forRoot()] : [];
    const health = role !== 'worker' ? [HealthModule.forRoot()] : [];
    const workerModules = role !== 'api' ? [] : []; // Phase 5: delivery engine

    return {
      module: AppModule,
      imports: [PlatformModule.withConfig(config), ...auth, ...health, ...workerModules],
      // Re-exported so test root modules (and protocol layers) can resolve
      // guards and services without importing each feature module directly.
      exports: [...auth, ...health],
    };
  }
}
