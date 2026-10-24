/**
 * Type-only entry point for the dashboard: exposes the tRPC router type for
 * `import type { AppRouter }` (never imported at runtime by the web app).
 */
export type { AppRouter } from './modules/trpc/app-router.js';
