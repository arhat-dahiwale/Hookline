import type { DynamicModule } from '@nestjs/common';

import { AuditService } from './audit.service.js';

export class AuditModule {
  static forRoot(): DynamicModule {
    return {
      module: AuditModule,
      providers: [AuditService],
      exports: [AuditService],
    };
  }
}
