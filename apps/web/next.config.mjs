/**
 * The dashboard reaches the API through same-origin paths so it matches the
 * nginx topology planned for Phase 13: /trpc and /api/auth are rewritten to
 * the API origin (API_PORT defaults to 4000, see .env.example).
 */
const apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:4000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      { source: '/trpc/:path*', destination: `${apiOrigin}/trpc/:path*` },
      { source: '/api/auth/:path*', destination: `${apiOrigin}/api/auth/:path*` },
    ];
  },
};

export default nextConfig;
