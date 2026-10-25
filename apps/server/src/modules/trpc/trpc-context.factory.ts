import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import { AuthService } from '../auth/index.js';
import { WORKER_OPERATIONS, type WorkerOperationsService } from '../worker-ops/index.js';
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
   * The active worker-operations adapter: in-process on worker/all, the gRPC
   * client on the api role (Phase 10). Both satisfy WorkerOperationsService.
   */
  getWorkerOperations(): WorkerOperationsService | null {
    try {
      return this.moduleRef.get(WORKER_OPERATIONS, { strict: false });
    } catch {
      return null;
    }
  }
}
