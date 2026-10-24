import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { betterAuth } from 'better-auth';
import { organization, twoFactor } from 'better-auth/plugins';

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import {
  account,
  invitation,
  member,
  organization as organizationTable,
  session,
  twoFactor as twoFactorTable,
  user,
  verification,
} from './auth-schema.js';

function buildAuthOptions(
  db: NodePgDatabase,
  env: {
    secret: string;
    baseURL: string;
    useSecureCookies: boolean;
    trustedOrigins: string[];
  },
) {
  return {
    secret: env.secret,
    baseURL: env.baseURL,
    // The dashboard lives on its own origin (web app in dev / nginx in
    // production); its requests carry that Origin on POSTs.
    trustedOrigins: env.trustedOrigins,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user,
        session,
        account,
        verification,
        organization: organizationTable,
        member,
        invitation,
        twoFactor: twoFactorTable,
      },
    }),
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      minPasswordLength: 8,
    },
    advanced: {
      // Sessions live in Postgres so any API replica can validate them.
      useSecureCookies: env.useSecureCookies,
    },
    plugins: [organization(), twoFactor({ issuer: 'Hookline' })],
  };
}

/**
 * Creates the Better Auth instance. Single source of options, shared by the
 * runtime (AuthService) and the CLI config (auth.config.ts) so the generated
 * schema and the live instance never drift.
 */
export function createAuth(
  db: NodePgDatabase,
  env: { secret: string; baseURL: string; useSecureCookies: boolean; trustedOrigins: string[] },
) {
  return betterAuth(buildAuthOptions(db, env));
}

export type HooklineAuth = ReturnType<typeof createAuth>;
