import type { DynamicModule } from '@nestjs/common';

import { ApiKeysModule } from '../api-keys/index.js';
import { AuditModule } from '../audit/index.js';
import { DeliveriesModule } from '../deliveries/index.js';
import { SecretCipher } from '../platform/crypto/secret-cipher.js';
import { EndpointsController } from './endpoints.controller.js';
import { EndpointsRepository } from './endpoints.repository.js';
import { EndpointsService } from './endpoints.service.js';

let cachedModule: DynamicModule | undefined;

/** Cached so multiple importers share one module instance (Nest treats
 * distinct dynamic-module objects as separate modules and would duplicate
 * controllers/routes). */
export class EndpointsModule {
  static forRoot(): DynamicModule {
    if (cachedModule) return cachedModule;
    cachedModule = {
      module: EndpointsModule,
      imports: [AuditModule.forRoot(), ApiKeysModule.forRoot(), DeliveriesModule.forRoot()],
      controllers: [EndpointsController],
      providers: [EndpointsRepository, EndpointsService, SecretCipher],
      exports: [EndpointsRepository, EndpointsService, SecretCipher],
    };
    return cachedModule;
  }
}
