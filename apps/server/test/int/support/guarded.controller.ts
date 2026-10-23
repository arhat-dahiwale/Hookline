import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';

import {
  MinRole,
  RolesGuard,
  SessionGuard,
  type RoleRequest,
} from '../../../src/modules/auth/index.js';

/**
 * Guard fixture: not part of the app's public API. Exercises SessionGuard
 * and RolesGuard against real sessions/roles in integration tests.
 */
@Controller('test-guard')
@UseGuards(SessionGuard)
export class GuardedController {
  @Get('me')
  me(@Req() request: RoleRequest): { userId: string; activeOrganizationId: string | null } {
    return {
      userId: request.hooklineSession!.user.id,
      activeOrganizationId: request.hooklineSession!.session.activeOrganizationId,
    };
  }

  @Get('org')
  @UseGuards(RolesGuard)
  org(@Req() request: RoleRequest): { organizationId: string; role: string } {
    return {
      organizationId: request.hooklineSession!.session.activeOrganizationId!,
      role: request.hooklineOrgRole!,
    };
  }

  @Post('admin-action')
  @UseGuards(RolesGuard)
  @MinRole('admin')
  adminAction(): { ok: true } {
    return { ok: true };
  }
}
