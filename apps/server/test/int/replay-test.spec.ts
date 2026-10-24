import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiKeysService } from '../../src/modules/api-keys/index.js';
import { DeliveriesRepository } from '../../src/modules/deliveries/index.js';
import { EndpointsService } from '../../src/modules/endpoints/index.js';
import { tenantScope } from '../../src/modules/platform/index.js';
import { createTestApplication, type TestApplication } from './test-app.js';
import { TestReceiver } from './support/test-receiver.js';

let test: TestApplication;
let receiver: TestReceiver;
let orgId = '';
let apiKey = '';

beforeAll(async () => {
  test = await createTestApplication([], { ALLOW_INSECURE_ENDPOINTS: 'true' });
  receiver = new TestReceiver();
  await receiver.start();
  orgId = `org_${crypto.randomUUID().replace(/-/g, '')}`;
  apiKey = (
    await test.app.get(ApiKeysService).create(tenantScope(orgId), {
      name: 'replay',
      scopes: [
        'events:write',
        'events:read',
        'endpoints:write',
        'deliveries:write',
        'deliveries:read',
      ],
      createdByUserId: 'u',
    })
  ).secret;
});

afterAll(async () => {
  await test.app.close().catch(() => undefined);
  await receiver.stop();
});

function auth() {
  return { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };
}

async function waitSucceeded(deliveryId: string, timeoutMs = 20_000): Promise<void> {
  const repo = test.app.get(DeliveriesRepository);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await repo.findByIdUnscoped(deliveryId);
    if (row?.status === 'succeeded') return;
    if (row && (row.status === 'dead' || row.status === 'cancelled')) {
      throw new Error(`replay reached ${row.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`replay ${deliveryId} not delivered in time`);
}

describe('replay and test routes', () => {
  it('replays a single delivery (linked new delivery)', async () => {
    const endpoint = await test.app
      .get(EndpointsService)
      .create(tenantScope(orgId), { url: `${receiver.url}/ok` }, { type: 'system' });
    const ingest = await test.instance.inject({
      method: 'POST',
      url: '/v1/events',
      payload: JSON.stringify({ type: 'replay.me', payload: { n: 1 } }),
      headers: auth(),
    });
    const original = ingest.json().deliveries[0].id as string;
    await waitSucceeded(original);

    const replay = await test.instance.inject({
      method: 'POST',
      url: `/v1/deliveries/${original}/replay`,
      headers: { authorization: auth().authorization },
    });
    expect(replay.statusCode).toBe(202);
    const body = replay.json();
    expect(body.replayOfDeliveryId).toBe(original);
    expect(body.status).toBe('pending');
    await waitSucceeded(body.id);
    void endpoint;
  });

  it('replays an event to all matching endpoints', async () => {
    await test.app
      .get(EndpointsService)
      .create(
        tenantScope(orgId),
        { url: `${receiver.url}/ok`, eventTypes: ['bulk.*'] },
        { type: 'system' },
      );
    const ingest = await test.instance.inject({
      method: 'POST',
      url: '/v1/events',
      payload: JSON.stringify({ type: 'bulk.event', payload: { n: 2 } }),
      headers: auth(),
    });
    const eventId = ingest.json().id as string;

    const replay = await test.instance.inject({
      method: 'POST',
      url: `/v1/events/${eventId}/replay`,
      headers: { authorization: auth().authorization },
    });
    expect(replay.statusCode).toBe(202);
    const deliveries = replay.json().deliveries as { id: string }[];
    expect(deliveries.length).toBeGreaterThanOrEqual(1);
    for (const delivery of deliveries) {
      await waitSucceeded(delivery.id);
    }
  });

  it('sends a synchronous test event to an endpoint', async () => {
    const endpoint = await test.app
      .get(EndpointsService)
      .create(tenantScope(orgId), { url: `${receiver.url}/ok` }, { type: 'system' });
    const res = await test.instance.inject({
      method: 'POST',
      url: `/v1/endpoints/${endpoint.endpoint.id}/test`,
      headers: { authorization: auth().authorization },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ outcome: 'success', responseStatus: 200 });
    const last = receiver.received('/ok').slice(-1)[0]!;
    expect(last.headers['hookline-event-type']).toBe('hookline.test');
  });
});
