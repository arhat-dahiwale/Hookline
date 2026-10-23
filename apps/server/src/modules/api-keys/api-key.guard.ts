import { Injectable, SetMetadata, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { forbidden, unauthorized } from '../platform/errors/app-error.js';
import type { ApiKeyScope } from './api-keys.schema.js';
// Value import: Nest DI needs the class in constructor param metadata.
import { ApiKeysService, type ResolvedApiKey } from './api-keys.service.js';

export const REQUIRED_SCOPES_KEY = 'hookline:requiredScopes';

/** Declares the API key scopes a public route requires (all must match). */
export const RequireScopes = (...scopes: ApiKeyScope[]) => SetMetadata(REQUIRED_SCOPES_KEY, scopes);

export interface ApiKeyRequest extends FastifyRequest {
  apiKeyContext?: ResolvedApiKey;
}

/**
 * Authenticates public REST requests via `Authorization: Bearer hl_live_...`
 * and enforces route scopes (401 invalid/revoked, 403 insufficient scope).
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly apiKeys: ApiKeysService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<ApiKeyScope[] | undefined>(
      REQUIRED_SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    );
    const request = context.switchToHttp().getRequest<ApiKeyRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw unauthorized('missing bearer api key');
    }
    const resolved = await this.apiKeys.verify(header.slice('Bearer '.length).trim());
    if (required && required.length > 0) {
      const missing = required.filter((scope) => !resolved.scopes.includes(scope));
      if (missing.length > 0) {
        throw forbidden(`api key lacks required scope: ${missing.join(', ')}`);
      }
    }
    request.apiKeyContext = resolved;
    return true;
  }
}
