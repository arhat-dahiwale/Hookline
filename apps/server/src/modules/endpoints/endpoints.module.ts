import type { DynamicModule } from '@nestjs/common';

import { AuditModule } from '../audit/index.js';
import { SecretCipher } from '../platform/crypto/secret-cipher.js';
import { EndpointsRepository } from './endpoints.repository.js';
import { EndpointsService } from './endpoints.service.js';

export class EndpointsModule {
  static forRoot(): DynamicModule {
    return {
      module: EndpointsModule,
      imports: [AuditModule.forRoot()],
      providers: [EndpointsRepository, EndpointsService, SecretCipher],
      exports: [EndpointsRepository, EndpointsService, SecretCipher],
    };
  }
}
