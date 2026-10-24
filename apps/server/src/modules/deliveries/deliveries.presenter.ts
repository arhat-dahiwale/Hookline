import type { DeliveryAttemptRow, DeliveryRow } from './deliveries.repository.js';

export function presentDelivery(delivery: DeliveryRow) {
  return {
    id: delivery.id,
    eventId: delivery.eventId,
    endpointId: delivery.endpointId,
    replayOfDeliveryId: delivery.replayOfDeliveryId,
    status: delivery.status,
    attemptCount: delivery.attemptCount,
    maxAttempts: delivery.maxAttempts,
    nextAttemptAt: delivery.nextAttemptAt?.toISOString() ?? null,
    lastAttemptAt: delivery.lastAttemptAt?.toISOString() ?? null,
    completedAt: delivery.completedAt?.toISOString() ?? null,
    lastResponseStatus: delivery.lastResponseStatus,
    lastError: delivery.lastError,
    createdAt: delivery.createdAt.toISOString(),
  };
}

export function presentAttempt(attempt: DeliveryAttemptRow) {
  return {
    id: attempt.id,
    deliveryId: attempt.deliveryId,
    attemptNumber: attempt.attemptNumber,
    outcome: attempt.outcome,
    requestHeaders: attempt.requestHeaders,
    responseStatus: attempt.responseStatus,
    responseHeaders: attempt.responseHeaders,
    responseBodySnippet: attempt.responseBodySnippet,
    errorMessage: attempt.errorMessage,
    durationMs: attempt.durationMs,
    startedAt: attempt.startedAt.toISOString(),
    finishedAt: attempt.finishedAt?.toISOString() ?? null,
  };
}
