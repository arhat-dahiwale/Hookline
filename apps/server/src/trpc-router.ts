/**
 * Type-only entry point for the dashboard (never imported at runtime by the
 * web app): the tRPC router type and the WebSocket envelope contract.
 */
export type { AppRouter } from './modules/trpc/app-router.js';
export type { WsEnvelope } from './modules/realtime/realtime.types.js';
