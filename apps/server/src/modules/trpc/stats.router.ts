import { statsWindowSchema } from '@hookline/shared';

import { minRole, router } from './trpc.js';
import { AnalyticsService } from '../analytics/index.js';
import { tenantScope } from '../platform/database/tenant-scope.js';

/**
 * `stats` router (API.md section 3, role M): dashboard analytics over the
 * raw tables (always accurate for the requested window).
 */
export function createStatsRouter(deps: { analyticsService: AnalyticsService }) {
  const { analyticsService } = deps;

  return router({
    overview: minRole('member')
      .input(statsWindowSchema)
      .query(({ ctx, input }) => analyticsService.overview(tenantScope(ctx.organizationId), input)),

    timeseries: minRole('member')
      .input(statsWindowSchema)
      .query(({ ctx, input }) =>
        analyticsService.timeseries(tenantScope(ctx.organizationId), input),
      ),

    latency: minRole('member')
      .input(statsWindowSchema)
      .query(({ ctx, input }) =>
        analyticsService.timeseries(tenantScope(ctx.organizationId), input).then((points) => ({
          data: points.map((point) => ({
            bucketStart: point.bucketStart,
            p50: point.latencyP50Ms,
            p95: point.latencyP95Ms,
            p99: point.latencyP99Ms,
          })),
        })),
      ),

    endpointBreakdown: minRole('member')
      .input(statsWindowSchema)
      .query(({ ctx, input }) =>
        analyticsService.endpointBreakdown(tenantScope(ctx.organizationId), input),
      ),
  });
}
