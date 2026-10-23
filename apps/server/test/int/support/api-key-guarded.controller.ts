import { Controller, Get, Req, UseGuards } from '@nestjs/common';

import {
  ApiKeyGuard,
  RequireScopes,
  type ApiKeyRequest,
} from '../../../src/modules/api-keys/index.js';

/** Guard fixture for public-API-style routes (not part of the public API). */
@Controller('test-api')
@UseGuards(ApiKeyGuard)
export class ApiKeyGuardedController {
  @Get('whoami')
  whoami(@Req() request: ApiKeyRequest): { organizationId: string; scopes: string[] } {
    return {
      organizationId: request.apiKeyContext!.organizationId,
      scopes: request.apiKeyContext!.scopes,
    };
  }

  @Get('write-only')
  @RequireScopes('events:write')
  writeOnly(): { ok: true } {
    return { ok: true };
  }
}
