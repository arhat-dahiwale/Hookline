import type { DynamicModule } from '@nestjs/common';

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
    const httpModules = role !== 'worker' ? [HealthModule.forRoot()] : [];
    const workerModules = role !== 'api' ? [] : []; // Phase 5: delivery engine

    return {
      module: AppModule,
      imports: [PlatformModule.withConfig(config), ...httpModules, ...workerModules],
    };
  }
}
