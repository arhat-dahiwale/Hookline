import type { ErrorCode } from './error-codes.js';
import { statusForCode } from './error-codes.js';

export interface ErrorDetail {
  path: string;
  message: string;
}

/**
 * Typed application error. Services throw these; the global filter maps them
 * to the standard API.md error format. Never leak stack traces or internals.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: ErrorDetail[];

  constructor(code: ErrorCode, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = statusForCode(code);
    this.details = details;
  }
}

// Convenience constructors used across services -------------------------------

export const badRequest = (message: string, details?: ErrorDetail[]) =>
  new AppError('validation_error', message, details);

export const unauthorized = (message = 'authentication required') =>
  new AppError('unauthorized', message);

export const forbidden = (message = 'insufficient permissions') =>
  new AppError('forbidden', message);

export const notFound = (message = 'resource not found') => new AppError('not_found', message);

export const conflict = (message: string) => new AppError('conflict', message);

export const payloadTooLarge = (message: string) => new AppError('payload_too_large', message);

export const idempotencyKeyReuse = (message: string) =>
  new AppError('idempotency_key_reuse', message);

export const endpointUrlBlocked = (message: string) =>
  new AppError('endpoint_url_blocked', message);

export const rateLimited = (message = 'rate limit exceeded') =>
  new AppError('rate_limited', message);

export const unavailable = (message = 'service unavailable', details?: ErrorDetail[]) =>
  new AppError('unavailable', message, details);
