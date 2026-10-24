import { NextResponse, type NextRequest } from 'next/server';

/**
 * Coarse route protection (edge): redirects visitors without a Better Auth
 * session cookie to /sign-in and signed-in users away from the auth pages.
 * The real authorization happens server-side (tRPC role middleware, REST
 * guards); this only avoids rendering protected shells for anonymous users.
 */
const SESSION_COOKIE = 'better-auth.session_token';

const PROTECTED_PREFIXES = [
  '/overview',
  '/endpoints',
  '/events',
  '/deliveries',
  '/api-keys',
  '/members',
  '/analytics',
  '/settings',
];
const AUTH_PAGES = ['/sign-in', '/sign-up'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_COOKIE);

  if (PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix)) && !hasSession) {
    const signInUrl = new URL('/sign-in', request.url);
    return NextResponse.redirect(signInUrl);
  }
  if (AUTH_PAGES.includes(pathname) && hasSession) {
    return NextResponse.redirect(new URL('/overview', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/overview/:path*',
    '/endpoints/:path*',
    '/events/:path*',
    '/deliveries/:path*',
    '/api-keys/:path*',
    '/members/:path*',
    '/analytics/:path*',
    '/settings/:path*',
    '/sign-in',
    '/sign-up',
  ],
};
