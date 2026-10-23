import type { DynamicModule } from '@nestjs/common';

import { AuditModule } from '../audit/index.js';
import { ApiKeyGuard } from './api-key.guard.js';
import { ApiKeysRepository } from './api-keys.repository.js';
import { ApiKeysService } from './api-keys.service.js';

export class ApiKeysModule {
  static forRoot(): DynamicModule {
    return {
      module: ApiKeysModule,
      imports: [AuditModule.forRoot()],
      providers: [ApiKeysRepository, ApiKeysService, ApiKeyGuard],
      exports: [ApiKeysRepository, ApiKeysService, ApiKeyGuard],
    };
  }
}
