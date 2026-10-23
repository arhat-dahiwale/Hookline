import { Injectable, SetMetadata, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { forbidden } from '../platform/errors/app-error.js';
import type { OrgRole } from './session-context.js';
import { roleAtLeast } from './session-context.js';
// Value import: Nest DI needs the class in constructor param metadata.
import { AuthService } from './auth.service.js';
import type { SessionRequest } from './session.guard.js';

export const MIN_ROLE_KEY = 'hookline:minRole';

/** Minimum organization role required for a route (default: any member). */
export const MinRole = (role: OrgRole) => SetMetadata(MIN_ROLE_KEY, role);

export interface RoleRequest extends SessionRequest {
  hooklineOrgRole?: OrgRole;
}

/**
 * Checks the session user's role in their ACTIVE organization against the
 * route's minimum (see API.md role requirements). Must run after
 * SessionGuard.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<OrgRole | undefined>(MIN_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<RoleRequest>();
    const session = request.hooklineSession;
    if (!session) {
      // RolesGuard only makes sense behind SessionGuard.
      throw forbidden('authentication required');
    }
    const organizationId = session.session.activeOrganizationId;
    if (!organizationId) {
      throw forbidden('no active organization');
    }
    const role = await this.authService.getMemberRole(session.user.id, organizationId);
    if (!role) {
      throw forbidden('not a member of the active organization');
    }
    request.hooklineOrgRole = role;

    if (required === undefined) return true;
    if (!roleAtLeast(role, required)) {
      throw forbidden(`requires ${required} role`);
    }
    return true;
  }
}
