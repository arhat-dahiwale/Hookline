import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { buildEnvelope, deliveryHeaders, signatureHeader, signPayload } from './signing.js';

const event = {
  id: 'evt_01ABC',
  type: 'invoice.paid',
  createdAt: new Date('2026-10-24T10:00:00.000Z'),
  payload: { amount: 4900 },
};

describe('signing', () => {
  it('builds the documented envelope', () => {
    const body = buildEnvelope(event);
    expect(JSON.parse(body)).toEqual({
      id: 'evt_01ABC',
      type: 'invoice.paid',
      createdAt: '2026-10-24T10:00:00.000Z',
      data: { amount: 4900 },
    });
  });

  it('signs {timestamp}.{body} with HMAC-SHA256 hex', () => {
    const body = buildEnvelope(event);
    const expected = createHmac('sha256', 'whsec_test').update(`1770000000.${body}`).digest('hex');
    expect(signPayload('whsec_test', 1_770_000_000, body)).toBe(`v1=${expected}`);
  });

  it('sends both signatures during a rotation window', () => {
    const body = buildEnvelope(event);
    const header = signatureHeader(['whsec_a', 'whsec_b'], 1_770_000_000, body);
    const parts = header.split(' ');
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(parts[1]).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(parts[0]).not.toBe(parts[1]);
  });

  it('sets all documented delivery headers', () => {
    const { headers, body } = deliveryHeaders({
      deliveryId: 'dlv_1',
      event,
      attemptNumber: 2,
      secrets: ['whsec_test'],
      timestamp: 1_770_000_000,
    });
    expect(headers['Hookline-Delivery-Id']).toBe('dlv_1');
    expect(headers['Hookline-Attempt']).toBe('2');
    expect(headers['Hookline-Event-Type']).toBe('invoice.paid');
    expect(headers['User-Agent']).toBe('Hookline/1.0');
    expect(headers['Content-Type']).toBe('application/json');
    // Signature verifies against the exact bytes sent.
    const expected = createHmac('sha256', 'whsec_test')
      .update(`${headers['Hookline-Timestamp']}.${body}`)
      .digest('hex');
    expect(headers['Hookline-Signature']).toBe(`v1=${expected}`);
  });
});
