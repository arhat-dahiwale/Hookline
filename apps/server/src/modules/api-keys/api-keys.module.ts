import type { DynamicModule } from '@nestjs/common';

import { AuditModule } from '../audit/index.js';
import { ApiKeyGuard } from './api-key.guard.js';
import { ApiKeysRepository } from './api-keys.repository.js';
import { ApiKeysService } from './api-keys.service.js';

let cachedModule: DynamicModule | undefined;

/** Cached so multiple importers share one module instance (Nest treats
 * distinct dynamic-module objects as separate modules and would duplicate
 * controllers/routes). */
export class ApiKeysModule {
  static forRoot(): DynamicModule {
    if (cachedModule) return cachedModule;
    cachedModule = {
      module: ApiKeysModule,
      imports: [AuditModule.forRoot()],
      providers: [ApiKeysRepository, ApiKeysService, ApiKeyGuard],
      exports: [ApiKeysRepository, ApiKeysService, ApiKeyGuard],
    };
    return cachedModule;
  }
}
