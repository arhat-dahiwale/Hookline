import type { DynamicModule } from '@nestjs/common';

import { AuthService } from './auth.service.js';
import { RolesGuard } from './roles.guard.js';
import { SessionGuard } from './session.guard.js';

let cachedModule: DynamicModule | undefined;

/** Cached so multiple importers share one module instance (Nest treats
 * distinct dynamic-module objects as separate modules and would duplicate
 * controllers/routes). */
export class AuthModule {
  static forRoot(): DynamicModule {
    if (cachedModule) return cachedModule;
    cachedModule = {
      module: AuthModule,
      providers: [AuthService, SessionGuard, RolesGuard],
      exports: [AuthService, SessionGuard, RolesGuard],
    };
    return cachedModule;
  }
}
