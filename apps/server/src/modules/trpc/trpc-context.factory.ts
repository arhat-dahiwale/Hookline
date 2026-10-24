import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import { AuthService } from '../auth/index.js';
import { WorkerOperations } from '../delivery-engine/index.js';
import type { TrpcMeta } from './trpc.js';

/**
 * Resolves the tRPC context from the incoming Fastify request: the Better
 * Auth session (shared resolver) plus the caller's role in their active
 * organization. Absent session/org leave the fields null; procedures guard.
 */
@Injectable()
export class TrpcContextFactory {
  constructor(
    private readonly authService: AuthService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async createFromCookie(cookieHeader: string | undefined): Promise<TrpcMeta> {
    const session = await this.authService.resolveSession(cookieHeader);
    if (!session) {
      return { session: null, organizationId: null, orgRole: null };
    }
    const organizationId = session.session.activeOrganizationId;
    const orgRole = organizationId
      ? await this.authService.getMemberRole(session.user.id, organizationId)
      : null;
    return { session, organizationId, orgRole };
  }

  /**
   * Worker operations are only present when the engine module is loaded
   * (ROLE=all/worker); the api role gets the gRPC adapter in Phase 10.
   */
  getWorkerOperations(): WorkerOperations | null {
    try {
      return this.moduleRef.get(WorkerOperations, { strict: false });
    } catch {
      return null;
    }
  }
}
