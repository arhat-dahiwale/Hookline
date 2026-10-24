import { headers } from 'next/headers';

/** Session shape served by Better Auth's /api/auth/get-session. */
export interface ServerSession {
  user: { id: string; email: string; name: string };
  session: { id: string; activeOrganizationId: string | null };
}

/**
 * Server-side session resolution: forwards the browser cookies to the API's
 * Better Auth endpoint (same pattern as the client, but from RSC). Returns
 * null for anonymous visitors.
 */
export async function getServerSession(): Promise<ServerSession | null> {
  const cookieHeader = (await headers()).get('cookie') ?? '';
  const apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:4000';
  const response = await fetch(`${apiOrigin}/api/auth/get-session`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  });
  if (!response.ok) return null;
  return (await response.json()) as ServerSession | null;
}
