import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiKeysService } from '../../src/modules/api-keys/index.js';
import { DeliveriesRepository } from '../../src/modules/deliveries/index.js';
import { EndpointsService } from '../../src/modules/endpoints/index.js';
import { EventsRepository } from '../../src/modules/events/index.js';
import { tenantScope } from '../../src/modules/platform/index.js';
import { TokenBucketRateLimiter } from '../../src/modules/platform/rate-limiter/token-bucket.js';
import { RedisService } from '../../src/modules/platform/redis/redis.service.js';
import {
  INGESTION_BURST_CAPACITY,
  INGESTION_RATE_PER_SECOND,
} from '../../src/modules/events/ingestion-rate-limit.guard.js';
import { createTestApplication, type TestApplication } from './test-app.js';

let test: TestApplication;
let orgId: string;
let fullKey = '';
let readKey = '';
let endpointWriteOnlyKey = '';

beforeAll(async () => {
  test = await createTestApplication();
  const apiKeys = test.app.get(ApiKeysService);
  const endpoints = test.app.get(EndpointsService);
  orgId = `org_${crypto.randomUUID().replace(/-/g, '')}`;
  const scope = tenantScope(orgId);

  // Keys with different scopes.
  fullKey = (
    await apiKeys.create(scope, {
      name: 'full',
      scopes: [
        'events:write',
        'events:read',
        'endpoints:read',
        'endpoints:write',
        'deliveries:read',
        'deliveries:write',
      ],
      createdByUserId: 'u',
    })
  ).secret;
  readKey = (
    await apiKeys.create(scope, {
      name: 'read',
      scopes: ['events:read', 'endpoints:read', 'deliveries:read'],
      createdByUserId: 'u',
    })
  ).secret;
  endpointWriteOnlyKey = (
    await apiKeys.create(scope, {
      name: 'endpoints-only',
      scopes: ['endpoints:write'],
      createdByUserId: 'u',
    })
  ).secret;

  // Matching endpoints: one catches everything, one only invoice.* types.
  await endpoints.create(scope, { url: 'https://no-such-host.invalid/all' }, { type: 'system' });
  await endpoints.create(
    scope,
    { url: 'https://no-such-host.invalid/invoices', eventTypes: ['invoice.*'] },
    { type: 'system' },
  );
  await endpoints
    .create(
      scope,
      { url: 'https://no-such-host.invalid/disabled', eventTypes: [] },
      { type: 'system' },
    )
    .then(async (created) => {
      await endpoints.setStatus(scope, created.endpoint.id, 'disabled', 'manual', {
        type: 'system',
      });
    });
});

afterAll(async () => {
  await test.app.close();
});

function auth(key = fullKey, json: boolean) {
  return {
    authorization: `Bearer ${key}`,
    ...(json ? { 'content-type': 'application/json' } : {}),
  };
}

function inject(
  method: string,
  url: string,
  payload?: unknown,
  headers: Record<string, string> = {},
) {
  return test.instance.inject({
    method,
    url,
    ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
    headers: { ...auth(fullKey, payload !== undefined), ...headers },
  });
}

describe('endpoints API', () => {
  it('creates an endpoint and returns the secret exactly once', async () => {
    const res = await inject('POST', '/v1/endpoints', {
      url: 'https://no-such-host.invalid/new-hook',
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toMatch(/^end_/);
    expect(body.secret).toMatch(/^whsec_/);
    expect(body.status).toBe('active');

    const fetched = await inject('GET', `/v1/endpoints/${body.id}`);
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().secret).toBeUndefined();
  });

  it('blocks SSRF-unsafe URLs with 422 endpoint_url_blocked', async () => {
    for (const url of [
      'http://example.com/hook', // http when not allowed
      'https://127.0.0.1/hook',
      'https://169.254.169.254/meta',
      'https://192.168.0.1/hook',
      'https://localhost/hook',
      'not-a-url',
    ]) {
      const res = await inject('POST', '/v1/endpoints', { url });
      expect(res.statusCode, url).toBe(422);
      expect(res.json().error.code, url).toBe('endpoint_url_blocked');
    }
  });

  it('lists, updates, toggles, rotates, and soft-deletes', async () => {
    const created = await inject('POST', '/v1/endpoints', {
      url: 'https://no-such-host.invalid/lifecycle',
      description: 'before',
    });
    const id = created.json().id as string;

    const list = await inject('GET', '/v1/endpoints');
    expect(list.statusCode).toBe(200);
    expect(list.json().data.some((e: { id: string }) => e.id === id)).toBe(true);

    const patched = await inject('PATCH', `/v1/endpoints/${id}`, { description: 'after' });
    expect(patched.json().description).toBe('after');
    expect(patched.json().url).toBe('https://no-such-host.invalid/lifecycle');

    const disabled = await inject('POST', `/v1/endpoints/${id}/disable`);
    expect(disabled.json().status).toBe('disabled');
    const again = await inject('POST', `/v1/endpoints/${id}/disable`);
    expect(again.statusCode).toBe(409);
    const enabled = await inject('POST', `/v1/endpoints/${id}/enable`);
    expect(enabled.json().status).toBe('active');

    const rotated = await inject('POST', `/v1/endpoints/${id}/rotate-secret`, {
      gracePeriodHours: 1,
    });
    expect(rotated.json().secret).toMatch(/^whsec_/);
    expect(rotated.json().secret).not.toBe(created.json().secret);

    const health = await inject('GET', `/v1/endpoints/${id}/health`);
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({
      state: 'closed',
      consecutiveFailures: 0,
      stats24h: { attempts: 0, succeeded: 0, failed: 0, p95Ms: 0 },
    });

    const deleted = await inject('DELETE', `/v1/endpoints/${id}`);
    expect(deleted.statusCode).toBe(204);
    const gone = await inject('GET', `/v1/endpoints/${id}`);
    expect(gone.statusCode).toBe(404);
  });

  it('requires endpoints:write for mutations and endpoints:read for reads', async () => {
    const create = await inject(
      'POST',
      '/v1/endpoints',
      { url: 'https://no-such-host.invalid/x' },
      {
        authorization: `Bearer ${readKey}`,
      },
    );
    expect(create.statusCode).toBe(403);

    const list = await inject('GET', '/v1/endpoints', undefined, {
      authorization: `Bearer ${endpointWriteOnlyKey}`,
    });
    expect(list.statusCode).toBe(403);
  });
});

describe('events API', () => {
  // A dedicated org so fan-out counts are deterministic regardless of the
  // endpoints created by other tests in this file.
  let eventsOrgKey = '';
  let catchAllEndpointId = '';

  beforeAll(async () => {
    const apiKeys = test.app.get(ApiKeysService);
    const endpoints = test.app.get(EndpointsService);
    const scope = tenantScope(`org_${crypto.randomUUID().replace(/-/g, '')}`);
    eventsOrgKey = (
      await apiKeys.create(scope, {
        name: 'events-org',
        scopes: ['events:write', 'events:read', 'endpoints:read', 'deliveries:read'],
        createdByUserId: 'u',
      })
    ).secret;
    const catchAll = await endpoints.create(
      scope,
      { url: 'https://no-such-host.invalid/all' },
      { type: 'system' },
    );
    catchAllEndpointId = catchAll.endpoint.id;
    await endpoints.create(
      scope,
      { url: 'https://no-such-host.invalid/invoices', eventTypes: ['invoice.*'] },
      { type: 'system' },
    );
    const disabled = await endpoints.create(
      scope,
      { url: 'https://no-such-host.invalid/disabled' },
      { type: 'system' },
    );
    await endpoints.setStatus(scope, disabled.endpoint.id, 'disabled', 'manual', {
      type: 'system',
    });
  });

  function eventsInject(
    method: string,
    url: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    return test.instance.inject({
      method,
      url,
      ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
      headers: {
        authorization: `Bearer ${eventsOrgKey}`,
        ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
    });
  }

  it('ingests an event and fans out to matching endpoints', async () => {
    const res = await eventsInject('POST', '/v1/events', {
      type: 'invoice.paid',
      payload: { invoiceId: 'inv_1', amount: 4900 },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toMatch(/^evt_/);
    expect(body.type).toBe('invoice.paid');
    // catch-all + invoice.* match; disabled endpoint excluded.
    expect(body.deliveries).toHaveLength(2);
    for (const delivery of body.deliveries) {
      expect(delivery.status).toBe('pending');
      expect(delivery.id).toMatch(/^dlv_/);
    }
  });

  it('respects endpointIds restriction and type filters', async () => {
    const all = (
      await eventsInject('POST', '/v1/events', {
        type: 'user.created',
        payload: { userId: 'u1' },
      })
    ).json();
    expect(all.deliveries).toHaveLength(1); // only the catch-all endpoint
    expect(all.deliveries[0].endpointId).toBe(catchAllEndpointId);

    const restricted = await eventsInject('POST', '/v1/events', {
      type: 'user.created',
      payload: { userId: 'u2' },
      endpointIds: [catchAllEndpointId],
    });
    expect(restricted.json().deliveries).toHaveLength(1);
    expect(restricted.json().deliveries[0].endpointId).toBe(catchAllEndpointId);
  });

  it('rejects invalid event types and oversized payloads', async () => {
    const badType = await inject('POST', '/v1/events', { type: 'Invalid Type', payload: {} });
    expect(badType.statusCode).toBe(400);
    expect(badType.json().error.code).toBe('validation_error');

    const big = await inject('POST', '/v1/events', {
      type: 'big.event',
      payload: { blob: 'x'.repeat(256 * 1024 + 512) },
    });
    expect(big.statusCode).toBe(413);
    expect(big.json().error.code).toBe('payload_too_large');
  });

  it('replays idempotent requests with 200 and Idempotent-Replay', async () => {
    const key = `idem-${crypto.randomUUID()}`;
    const first = await inject(
      'POST',
      '/v1/events',
      { type: 'a.b', payload: { n: 1 } },
      {
        'idempotency-key': key,
      },
    );
    expect(first.statusCode).toBe(202);

    const second = await inject(
      'POST',
      '/v1/events',
      { type: 'a.b', payload: { n: 1 } },
      {
        'idempotency-key': key,
      },
    );
    expect(second.statusCode).toBe(200);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(second.json().id).toBe(first.json().id);

    const conflict = await inject(
      'POST',
      '/v1/events',
      { type: 'a.b', payload: { n: 2 } },
      {
        'idempotency-key': key,
      },
    );
    expect(conflict.statusCode).toBe(422);
    expect(conflict.json().error.code).toBe('idempotency_key_reuse');
  });

  it('lists events with cursor pagination and reads one with payload', async () => {
    for (let i = 0; i < 5; i += 1) {
      await inject('POST', '/v1/events', { type: 'page.event', payload: { i } });
    }
    const page1 = await inject('GET', '/v1/events?type=page.event&limit=3');
    expect(page1.statusCode).toBe(200);
    expect(page1.json().data).toHaveLength(3);
    expect(page1.json().nextCursor).toBeTruthy();

    const page2 = await inject(
      'GET',
      `/v1/events?type=page.event&limit=3&cursor=${page1.json().nextCursor}`,
    );
    expect(page2.json().data.length).toBeGreaterThan(0);
    const seen = [...page1.json().data, ...page2.json().data].map((e: { id: string }) => e.id);
    expect(new Set(seen).size).toBe(seen.length);

    const one = await inject('GET', `/v1/events/${page1.json().data[0].id}`);
    expect(one.json().payload).toEqual({ i: expect.any(Number) });

    const missing = await inject('GET', '/v1/events/evt_missing');
    expect(missing.statusCode).toBe(404);

    const deliveries = await inject('GET', `/v1/events/${one.json().id}/deliveries`);
    expect(deliveries.statusCode).toBe(200);
    expect(Array.isArray(deliveries.json().data)).toBe(true);
  });

  it('rejects writes without events:write', async () => {
    const res = await inject(
      'POST',
      '/v1/events',
      { type: 'x.y', payload: {} },
      {
        authorization: `Bearer ${readKey}`,
      },
    );
    expect(res.statusCode).toBe(403);
  });
});

describe('deliveries API', () => {
  it('lists deliveries with filters and reads attempts', async () => {
    const list = await inject('GET', '/v1/deliveries?limit=5');
    expect(list.statusCode).toBe(200);
    expect(list.json().data.length).toBeGreaterThan(0);

    const one = await inject('GET', `/v1/deliveries/${list.json().data[0].id}`);
    expect(one.statusCode).toBe(200);
    expect(['pending', 'in_progress', 'retrying']).toContain(one.json().status);
    expect(one.json().maxAttempts).toBe(8);

    const attempts = await inject('GET', `/v1/deliveries/${one.json().id}/attempts`);
    expect(attempts.statusCode).toBe(200);
    // The engine may already have recorded attempt 1 (DNS failure).
    expect(Array.isArray(attempts.json().data)).toBe(true);
    expect(attempts.json().data.length).toBeLessThanOrEqual(2);

    const filtered = await inject('GET', '/v1/deliveries?status=succeeded');
    expect(filtered.json().data).toEqual([]);

    const missing = await inject('GET', '/v1/deliveries/dlv_missing');
    expect(missing.statusCode).toBe(404);
  });

  it('never leaks other tenants deliveries (cross-tenant 404)', async () => {
    // A delivery in a DIFFERENT org (real event to satisfy the FK).
    const otherScope = tenantScope(`org_${crypto.randomUUID().replace(/-/g, '')}`);
    const endpointsService = test.app.get(EndpointsService);
    const eventsRepository = test.app.get(EventsRepository);
    const deliveriesRepository = test.app.get(DeliveriesRepository);
    const other = await endpointsService.create(
      otherScope,
      { url: 'https://no-such-host.invalid/other' },
      { type: 'system' },
    );
    const event = await eventsRepository.insert({
      organizationId: otherScope.organizationId,
      type: 'other.event',
      payload: { ok: true },
    });
    const [row] = await deliveriesRepository.insertMany([
      {
        organizationId: otherScope.organizationId,
        eventId: event.id,
        endpointId: other.endpoint.id,
        maxAttempts: 8,
        status: 'pending',
      },
    ]);
    const res = await inject('GET', `/v1/deliveries/${row!.id}`);
    expect(res.statusCode).toBe(404);
  });
});

describe('rate limiting', () => {
  it('rate limits ingestion per API key with headers', async () => {
    const apiKeys = test.app.get(ApiKeysService);
    const limiter = test.app.get(TokenBucketRateLimiter);
    const redis = test.app.get(RedisService);
    const key = (
      await apiKeys.create(tenantScope(orgId), {
        name: 'flood',
        scopes: ['events:write', 'events:read'],
        createdByUserId: 'u',
      })
    ).secret;

    // Every ingestion response carries the RateLimit-* headers (API.md 1.1).
    for (let i = 0; i < 3; i += 1) {
      const res = await test.instance.inject({
        method: 'POST',
        url: '/v1/events',
        payload: JSON.stringify({ type: 'flood.event', payload: { i } }),
        headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      });
      expect(res.statusCode).toBe(202);
      expect(res.headers['ratelimit-limit']).toBe(String(INGESTION_BURST_CAPACITY));
      expect(Number(res.headers['ratelimit-remaining'])).toBeLessThanOrEqual(
        INGESTION_BURST_CAPACITY,
      );
    }

    // The bucket itself denies once exhausted (deterministic, no HTTP).
    const bucketKey = 'hl:rl:ingest:test-bucket';
    await redis.client.del(bucketKey);
    let denied = false;
    let allowedCount = 0;
    for (let i = 0; i < INGESTION_BURST_CAPACITY + 60 && !denied; i += 1) {
      const result = await limiter.take(bucketKey, {
        ratePerSecond: INGESTION_RATE_PER_SECOND,
        capacity: INGESTION_BURST_CAPACITY,
      });
      if (result.allowed) {
        allowedCount += 1;
      } else {
        denied = true;
        expect(result.retryAfterMs).toBeGreaterThan(0);
        expect(result.retryAfterMs).toBeLessThanOrEqual(1000 / INGESTION_RATE_PER_SECOND + 50);
      }
    }
    expect(denied).toBe(true);
    // The loop itself takes time, so a few refill tokens sneak in.
    expect(allowedCount).toBeGreaterThanOrEqual(INGESTION_BURST_CAPACITY);
    expect(allowedCount).toBeLessThanOrEqual(INGESTION_BURST_CAPACITY + 30);

    // The HTTP guard renders 429 with Retry-After when the key is exhausted.
    const exhausted = await apiKeys.create(tenantScope(orgId), {
      name: 'exhausted',
      scopes: ['events:write'],
      createdByUserId: 'u',
    });
    const guardKey = 'hl:rl:ingest:' + exhausted.key.id;
    // Seed a large deficit directly (the same pattern as the breaker tests):
    // denied takes never subtract, so no sequence of public takes holds the
    // bucket below zero under load. -900 tokens = ~18s before the guard's
    // take can succeed, far longer than this test runs.
    await redis.client.hset(guardKey, {
      tokens: '-900',
      ts: String(Date.now()),
    });
    // With the bucket in deficit, the very next request must hit 429.
    const attempt = await test.instance.inject({
      method: 'POST',
      url: '/v1/events',
      payload: JSON.stringify({ type: 'blocked.event', payload: {} }),
      headers: {
        authorization: 'Bearer ' + exhausted.secret,
        'content-type': 'application/json',
      },
    });
    const blockedHeaders: Record<string, unknown> = attempt.headers;
    const blockedBody = attempt.json() as { error?: { code?: string } };
    expect(attempt.statusCode).toBe(429);
    expect(blockedBody.error?.code).toBe('rate_limited');
    expect(Number(blockedHeaders['retry-after'])).toBeGreaterThan(0);
  });
});

describe('OpenAPI contract', () => {
  const expectedPaths: [string, string[]][] = [
    ['/v1/events', ['post', 'get']],
    ['/v1/events/{eventId}', ['get']],
    ['/v1/events/{eventId}/deliveries', ['get']],
    ['/v1/endpoints', ['post', 'get']],
    ['/v1/endpoints/{endpointId}', ['get', 'patch', 'delete']],
    ['/v1/endpoints/{endpointId}/enable', ['post']],
    ['/v1/endpoints/{endpointId}/disable', ['post']],
    ['/v1/endpoints/{endpointId}/rotate-secret', ['post']],
    ['/v1/endpoints/{endpointId}/health', ['get']],
    ['/v1/deliveries', ['get']],
    ['/v1/deliveries/{deliveryId}', ['get']],
    ['/v1/deliveries/{deliveryId}/attempts', ['get']],
  ];

  it('serves an OpenAPI spec covering every documented route', async () => {
    const res = await test.instance.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(spec.openapi).toMatch(/^3\./);
    for (const [path, methods] of expectedPaths) {
      expect(spec.paths[path], path).toBeDefined();
      for (const method of methods) {
        expect(spec.paths[path][method], `${path} ${method}`).toBeDefined();
        expect(spec.paths[path][method].responses).toBeDefined();
      }
    }
    expect(spec.components.securitySchemes.bearerApiKey).toBeDefined();
  });

  it('serves Swagger UI at /docs', async () => {
    const res = await test.instance.inject({ method: 'GET', url: '/docs' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('SwaggerUIBundle');
    expect(res.body).toContain('/openapi.json');
  });
});

describe('standard error contract', () => {
  it('renders validation errors in the API.md shape with a request id', async () => {
    const res = await inject('POST', '/v1/endpoints', {});
    expect(res.statusCode).toBe(400);
    const body = res.json().error;
    expect(body.code).toBe('validation_error');
    expect(body.requestId).toMatch(/^req/);
    expect(Array.isArray(body.details)).toBe(true);
  });

  it('rejects oversized bodies with the standard 413 shape', async () => {
    const res = await test.instance.inject({
      method: 'POST',
      url: '/v1/events',
      payload: JSON.stringify({ type: 'huge.event', payload: { x: 'y'.repeat(2 * 1024 * 1024) } }),
      headers: auth(fullKey, true),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('payload_too_large');
  });
});
