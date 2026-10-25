import { randomUUID } from 'node:crypto';
import { DeliveriesRepository } from '../../src/modules/deliveries/index.js';

import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiKeysService } from '../../src/modules/api-keys/index.js';
import { tenantScope } from '../../src/modules/platform/database/tenant-scope.js';
import { startTracing, stopTracing } from '../../src/modules/observability/tracing.js';
import { parseEnv } from '../../src/modules/platform/index.js';
import type { TestApplication } from './test-app.js';
import { loadTestEnv } from './test-env.js';
import { TestReceiver } from './support/test-receiver.js';

/**
 * Phase 12 done criterion: ONE trace spans the API request, the queue, the
 * worker attempt and the outbound HTTP call. The SDK is started here with an
 * in-memory exporter (before any http-patched module loads) so assertions run
 * against captured spans; no OTLP endpoint is contacted.
 */

class MemoryExporter implements SpanExporter {
  readonly spans: ReadableSpan[] = [];

  export(spans: ReadableSpan[], callback: (result: { code: number }) => void): void {
    this.spans.push(...spans);
    callback({ code: 0 });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

const exporter = new MemoryExporter();
let test: TestApplication;
let receiver: TestReceiver;
let baseUrl = '';

beforeAll(async () => {
  const env = parseEnv({ ...loadTestEnv(), OTEL_EXPORTER_OTLP_ENDPOINT: '' });
  startTracing(env, exporter);
  // Dynamic imports: auto-instrumentations patch http at require time.
  const { createTestApplication, listen } = await import('./test-app.js');
  test = await createTestApplication([], { ALLOW_INSECURE_ENDPOINTS: 'true' });
  receiver = new TestReceiver();
  await receiver.start();
  baseUrl = await listen(test);
}, 60_000);

afterAll(async () => {
  await test?.app.close();
  await receiver?.stop().catch(() => undefined);
  await stopTracing();
});

describe('distributed tracing', () => {
  it('spans the API request, queue, worker attempt and outbound HTTP with one trace id', async () => {
    // Org + endpoint + key through the real HTTP path.
    const jar: string[] = [];
    const email = `trace-${randomUUID()}@example.test`;
    const inject = async (method: string, url: string, payload?: unknown) => {
      const response = await test.instance.inject({
        method,
        url,
        ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
        headers: {
          ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(jar.length > 0 ? { cookie: jar.join('; ') } : {}),
        },
      });
      for (const line of response.headers['set-cookie'] ?? []) {
        jar.push(String(line).split(';')[0]!);
      }
      return response;
    };
    await inject('POST', '/api/auth/sign-up/email', {
      email,
      password: 'password-123456',
      name: 'Trace',
    });
    const org = await inject('POST', '/api/auth/organization/create', {
      name: 'trace-org',
      slug: `trace-${randomUUID()}`,
    });
    const organizationId = (org.json() as { id: string }).id;
    await inject('POST', '/api/auth/organization/set-active', { organizationId });

    const keys = test.app.get(ApiKeysService);
    const key = await keys.create(tenantScope(organizationId), {
      name: 'trace',
      scopes: ['events:write', 'endpoints:write'],
      createdByUserId: 'unknown',
    });

    // An endpoint to fan out to (otherwise nothing is enqueued and traced).
    const endpoint = await fetch(`${baseUrl}/v1/endpoints`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key.secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ url: receiver.url + '/ok' }),
    });
    expect(endpoint.status).toBe(201);

    // Trigger delivery through the API (which enqueues with trace context);
    // the in-process worker continues the trace and makes the outbound call.
    const ingest = await fetch(`${baseUrl}/v1/events`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key.secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'trace.test', payload: {} }),
    });
    expect(ingest.status).toBe(202);
    const ingestBody = (await ingest.json()) as { id: string; deliveries: { id: string }[] };
    expect(ingestBody.deliveries.length).toBe(1);
    void organizationId;

    // Wait for the delivery to reach a terminal state, then stop the SDK —
    // shutdown flushes the batch processor into the in-memory exporter.
    const deliveries = test.app.get(DeliveriesRepository);
    await new Promise((resolve) => {
      const timer = setInterval(async () => {
        const row = await deliveries.findByIdUnscoped(ingestBody.deliveries[0]!.id);
        if (row && (row.status === 'succeeded' || row.status === 'dead')) {
          clearInterval(timer);
          resolve(undefined);
        }
      }, 250);
      const failTimer = setTimeout(() => {
        clearInterval(timer);
        resolve(undefined);
      }, 10_000);
      void failTimer;
    });
    const finalRow = await deliveries.findByIdUnscoped(ingestBody.deliveries[0]!.id);
    expect(['succeeded', 'dead']).toContain(finalRow?.status ?? 'missing');

    await stopTracing();

    const spans = exporter.spans;
    // Anchor: the explicit ingest span (deterministic parentage — see the
    // comment on EventsService.ingest).
    const ingestSpan = spans.find((span) => span.name === 'ingest.event');
    expect(ingestSpan, 'ingest span').toBeDefined();
    const traceId = ingestSpan!.spanContext().traceId;

    // ONE trace spans: the API request, the worker attempt (queue hop via
    // the serialized context) and the outbound webhook call.
    const workerSpans = spans.filter(
      (span) => span.name === 'worker.delivery.attempt' && span.spanContext().traceId === traceId,
    );
    expect(workerSpans.length, 'worker attempt span in the same trace').toBeGreaterThanOrEqual(1);
    expect(
      workerSpans[0]!.parentSpanContext?.spanId,
      'worker span is a child of the ingest span (queue propagation)',
    ).toBe(ingestSpan!.spanContext().spanId);

    const outboundSpans = spans.filter(
      (span) =>
        span.name === 'outbound.webhook' &&
        span.spanContext().traceId === traceId &&
        String(span.attributes['http.url'] ?? '').includes('/ok'),
    );
    expect(outboundSpans.length, 'outbound webhook span in the same trace').toBeGreaterThanOrEqual(
      1,
    );
    expect(
      outboundSpans[0]!.parentSpanContext?.spanId,
      'outbound span is a child of the worker attempt span',
    ).toBe(workerSpans[0]!.spanContext().spanId);
  }, 60_000);
});
