import { createHmac } from 'node:crypto';

/** Outbound envelope per API.md section 6. */
export function buildEnvelope(event: {
  id: string;
  type: string;
  createdAt: Date;
  payload: unknown;
}): string {
  return JSON.stringify({
    id: event.id,
    type: event.type,
    createdAt: event.createdAt.toISOString(),
    data: event.payload,
  });
}

/** `v1=HMAC_SHA256(secret, "{timestamp}.{body}")` — hex. */
export function signPayload(secret: string, timestamp: number, rawBody: string): string {
  return `v1=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
}

/**
 * Signature header value; one `v1=` entry per still-valid secret (rotation
 * window sends both, API.md "Signing").
 */
export function signatureHeader(secrets: string[], timestamp: number, rawBody: string): string {
  return secrets.map((secret) => signPayload(secret, timestamp, rawBody)).join(' ');
}

/** Headers for an outbound attempt (API.md section 6 table). */
export function deliveryHeaders(input: {
  deliveryId: string;
  event: { id: string; type: string; createdAt: Date; payload: unknown };
  attemptNumber: number;
  secrets: string[];
  timestamp: number;
}): { headers: Record<string, string>; body: string } {
  const body = buildEnvelope(input.event);
  return {
    body,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Hookline/1.0',
      'Hookline-Event-Id': input.event.id,
      'Hookline-Event-Type': input.event.type,
      'Hookline-Delivery-Id': input.deliveryId,
      'Hookline-Attempt': String(input.attemptNumber),
      'Hookline-Timestamp': String(input.timestamp),
      'Hookline-Signature': signatureHeader(input.secrets, input.timestamp, body),
    },
  };
}
