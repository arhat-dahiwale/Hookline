import type { DynamicModule } from '@nestjs/common';

import { AuditService } from './audit.service.js';

let cachedModule: DynamicModule | undefined;

/** Cached so multiple importers share one module instance (Nest treats
 * distinct dynamic-module objects as separate modules and would duplicate
 * controllers/routes). */
export class AuditModule {
  static forRoot(): DynamicModule {
    if (cachedModule) return cachedModule;
    cachedModule = {
      module: AuditModule,
      providers: [AuditService],
      exports: [AuditService],
    };
    return cachedModule;
  }
}
