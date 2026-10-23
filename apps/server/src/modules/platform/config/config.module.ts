import type { DynamicModule } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from './app-config.js';

/**
 * Registers an already-parsed config (parsed once in main.ts so the process
 * fails before Nest boots on invalid env).
 */
export class ConfigModule {
  static withConfig(config: AppConfig): DynamicModule {
    return {
      module: ConfigModule,
      global: true,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
