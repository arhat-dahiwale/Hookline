'use client';

import { createTRPCReact } from '@trpc/react-query';
import { httpBatchLink } from '@trpc/client';

import type { AppRouter } from '@hookline/server/trpc-router';

/**
 * Client binding for the tRPC API (same-origin rewrite to the API instance).
 * The router type is imported type-only from the server source — never at
 * runtime — so the dashboard stays strictly typed against API.md section 3.
 */
export const trpc = createTRPCReact<AppRouter>();

export function createTrpcQueryClient() {
  return trpc.createClient({
    links: [httpBatchLink({ url: '/trpc' })],
  });
}
