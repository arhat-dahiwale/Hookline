import {
  Inject,
  Injectable,
  Logger,
  type DynamicModule,
  type OnApplicationBootstrap,
} from '@nestjs/common';

import type { Role } from '../../app.module.js';
import { APP_CONFIG, type AppConfig } from '../platform/config/app-config.js';
import { EventsModule } from '../events/index.js';
import { SettingsModule } from '../settings/index.js';
import { AnalyticsRepository } from './analytics.repository.js';
import { AnalyticsService } from './analytics.service.js';

/** Starts the rollup + retention schedulers in worker/all roles. */
@Injectable()
export class AnalyticsBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(AnalyticsBootstrap.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly analytics: AnalyticsService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.ROLE === 'api') return;
    void this.analytics.start().catch((error: unknown) => {
      this.logger.error(
        `analytics schedulers failed to start: ${error instanceof Error ? error.message : error}`,
      );
    });
  }
}

let cachedApiModule: DynamicModule | undefined;
let cachedWorkerModule: DynamicModule | undefined;

/** Role-gated: the api role gets the stats queries, worker/all the jobs too. */
export class AnalyticsModule {
  static forRole(role: Role): DynamicModule {
    const base = {
      module: AnalyticsModule,
      imports: [EventsModule.forRoot(), SettingsModule.forRoot()],
      providers: [AnalyticsRepository, AnalyticsService],
      exports: [AnalyticsRepository, AnalyticsService],
    };
    if (role === 'api') {
      cachedApiModule ??= base;
      return cachedApiModule;
    }
    cachedWorkerModule ??= {
      ...base,
      providers: [...base.providers, AnalyticsBootstrap],
    };
    return cachedWorkerModule;
  }
}
