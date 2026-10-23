import { APP_FILTER } from '@nestjs/core';

import { ConfigModule } from './config/config.module.js';
import type { AppConfig } from './config/app-config.js';
import { DatabaseModule } from './database/database.module.js';
import { AllExceptionsFilter } from './errors/all-exceptions.filter.js';
import { LoggerModule } from './logger/logger.module.js';
import { RedisModule } from './redis/redis.module.js';
import { ShutdownService } from './shutdown/shutdown.service.js';

/**
 * The shared kernel: config, logger, database, redis, error handling and
 * shutdown state. Every role (api/worker/all) imports it. Other modules may
 * import anything under platform/ at any depth (see eslint boundary rules).
 */
export class PlatformModule {
  static withConfig(config: AppConfig) {
    return {
      module: PlatformModule,
      global: true,
      imports: [ConfigModule.withConfig(config), LoggerModule, DatabaseModule, RedisModule],
      providers: [
        ShutdownService,
        {
          provide: APP_FILTER,
          useClass: AllExceptionsFilter,
        },
      ],
      exports: [ShutdownService],
    };
  }
}
