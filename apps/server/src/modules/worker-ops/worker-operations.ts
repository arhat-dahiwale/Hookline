import type { TestEndpointResult } from '../delivery-engine/index.js';

export interface ReplayDeliveryInput {
  organizationId: string;
  deliveryId: string;
  /** Block until the first attempt finishes (API.md gRPC section). */
  waitForFirstAttempt?: boolean;
}

export interface AttemptSummary {
  outcome: string;
  responseStatus: number | null;
  durationMs: number | null;
}

export interface ReplayDeliveryOutput {
  newDeliveryId: string;
  status: string;
  firstAttempt?: AttemptSummary;
}

export interface ReplayEventInput {
  organizationId: string;
  eventId: string;
  /** Empty = all matching endpoints (API.md). */
  endpointIds?: string[];
}

export interface ReplayEventOutput {
  newDeliveryIds: string[];
}

export interface TestEndpointInput {
  organizationId: string;
  endpointId: string;
  eventType?: string;
}

export interface EndpointHealthOutput {
  state: string;
  consecutiveFailures: number;
  openedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
}

export interface StreamAttemptsInput {
  organizationId: string;
  endpointId: string;
}

export interface DeliveryAttemptEvent {
  deliveryId: string;
  attemptNumber: number;
  outcome: string;
  responseStatus: number | null;
  durationMs: number | null;
  finishedAt: string | null;
}

/**
 * Worker-role operations behind one TypeScript interface (ARCHITECTURE.md
 * 5.4): the in-process adapter (ROLE=all/worker) and the gRPC adapter
 * (ROLE=api) are interchangeable — every RPC is tested through both.
 */
export interface WorkerOperationsService {
  replayDelivery(input: ReplayDeliveryInput): Promise<ReplayDeliveryOutput>;
  replayEvent(input: ReplayEventInput): Promise<ReplayEventOutput>;
  testEndpoint(input: TestEndpointInput): Promise<TestEndpointResult>;
  getEndpointHealth(input: {
    organizationId: string;
    endpointId: string;
  }): Promise<EndpointHealthOutput>;
  /** Tail attempt events for all deliveries of an endpoint (newest last). */
  streamDeliveryAttempts(
    input: StreamAttemptsInput,
    options: { signal: AbortSignal; maxDurationMs?: number },
  ): AsyncIterable<DeliveryAttemptEvent>;
}

/** DI token for the active adapter (in-process or gRPC). */
export const WORKER_OPERATIONS = Symbol('WORKER_OPERATIONS');
