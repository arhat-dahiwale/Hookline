import { Inject, Injectable } from '@nestjs/common';

import { and, eq } from 'drizzle-orm';

import { APP_CONFIG, type AppConfig } from '../platform/config/app-config.js';
import { DatabaseService } from '../platform/database/database.service.js';
import { createAuth, type HooklineAuth } from './auth-options.js';
import { member } from './auth-schema.js';
import { parseOrgRole, type OrgRole, type SessionContext } from './session-context.js';

/**
 * Better Auth wiring. The instance is built over the platform Drizzle DB so
 * sessions, users and organizations live in our Postgres. Also exposes the
 * session and role resolution every protocol layer (REST guards now, tRPC
 * and WebSocket later) shares.
 */
@Injectable()
export class AuthService {
  readonly instance: HooklineAuth;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly database: DatabaseService,
  ) {
    this.instance = createAuth(this.database.db, {
      secret: config.BETTER_AUTH_SECRET,
      baseURL: config.BETTER_AUTH_URL,
      useSecureCookies: config.NODE_ENV === 'production',
    });
  }

  /** Shared session resolution (used by REST guards, tRPC context and WS). */
  async resolveSession(cookieHeader: string | undefined): Promise<SessionContext | null> {
    if (!cookieHeader) return null;
    const headers = new Headers({ cookie: cookieHeader });
    const result = await this.instance.api.getSession({ headers });
    if (!result) return null;
    const { user, session } = result;
    return {
      user: { id: user.id, email: user.email, name: user.name },
      session: {
        id: session.id,
        userId: session.userId,
        activeOrganizationId:
          (session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null,
        expiresAt: session.expiresAt,
      },
    };
  }

  /** Reads the member row (auth-owned table) for the user's role in an org. */
  async getMemberRole(userId: string, organizationId: string): Promise<OrgRole | null> {
    const rows = await this.database.db
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
      .limit(1);
    const role = rows[0]?.role;
    return role === undefined ? null : parseOrgRole(role);
  }
}
