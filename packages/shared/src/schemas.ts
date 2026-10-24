import { z } from 'zod';

/** Event type format per API.md: `^[a-z0-9_]+(\.[a-z0-9_]+)*$`, max 128. */
export const eventTypeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9_]+(\.[a-z0-9_]+)*$/, 'invalid event type format');

/** Payload cap per API.md: 256 KB. */
export const MAX_PAYLOAD_BYTES = 256 * 1024;

export const eventPayloadSchema = z.record(z.string(), z.unknown());

export const createEventSchema = z.object({
  type: eventTypeSchema,
  payload: eventPayloadSchema,
  endpointIds: z.array(z.string().min(1)).optional(),
});

export const createEndpointSchema = z.object({
  url: z.string().min(1).max(2048),
  description: z.string().max(1024).optional(),
  eventTypes: z.array(eventTypeSchema).optional(),
  timeoutMs: z.number().int().min(1_000).max(30_000).optional(),
  maxAttempts: z.number().int().min(1).max(12).optional(),
  rateLimitPerSecond: z.number().int().min(1).max(1_000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const updateEndpointSchema = createEndpointSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'at least one field is required' });

export const rotateSecretSchema = z.object({
  gracePeriodHours: z.number().int().min(0).max(168).optional(),
});

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export const listEventsQuerySchema = listQuerySchema.extend({
  type: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const listDeliveriesQuerySchema = listQuerySchema.extend({
  status: z
    .enum(['pending', 'in_progress', 'retrying', 'succeeded', 'dead', 'cancelled'])
    .optional(),
  endpointId: z.string().optional(),
  eventId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const IDEMPOTENCY_KEY_MAX = 255;

// --- Dashboard (tRPC) schemas — API.md section 3 ---------------------------

export const idSchema = z.string().min(1);

export const setEndpointStatusSchema = z.object({
  id: idSchema,
  status: z.enum(['active', 'disabled']),
});

export const testEndpointSchema = z.object({
  id: idSchema,
  eventType: eventTypeSchema.optional(),
});
