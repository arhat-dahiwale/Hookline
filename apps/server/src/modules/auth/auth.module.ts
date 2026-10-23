import type { DynamicModule } from '@nestjs/common';

import { AuthService } from './auth.service.js';
import { RolesGuard } from './roles.guard.js';
import { SessionGuard } from './session.guard.js';

export class AuthModule {
  static forRoot(): DynamicModule {
    return {
      module: AuthModule,
      providers: [AuthService, SessionGuard, RolesGuard],
      exports: [AuthService, SessionGuard, RolesGuard],
    };
  }
}
