import { z } from 'zod';

import {
  createEndpointSchema,
  idSchema,
  rotateSecretSchema,
  setEndpointStatusSchema,
  testEndpointSchema,
  updateEndpointSchema,
  validateEndpointUrl,
} from '@hookline/shared';

import type { TrpcContext } from './trpc.js';
import { minRole, orgProcedure, router } from './trpc.js';
import { WorkerOperations } from '../delivery-engine/index.js';
import { EndpointsRepository, EndpointsService, presentEndpoint } from '../endpoints/index.js';
import { DeliveriesRepository } from '../deliveries/index.js';
import { endpointUrlBlocked, unavailable } from '../platform/errors/app-error.js';
import { tenantScope } from '../platform/database/tenant-scope.js';
import type { AppConfig } from '../platform/config/app-config.js';

function since24h(): Date {
  return new Date(Date.now() - 24 * 60 * 60 * 1000);
}

function validateUrl(config: AppConfig, url: string): void {
  const urlCheck = validateEndpointUrl(url, { allowInsecure: config.ALLOW_INSECURE_ENDPOINTS });
  if (!urlCheck.ok) {
    throw endpointUrlBlocked(urlCheck.reason ?? 'URL not allowed');
  }
}

/**
 * `endpoints` router (API.md section 3). Protocol layer only: authenticate
 * and authorize via middleware, validate with Zod, call the service. The
 * user session is the audit actor.
 */
export function createEndpointsRouter(deps: {
  config: AppConfig;
  endpointsService: EndpointsService;
  endpointsRepository: EndpointsRepository;
  deliveriesRepository: DeliveriesRepository;
  /** Resolves lazily: null when the worker role is not loaded (test send). */
  getWorkerOperations: () => WorkerOperations | null;
}) {
  const { config, endpointsService, endpointsRepository, deliveriesRepository } = deps;

  return router({
    list: orgProcedure.input(z.void().optional()).query(async ({ ctx }: { ctx: TrpcContext }) => {
      const rows = await endpointsService.list(tenantScope(ctx.organizationId));
      return { data: rows.map(presentEndpoint) };
    }),

    get: minRole('member')
      .input(z.object({ id: idSchema }))
      .query(({ ctx, input }) =>
        endpointsService.get(tenantScope(ctx.organizationId), input.id).then(presentEndpoint),
      ),

    create: minRole('admin')
      .input(createEndpointSchema)
      .mutation(async ({ ctx, input }) => {
        validateUrl(config, input.url);
        const created = await endpointsService.create(
          tenantScope(ctx.organizationId),
          {
            url: input.url,
            description: input.description,
            eventTypes: input.eventTypes,
            timeoutMs: input.timeoutMs,
            maxAttempts: input.maxAttempts,
            rateLimitPerSecond: input.rateLimitPerSecond,
            metadata: input.metadata,
          },
          { type: 'user', id: ctx.session.user.id },
        );
        return { ...presentEndpoint(created.endpoint), secret: created.secret };
      }),

    update: minRole('admin')
      .input(updateEndpointSchema.extend({ id: idSchema }))
      .mutation(async ({ ctx, input }) => {
        if (input.url !== undefined) validateUrl(config, input.url);
        const { id, ...patch } = input;
        const updated = await endpointsService.update(tenantScope(ctx.organizationId), id, {
          ...(patch.url !== undefined ? { url: patch.url } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.eventTypes !== undefined ? { eventTypes: patch.eventTypes } : {}),
          ...(patch.timeoutMs !== undefined ? { timeoutMs: patch.timeoutMs } : {}),
          ...(patch.maxAttempts !== undefined ? { maxAttempts: patch.maxAttempts } : {}),
          ...(patch.rateLimitPerSecond !== undefined
            ? { rateLimitPerSecond: patch.rateLimitPerSecond }
            : {}),
          ...(patch.metadata !== undefined ? { metadata: patch.metadata } : {}),
        });
        return presentEndpoint(updated);
      }),

    delete: minRole('admin')
      .input(z.object({ id: idSchema }))
      .mutation(({ ctx, input }) =>
        endpointsService.softDelete(tenantScope(ctx.organizationId), input.id, {
          type: 'user',
          id: ctx.session.user.id,
        }),
      ),

    setStatus: minRole('admin')
      .input(setEndpointStatusSchema)
      .mutation(({ ctx, input }) =>
        endpointsService
          .setStatus(tenantScope(ctx.organizationId), input.id, input.status, 'manual', {
            type: 'user',
            id: ctx.session.user.id,
          })
          .then(presentEndpoint),
      ),

    rotateSecret: minRole('admin')
      .input(rotateSecretSchema.extend({ id: idSchema }))
      .mutation(({ ctx, input }) =>
        endpointsService
          .rotateSecret(
            tenantScope(ctx.organizationId),
            input.id,
            input.gracePeriodHours ?? endpointsService.defaultGraceHours,
            { type: 'user', id: ctx.session.user.id },
          )
          .then((rotated) => ({ ...presentEndpoint(rotated.endpoint), secret: rotated.secret })),
      ),

    test: minRole('member')
      .input(testEndpointSchema)
      .mutation(async ({ ctx, input }) => {
        const workerOperations = deps.getWorkerOperations();
        if (!workerOperations) {
          throw unavailable(
            'test send requires the worker role (gRPC adapter arrives in Phase 10)',
          );
        }
        return workerOperations.testEndpoint({
          organizationId: ctx.organizationId,
          endpointId: input.id,
          eventType: input.eventType,
        });
      }),

    health: minRole('member')
      .input(z.object({ id: idSchema }))
      .query(async ({ ctx, input }) => {
        const scope = tenantScope(ctx.organizationId);
        const endpoint = await endpointsService.get(scope, input.id);
        const health = await endpointsRepository.findHealth(endpoint.id);
        const stats = await deliveriesRepository.attemptStatsSince(endpoint.id, since24h());
        return {
          state: health?.state ?? 'closed',
          consecutiveFailures: health?.consecutiveFailures ?? 0,
          lastSuccessAt: health?.lastSuccessAt?.toISOString() ?? null,
          lastFailureAt: health?.lastFailureAt?.toISOString() ?? null,
          openedAt: health?.openedAt?.toISOString() ?? null,
          stats24h: {
            attempts: stats.attempts,
            succeeded: stats.succeeded,
            failed: stats.attempts - stats.succeeded,
            p95Ms: stats.p95Ms,
          },
        };
      }),
  });
}
