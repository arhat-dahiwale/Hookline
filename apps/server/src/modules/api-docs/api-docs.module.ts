import type { DynamicModule } from '@nestjs/common';

import { ApiDocsController } from './api-docs.controller.js';

let cachedModule: DynamicModule | undefined;

/** Cached so multiple importers share one module instance (Nest treats
 * distinct dynamic-module objects as separate modules and would duplicate
 * controllers/routes). */
export class ApiDocsModule {
  static forRoot(): DynamicModule {
    if (cachedModule) return cachedModule;
    cachedModule = {
      module: ApiDocsModule,
      controllers: [ApiDocsController],
    };
    return cachedModule;
  }
}
