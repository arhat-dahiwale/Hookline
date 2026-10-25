import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiKeysService } from '../../src/modules/api-keys/index.js';
import {
  WORKER_OPERATIONS,
  type WorkerOperationsService,
} from '../../src/modules/worker-ops/index.js';
import { tenantScope } from '../../src/modules/platform/database/tenant-scope.js';
import { CookieJar, createTestApplication, type TestApplication } from './test-app.js';
import { TestReceiver } from './support/test-receiver.js';

/**
 * In-process adapter tests (ROLE=all): the same WorkerOperationsService
 * operations as the gRPC wire suite, executed against the real services.
 */
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

function operations(): WorkerOperationsService {
  return test.app.get(WORKER_OPERATIONS) as WorkerOperationsService;
}

async function setup(): Promise<{ organizationId: string; endpointId: string; apiKey: string }> {
  const jar = new CookieJar();
  const email = `ops-${randomUUID()}@example.test`;
  const inject = async (method: string, url: string, payload?: unknown) => {
    const response = await test.instance.inject({
      method,
      url,
      ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
      headers: {
        ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(jar.header() ? { cookie: jar.header() } : {}),
      },
    });
    jar.capture(response);
    return response;
  };
  await inject('POST', '/api/auth/sign-up/email', {
    email,
    password: 'password-123456',
    name: 'Ops',
  });
  const me = (await inject('GET', '/api/auth/get-session')).json() as { user: { id: string } };
  const org = await inject('POST', '/api/auth/organization/create', {
    name: 'ops-org',
    slug: `ops-${randomUUID()}`,
  });
  const organizationId = (org.json() as { id: string }).id;
  await inject('POST', '/api/auth/organization/set-active', { organizationId });

  const keys = test.app.get(ApiKeysService);
  const key = await keys.create(tenantScope(organizationId), {
    name: 'ops',
    scopes: ['events:write'],
    createdByUserId: me.user.id,
  });
  const { EndpointsService } = await import('../../src/modules/endpoints/index.js');
  const createdEndpoint = await test.app
    .get(EndpointsService)
    .create(
      tenantScope(organizationId),
      { url: receiver.url + '/ok' },
      { type: 'user', id: me.user.id },
    );
  return { organizationId, endpointId: createdEndpoint.endpoint.id, apiKey: key.secret };
}

describe('in-process worker operations', () => {
  it('tests an endpoint synchronously', async () => {
    const { organizationId, endpointId } = await setup();
    const result = await operations().testEndpoint({ organizationId, endpointId });
    expect(result.outcome).toBe('success');
    expect(result.responseStatus).toBe(200);
  });

  it('replays an event and reports the new delivery ids', async () => {
    const { organizationId, endpointId, apiKey } = await setup();
    // Ingest via the service layer (same app).
    const { EventsService } = await import('../../src/modules/events/index.js');
    const result = await test.app.get(EventsService).ingest(tenantScope(organizationId), {
      type: 'ops.event',
      payload: {},
    });
    expect(result.deliveries.length).toBe(1);

    const replayed = await operations().replayEvent({
      organizationId,
      eventId: result.event.id,
    });
    expect(replayed.newDeliveryIds.length).toBe(1);

    // Single replay with wait: the first attempt completes against /ok.
    const replayOne = await operations().replayDelivery({
      organizationId,
      deliveryId: result.deliveries[0]!.id,
      waitForFirstAttempt: true,
    });
    expect(replayOne.newDeliveryId).not.toBe(result.deliveries[0]!.id);
    expect(replayOne.firstAttempt?.outcome).toBe('success');

    const health = await operations().getEndpointHealth({ organizationId, endpointId });
    expect(health.state).toBe('closed');
    void apiKey;
  });

  it('streams attempt events for the endpoint', async () => {
    const { organizationId, endpointId } = await setup();
    const { EventsService } = await import('../../src/modules/events/index.js');
    await test.app.get(EventsService).ingest(tenantScope(organizationId), {
      type: 'ops.stream',
      payload: {},
    });

    const controller = new AbortController();
    const events: string[] = [];
    for await (const event of operations().streamDeliveryAttempts(
      { organizationId, endpointId },
      { signal: controller.signal, maxDurationMs: 15_000 },
    )) {
      events.push(event.outcome);
      if (events.length >= 1) controller.abort();
    }
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]).toBe('success');
  }, 30_000);

  it('reports NOT_FOUND for a foreign endpoint', async () => {
    const a = await setup();
    const b = await setup();
    await expect(
      operations().getEndpointHealth({
        organizationId: b.organizationId,
        endpointId: a.endpointId,
      }),
    ).rejects.toMatchObject({ name: 'AppError', code: 'not_found' });
  });
});
