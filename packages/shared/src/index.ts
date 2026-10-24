export const APP_NAME = 'hookline' as const;

export const API_VERSION = 'v1' as const;

export { newId, ULID_PATTERN } from './ids.js';
export {
  validateEndpointUrl,
  isBlockedIp,
  type UrlValidationOptions,
  type UrlValidationResult,
} from './ssrf.js';
export {
  eventTypeSchema,
  eventPayloadSchema,
  createEventSchema,
  createEndpointSchema,
  updateEndpointSchema,
  rotateSecretSchema,
  listQuerySchema,
  listEventsQuerySchema,
  listDeliveriesQuerySchema,
  MAX_PAYLOAD_BYTES,
  IDEMPOTENCY_KEY_MAX,
} from './schemas.js';
