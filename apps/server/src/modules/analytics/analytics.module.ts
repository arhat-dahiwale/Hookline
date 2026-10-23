import type { DynamicModule } from '@nestjs/common';

import { AnalyticsRepository } from './analytics.repository.js';

export class AnalyticsModule {
  static forRoot(): DynamicModule {
    return {
      module: AnalyticsModule,
      providers: [AnalyticsRepository],
      exports: [AnalyticsRepository],
    };
  }
}
