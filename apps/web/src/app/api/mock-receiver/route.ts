import type { NextRequest } from 'next/server';

/**
 * Local webhook receiver for the Playwright E2E suite (and manual demos):
 * accepts any POST, verifies a signature header is present, and records the
 * last delivery in memory for assertions. Dev/test helper only.
 */
const received: { path: string; hasSignature: boolean; at: string }[] = [];

export async function POST(request: NextRequest): Promise<Response> {
  received.push({
    path: request.nextUrl.pathname,
    hasSignature: request.headers.has('hookline-signature'),
    at: new Date().toISOString(),
  });
  return Response.json({ ok: true });
}

export async function GET(): Promise<Response> {
  return Response.json({ received: received.length, last: received[received.length - 1] ?? null });
}
