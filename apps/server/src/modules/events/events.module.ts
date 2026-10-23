import type { DynamicModule } from '@nestjs/common';

import { ApiKeysModule } from '../api-keys/index.js';
import { DeliveriesModule } from '../deliveries/index.js';
import { EndpointsModule } from '../endpoints/index.js';
import { EventsController } from './events.controller.js';
import { EventsRepository } from './events.repository.js';
import { EventsService } from './events.service.js';
import { IngestionRateLimitGuard } from './ingestion-rate-limit.guard.js';

let cachedModule: DynamicModule | undefined;

/** Cached so multiple importers share one module instance (Nest treats
 * distinct dynamic-module objects as separate modules and would duplicate
 * controllers/routes). */
export class EventsModule {
  static forRoot(): DynamicModule {
    if (cachedModule) return cachedModule;
    cachedModule = {
      module: EventsModule,
      imports: [ApiKeysModule.forRoot(), EndpointsModule.forRoot(), DeliveriesModule.forRoot()],
      controllers: [EventsController],
      providers: [EventsRepository, EventsService, IngestionRateLimitGuard],
      exports: [EventsRepository, EventsService],
    };
    return cachedModule;
  }
}
