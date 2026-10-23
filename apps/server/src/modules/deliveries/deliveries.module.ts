import type { DynamicModule } from '@nestjs/common';

import { ApiKeysModule } from '../api-keys/index.js';
import { DeliveriesController } from './deliveries.controller.js';
import { DeliveriesRepository } from './deliveries.repository.js';

let cachedModule: DynamicModule | undefined;

/** Cached so multiple importers share one module instance (Nest treats
 * distinct dynamic-module objects as separate modules and would duplicate
 * controllers/routes). */
export class DeliveriesModule {
  static forRoot(): DynamicModule {
    if (cachedModule) return cachedModule;
    cachedModule = {
      module: DeliveriesModule,
      imports: [ApiKeysModule.forRoot()],
      controllers: [DeliveriesController],
      providers: [DeliveriesRepository],
      exports: [DeliveriesRepository],
    };
    return cachedModule;
  }
}
