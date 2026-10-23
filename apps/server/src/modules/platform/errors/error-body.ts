import type { ErrorDetail } from './app-error.js';
import type { ErrorCode } from './error-codes.js';

/** Standard error body per API.md 1.2. */
export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: ErrorDetail[];
    requestId: string;
  };
}

export function buildErrorBody(
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: ErrorDetail[],
): ErrorBody {
  const body: ErrorBody = {
    error: {
      code,
      message,
      requestId,
    },
  };
  if (details && details.length > 0) {
    body.error.details = details;
  }
  return body;
}
