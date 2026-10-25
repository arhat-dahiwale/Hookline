import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MetricsService } from '../../src/modules/observability/index.js';
import { createTestApplication, type TestApplication } from './test-app.js';

/**
 * Observability contract (ARCHITECTURE.md 7.3): every documented metric is
 * registered, /metrics serves the Prometheus text format, and HTTP request
 * durations are recorded with TEMPLATED route labels only (no raw paths).
 */

const ARCHITECTURE_METRICS = [
  'hookline_http_request_duration_seconds',
  'hookline_events_ingested_total',
  'hookline_deliveries_created_total',
  'hookline_delivery_attempts_total',
  'hookline_delivery_attempt_duration_seconds',
  'hookline_delivery_dispatch_lag_seconds',
  'hookline_deliveries_dead_total',
  'hookline_queue_depth',
  'hookline_circuit_breaker_transitions_total',
  'hookline_rate_limited_total',
  'hookline_ws_connections',
];

let test: TestApplication;

beforeAll(async () => {
  test = await createTestApplication();
});

afterAll(async () => {
  await test.app.close();
});

describe('Prometheus /metrics', () => {
  it('serves the text format with every documented metric registered', async () => {
    const response = await test.instance.inject({ method: 'GET', url: '/metrics' });
    expect(response.statusCode).toBe(200);
    expect(String(response.headers['content-type'])).toContain('text/plain');
    for (const name of ARCHITECTURE_METRICS) {
      expect(response.body, `metric ${name} must be registered`).toContain(name);
    }
  });
});

describe('HTTP request duration metric', () => {
  it('records durations with templated route labels (never raw paths)', async () => {
    const metrics = test.app.get(MetricsService);

    // A matched route (templated: /health/live) and an unmatched one.
    const health = await test.instance.inject({ method: 'GET', url: '/health/live' });
    expect(health.statusCode).toBe(200);
    const missing = await test.instance.inject({ method: 'GET', url: '/definitely/not/a/rule' });
    expect(missing.statusCode).toBe(404);

    const body = await metrics.render();
    expect(body).toContain('hookline_http_request_duration_seconds');

    // Templated labels, not raw paths: the matched route appears as its
    // template and the 404 collapses to 'unmatched'. If a raw path ever
    // leaked into the label, the unmatched URL would appear verbatim.
    expect(body).toContain('route="/health/live"');
    expect(body).toContain('route="unmatched"');
    expect(body).not.toContain('/definitely/not/a/rule');
    expect(body).toContain('method="GET"');
    expect(body).toContain('status="404"');
  });

  it('labels a parameterized route by its template, not the concrete id', async () => {
    const metrics = test.app.get(MetricsService);
    const response = await test.instance.inject({
      method: 'GET',
      url: '/v1/events/evt_doesnotexist123',
    });
    // 401 (no API key) or 404 — either way the route label must be templated.
    expect([401, 404]).toContain(response.statusCode);

    const body = await metrics.render();
    expect(body).toContain('route="/v1/events/:eventId"');
    expect(body).not.toContain('evt_doesnotexist123');
  });
});
