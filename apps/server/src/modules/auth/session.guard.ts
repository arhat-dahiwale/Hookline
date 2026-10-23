import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { unauthorized } from '../platform/errors/app-error.js';
import type { SessionContext } from './session-context.js';
// Value import: Nest DI needs the class in constructor param metadata.
import { AuthService } from './auth.service.js';

/** Augmented request carrying the resolved session. */
export interface SessionRequest extends FastifyRequest {
  hooklineSession?: SessionContext;
}

/**
 * Resolves the Better Auth session from the cookie header and attaches it to
 * the request. Rejects with the standard 401 body when absent/invalid.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SessionRequest>();
    const session = await this.authService.resolveSession(request.headers.cookie);
    if (!session) {
      throw unauthorized('authentication required');
    }
    request.hooklineSession = session;
    return true;
  }
}
