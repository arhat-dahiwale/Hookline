import type { DynamicModule } from '@nestjs/common';

import { AnalyticsRepository } from './analytics.repository.js';

let cachedModule: DynamicModule | undefined;

/** Cached so multiple importers share one module instance (Nest treats
 * distinct dynamic-module objects as separate modules and would duplicate
 * controllers/routes). */
export class AnalyticsModule {
  static forRoot(): DynamicModule {
    if (cachedModule) return cachedModule;
    cachedModule = {
      module: AnalyticsModule,
      providers: [AnalyticsRepository],
      exports: [AnalyticsRepository],
    };
    return cachedModule;
  }
}
