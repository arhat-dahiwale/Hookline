import { TRPCError, initTRPC } from '@trpc/server';
// Value import: `instanceof ZodError` needs the runtime binding.
import { ZodError } from 'zod';

import type { OrgRole, SessionContext } from '../auth/index.js';
import { roleAtLeast } from '../auth/index.js';
import { AppError, forbidden, unauthorized } from '../platform/errors/app-error.js';

/**
 * Context every procedure sees (API.md section 3). The session may be absent
 * (anonymous caller); guards turn that into UNAUTHORIZED/FORBIDDEN with the
 * same code strings as REST.
 */
export interface TrpcMeta {
  session: SessionContext | null;
  organizationId: string | null;
  orgRole: OrgRole | null;
}

export interface TrpcContext {
  session: SessionContext;
  organizationId: string;
  orgRole: OrgRole;
}

/**
 * App error codes map onto tRPC codes per API.md section 3; the original
 * hookline code travels in `error.data.hooklineCode`. Everything unmapped is
 * INTERNAL_SERVER_ERROR so internals never leak.
 */
const TRPC_CODE_BY_APP_CODE: Record<string, TRPCError['code']> = {
  validation_error: 'BAD_REQUEST',
  unauthorized: 'UNAUTHORIZED',
  forbidden: 'FORBIDDEN',
  not_found: 'NOT_FOUND',
  conflict: 'BAD_REQUEST',
  payload_too_large: 'BAD_REQUEST',
  idempotency_key_reuse: 'BAD_REQUEST',
  endpoint_url_blocked: 'BAD_REQUEST',
  rate_limited: 'TOO_MANY_REQUESTS',
  unavailable: 'INTERNAL_SERVER_ERROR',
};

export function toTrpcError(error: unknown): TRPCError {
  if (error instanceof TRPCError) return error;
  if (error instanceof AppError) {
    return new TRPCError({
      code: TRPC_CODE_BY_APP_CODE[error.code] ?? 'INTERNAL_SERVER_ERROR',
      message: error.message,
      cause: error,
    });
  }
  // Input schemas throw plain ZodErrors; they surface here via the tRPC
  // core wrapper's `cause`.
  if (error instanceof ZodError) {
    return new TRPCError({ code: 'BAD_REQUEST', message: 'validation failed', cause: error });
  }
  return new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'internal server error',
    cause: error instanceof Error ? error : undefined,
  });
}

const t = initTRPC.context<TrpcMeta>().create({
  errorFormatter({ shape, error }) {
    const cause = error.cause instanceof AppError ? error.cause : null;
    const zod = error.cause instanceof ZodError ? error.cause : null;
    return {
      ...shape,
      message: cause?.message ?? shape.message,
      // Never leak stack traces (AGENTS.md security rules).
      data: {
        ...shape.data,
        stack: undefined,
        hooklineCode: cause?.code ?? null,
        details: cause?.details ?? null,
        zodIssues:
          zod !== null
            ? zod.issues.map((issue) => ({
                path: issue.path.join('.'),
                message: issue.message,
              }))
            : null,
      },
    };
  },
});

/**
 * Maps service AppErrors onto the tRPC codes for every procedure. tRPC v11
 * never rejects `next()`: a downstream error arrives as `{ ok: false, error }`
 * with the original error preserved on `cause`, so it must be inspected here.
 */
const mapErrors = t.middleware(async ({ next }) => {
  const result = await next();
  if (!result.ok) {
    throw toTrpcError(result.error.cause ?? result.error);
  }
  return result;
});

/** Requires a session with an active organization; narrows to TrpcContext. */
const requireOrg = t.middleware(({ ctx, next }) => {
  if (!ctx.session) {
    throw unauthorized('authentication required');
  }
  if (!ctx.organizationId || !ctx.orgRole) {
    throw forbidden('no active organization');
  }
  return next({
    ctx: {
      session: ctx.session,
      organizationId: ctx.organizationId,
      orgRole: ctx.orgRole,
    },
  });
});

/** Session + active organization. Role minimums via `minRole` (API.md 3). */
export const orgProcedure = t.procedure.use(mapErrors).use(requireOrg);

/** Org procedure with a minimum organization role (M = member, A = admin). */
export function minRole(minimum: OrgRole) {
  return t.procedure
    .use(mapErrors)
    .use(requireOrg)
    .use(({ ctx, next }) => {
      if (!roleAtLeast(ctx.orgRole, minimum)) {
        throw forbidden(`requires ${minimum} role`);
      }
      return next({ ctx });
    });
}

export { t };
export const router = t.router;
