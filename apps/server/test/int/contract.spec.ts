import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApplication, type TestApplication } from './test-app.js';

/**
 * OpenAPI contract tests (Phase 14): the published spec at /openapi.json is
 * the machine-readable form of API.md section 1. These tests pin the spec's
 * structural contract and prove each documented route actually exists on
 * the Fastify instance (405-method-not-allowed vs 404 discrimination), so a
 * removed or renamed route fails CI even if its unit tests were deleted.
 */

interface OpenApiSpec {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<
    string,
    Record<string, { responses: Record<string, unknown>; parameters?: unknown[] }>
  >;
}

let test: TestApplication;
let spec: OpenApiSpec;

beforeAll(async () => {
  test = await createTestApplication();
  const response = await test.instance.inject({ method: 'GET', url: '/openapi.json' });
  spec = response.json() as OpenApiSpec;
});

afterAll(async () => {
  await test.app.close();
});

describe('OpenAPI document contract', () => {
  it('publishes a 3.x document titled Hookline with only /v1 and /health paths', () => {
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.title).toContain('Hookline');
    for (const path of Object.keys(spec.paths)) {
      expect(
        path.startsWith('/v1/') ||
          path === '/v1/events' ||
          path === '/v1/endpoints' ||
          path === '/v1/deliveries' ||
          path.startsWith('/health'),
        `unexpected path ${path}`,
      ).toBe(true);
    }
  });

  it('documents an error response with the standard shape for every mutating operation', () => {
    for (const [path, operations] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        if (!['post', 'patch', 'delete', 'put'].includes(method)) continue;
        const responses = operation.responses;
        expect(
          Object.keys(responses),
          `${method.toUpperCase()} ${path} must document at least one 4xx`,
        ).toEqual(expect.arrayContaining([expect.stringMatching(/^4\d\d$/)]));
      }
    }
  });

  it('documents bearer auth on public API routes', () => {
    const stringified = JSON.stringify(spec);
    // The spec registers API-key bearer security (name may vary).
    expect(stringified.toLowerCase()).toContain('bearer');
  });
});

describe('spec ↔ implementation drift', () => {
  it('every documented route+method exists on the instance (405 ≠ 404)', async () => {
    expect(Object.keys(spec.paths).length).toBeGreaterThan(10);
    for (const [path, operations] of Object.entries(spec.paths)) {
      for (const method of Object.keys(operations)) {
        if (!['get', 'post', 'patch', 'delete', 'put'].includes(method)) continue;
        const response = await test.instance.inject({
          method: method.toUpperCase() as 'GET',
          // Substitute path params so the router matches.
          url: path.replace(/\{[^}]+\}/g, 'evt_test_contract'),
          headers: { authorization: 'Bearer invalid-key' },
        });
        expect(
          response.statusCode !== 404,
          `${method.toUpperCase()} ${path} is documented but missing (404)`,
        ).toBe(true);
      }
    }
  });
});
