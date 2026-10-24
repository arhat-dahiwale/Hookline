'use client';

import { createAuthClient } from 'better-auth/react';
import { organizationClient } from 'better-auth/client/plugins';

/**
 * Better Auth browser client. Same-origin: the Next.js server rewrites
 * /api/auth/* to the API, so the session cookie stays on the dashboard origin.
 */
export const authClient = createAuthClient({
  plugins: [organizationClient()],
});

export const { signIn, signUp, signOut, useSession, organization } = authClient;
