import type { DynamicModule } from '@nestjs/common';

import { AuditModule } from '../audit/index.js';
import { SettingsRepository } from './settings.repository.js';
import { SettingsService } from './settings.service.js';

let cachedModule: DynamicModule | undefined;

/** Cached: tRPC and future retention jobs share one module instance. */
export class SettingsModule {
  static forRoot(): DynamicModule {
    if (cachedModule) return cachedModule;
    cachedModule = {
      module: SettingsModule,
      imports: [AuditModule.forRoot()],
      providers: [SettingsRepository, SettingsService],
      exports: [SettingsRepository, SettingsService],
    };
    return cachedModule;
  }
}
