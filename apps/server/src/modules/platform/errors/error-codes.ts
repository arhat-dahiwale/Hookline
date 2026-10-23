/**
 * Error codes and their HTTP statuses, exactly as documented in API.md 1.2.
 * This is the single source of truth for the mapping in both directions.
 */
export const ERROR_CODES = [
  'validation_error',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'payload_too_large',
  'idempotency_key_reuse',
  'endpoint_url_blocked',
  'rate_limited',
  'internal_error',
  'unavailable',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const CODE_TO_STATUS: Record<ErrorCode, number> = {
  validation_error: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  idempotency_key_reuse: 422,
  endpoint_url_blocked: 422,
  rate_limited: 429,
  internal_error: 500,
  unavailable: 503,
};

export function statusForCode(code: ErrorCode): number {
  return CODE_TO_STATUS[code];
}

/** Reverse map used to classify framework errors by status. */
export function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return 'validation_error';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 413:
      return 'payload_too_large';
    case 422:
      return 'validation_error';
    case 429:
      return 'rate_limited';
    case 503:
      return 'unavailable';
    default:
      return 'internal_error';
  }
}
