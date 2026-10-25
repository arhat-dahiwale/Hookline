import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AnalyticsRepository, AnalyticsService } from '../../src/modules/analytics/index.js';
import { DeliveriesRepository } from '../../src/modules/deliveries/index.js';
import { events, EventsService } from '../../src/modules/events/index.js';
import { EndpointsService } from '../../src/modules/endpoints/index.js';
import { DatabaseService } from '../../src/modules/platform/database/database.service.js';
import { tenantScope } from '../../src/modules/platform/database/tenant-scope.js';
import { SettingsRepository } from '../../src/modules/settings/index.js';
import { createTestApplication, type TestApplication } from './test-app.js';
import { TestReceiver } from './support/test-receiver.js';

/** percentile_cont semantics: linear interpolation between closest ranks. */
function percentileCont(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = (sorted.length - 1) * p;
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (rank - lower);
}

let test: TestApplication;
let receiver: TestReceiver;

beforeAll(async () => {
  test = await createTestApplication([], { ALLOW_INSECURE_ENDPOINTS: 'true' });
  receiver = new TestReceiver();
  await receiver.start();
});

afterAll(async () => {
  await test.app.close();
  await receiver.stop().catch(() => undefined);
});

async function setupOrg(): Promise<{ organizationId: string; endpointId: string }> {
  const jar = { value: undefined as string | undefined };
  const email = `stats-${randomUUID()}@example.test`;
  const inject = async (method: string, url: string, payload?: unknown) => {
    const response = await test.instance.inject({
      method,
      url,
      ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
      headers: {
        ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(jar.value ? { cookie: jar.value } : {}),
      },
    });
    const setCookie = response.headers['set-cookie'];
    if (setCookie) {
      const entries = Array.isArray(setCookie) ? setCookie : [setCookie];
      jar.value = entries.map((line) => line.split(';')[0]).join('; ');
    }
    return response;
  };
  await inject('POST', '/api/auth/sign-up/email', {
    email,
    password: 'password-123456',
    name: 'Stats',
  });
  const org = await inject('POST', '/api/auth/organization/create', {
    name: 'stats-org',
    slug: `stats-${randomUUID()}`,
  });
  const organizationId = (org.json() as { id: string }).id;
  await inject('POST', '/api/auth/organization/set-active', { organizationId });

  const created = await test.app
    .get(EndpointsService)
    .create(tenantScope(organizationId), { url: receiver.url + '/ok' }, { type: 'system' });
  return { organizationId, endpointId: created.endpoint.id };
}

/** Seeds replay deliveries with deterministic-duration attempts, all success. */
async function seedAttempts(
  organizationId: string,
  endpointId: string,
  durations: number[],
): Promise<void> {
  const eventsService = test.app.get(EventsService);
  const deliveries = test.app.get(DeliveriesRepository);
  // endpointIds: [] → no real fan-out, so the worker cannot add attempts;
  // every counted attempt is one of our deterministic seeds. One event per
  // row: the partial unique (event_id, endpoint_id) index applies to
  // non-replays, and each seeded delivery is its own event's delivery.
  for (let i = 0; i < durations.length; i += 1) {
    const result = await eventsService.ingest(tenantScope(organizationId), {
      type: 'stats.seed',
      payload: { i },
      endpointIds: [],
    });
    const [row] = await deliveries.insertMany([
      {
        organizationId,
        eventId: result.event.id,
        endpointId,
        maxAttempts: 8,
        status: 'succeeded',
      },
    ]);
    const startedAt = new Date(Date.now() - 60_000 + i * 1000);
    await deliveries.insertAttempt({
      organizationId,
      endpointId,
      deliveryId: row!.id,
      attemptNumber: 1,
      outcome: 'success',
      responseStatus: 200,
      requestHeaders: {},
      durationMs: durations[i]!,
      startedAt,
      finishedAt: new Date(startedAt.getTime() + durations[i]!),
    });
  }
}

describe('hourly rollup correctness', () => {
  it('matches raw attempts: totals, outcomes, dead count and percentiles; idempotent', async () => {
    const { organizationId, endpointId } = await setupOrg();
    const analytics = test.app.get(AnalyticsService);
    const repo = test.app.get(AnalyticsRepository);
    const deliveries = test.app.get(DeliveriesRepository);
    const eventsService = test.app.get(EventsService);

    const durations = [120, 340, 80, 1000, 450, 220, 660, 90, 1500, 700];
    await seedAttempts(organizationId, endpointId, durations);

    // One dead delivery inside the window (inserted directly so no worker
    // race can rewrite its status).
    const deadEvent = await eventsService.ingest(tenantScope(organizationId), {
      type: 'stats.dead',
      payload: {},
      endpointIds: [],
    });
    await deliveries.insertMany([
      {
        organizationId,
        eventId: deadEvent.event.id,
        endpointId,
        maxAttempts: 1,
        status: 'dead',
        completedAt: new Date(),
      },
    ]);

    const written = await analytics.runRollup();
    expect(written).toBeGreaterThan(0);

    const rows = await repo.rollupWindowBuckets(
      tenantScope(organizationId),
      new Date(Date.now() - 2 * 3_600_000),
      new Date(),
    );
    const bucket = rows.find((row) => row.endpointId === endpointId);
    expect(bucket).toBeDefined();

    const sorted = [...durations].sort((a, b) => a - b);
    expect(bucket!.attemptsTotal).toBe(durations.length);
    expect(bucket!.attemptsSucceeded).toBe(durations.length);
    expect(bucket!.attemptsFailed).toBe(0);
    expect(bucket!.deliveriesDead).toBe(1);
    expect(bucket!.latencyP50Ms).toBe(Math.round(percentileCont(sorted, 0.5)));
    expect(bucket!.latencyP95Ms).toBe(Math.round(percentileCont(sorted, 0.95)));
    expect(bucket!.latencyP99Ms).toBe(Math.round(percentileCont(sorted, 0.99)));

    // Idempotent: rerunning does not double-count.
    await analytics.runRollup();
    const rowsAgain = await repo.rollupWindowBuckets(
      tenantScope(organizationId),
      new Date(Date.now() - 2 * 3_600_000),
      new Date(),
    );
    const bucketAgain = rowsAgain.find((row) => row.endpointId === endpointId)!;
    expect(bucketAgain.attemptsTotal).toBe(durations.length);
    expect(bucketAgain.deliveriesDead).toBe(1);
  });
});

describe('stats query accuracy', () => {
  it('overview, timeseries and breakdown match the raw window data', async () => {
    const { organizationId, endpointId } = await setupOrg();
    const durations = [100, 200, 300, 400, 500];
    await seedAttempts(organizationId, endpointId, durations);

    const analytics = test.app.get(AnalyticsService);
    const window = { from: new Date(Date.now() - 3_600_000), to: new Date(Date.now() + 60_000) };
    const overview = await analytics.overview(tenantScope(organizationId), window);

    expect(overview.attempts).toBeGreaterThanOrEqual(durations.length);
    expect(overview.succeeded).toBeGreaterThanOrEqual(durations.length);
    expect(overview.successRate).toBeGreaterThan(0);
    expect(overview.successRate).toBeLessThanOrEqual(1);
    expect(overview.latencyP95Ms).toBeGreaterThan(0);

    const timeseries = await analytics.timeseries(tenantScope(organizationId), window);
    expect(timeseries.length).toBeGreaterThanOrEqual(1);
    const totalAttempts = timeseries.reduce((sum, point) => sum + point.attempts, 0);
    expect(totalAttempts).toBe(overview.attempts);

    const breakdown = await analytics.endpointBreakdown(tenantScope(organizationId), window);
    const row = breakdown.find((entry) => entry.endpointId === endpointId);
    expect(row).toBeDefined();
    expect(row!.attempts).toBeGreaterThanOrEqual(durations.length);
    expect(row!.breakerState).toBe('closed');
  });
});

describe('retention cleanup', () => {
  it('deletes old events (cascade), honors per-org overrides and batches', async () => {
    const { organizationId: overrideOrg } = await setupOrg();
    const { organizationId: defaultOrg } = await setupOrg();
    const eventsService = test.app.get(EventsService);
    const analytics = test.app.get(AnalyticsService);
    const settings = test.app.get(SettingsRepository);
    const db = test.app.get(DatabaseService).db;

    // Override org: 100-day retention — a 40-day-old event must survive.
    await settings.upsert(tenantScope(overrideOrg), { retentionDays: 100 });
    const oldSurvivor = await eventsService.ingest(tenantScope(overrideOrg), {
      type: 'old.override',
      payload: {},
    });
    await db
      .update(events)
      .set({ createdAt: new Date(Date.now() - 40 * 86_400_000) })
      .where(eq(events.id, oldSurvivor.event.id));

    // Default org (RETENTION_DAYS=30): a 40-day-old event goes, recent stays.
    const oldVictim = await eventsService.ingest(tenantScope(defaultOrg), {
      type: 'old.default',
      payload: {},
    });
    await db
      .update(events)
      .set({ createdAt: new Date(Date.now() - 40 * 86_400_000) })
      .where(eq(events.id, oldVictim.event.id));
    const recent = await eventsService.ingest(tenantScope(defaultOrg), {
      type: 'keep.me',
      payload: {},
    });

    // Batching: 505 old events for the default org → two 500-row batches.
    const bulkRows = Array.from({ length: 505 }, (_, i) => ({
      id: `evt_${randomUUID().replace(/-/g, '').slice(0, 20).padEnd(20, '0')}`,
      organizationId: defaultOrg,
      type: 'bulk.old',
      payload: { i },
      payloadHash: `hash-${i}`,
      createdAt: new Date(Date.now() - 40 * 86_400_000),
    }));
    await db.insert(events).values(bulkRows);

    const deleted = await analytics.runRetentionCleanup();
    expect(deleted).toBeGreaterThanOrEqual(506); // 505 bulk + oldVictim

    const survivors = await db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.organizationId, defaultOrg));
    const survivorIds = survivors.map((row) => row.id);
    expect(survivorIds).not.toContain(oldVictim.event.id);
    expect(survivorIds).toContain(recent.event.id);

    // Override org untouched.
    const overrideRows = await db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.organizationId, overrideOrg));
    expect(overrideRows.map((row) => row.id)).toContain(oldSurvivor.event.id);
  });
});
