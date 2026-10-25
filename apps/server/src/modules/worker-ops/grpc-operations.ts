import * as grpc from '@grpc/grpc-js';
import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';

import type { TestEndpointResult } from '../delivery-engine/index.js';
import { APP_CONFIG, type AppConfig } from '../platform/config/app-config.js';
import type { WorkerServiceClient } from '@hookline/proto/generated/hookline/worker/v1/WorkerService';
import type {
  DeliveryAttemptEvent,
  EndpointHealthOutput,
  ReplayDeliveryInput,
  ReplayDeliveryOutput,
  ReplayEventInput,
  ReplayEventOutput,
  TestEndpointInput,
  WorkerOperationsService,
} from './worker-operations.js';
import { loadWorkerProto } from './grpc-server.js';

const DEFAULT_DEADLINE_MS = 15_000;
const TEST_ENDPOINT_DEADLINE_MS = 35_000;
const STREAM_DEADLINE_MS = 120_000;
const RETRY_BACKOFF_MS = 100;

/** gRPC statuses that warrant exactly one retry (API.md deadlines/retries). */
const RETRYABLE = new Set<number>([grpc.status.UNAVAILABLE]);

/** Maps gRPC statuses back onto hookline error codes (API.md section 5). */
const APP_CODE_BY_GRPC_STATUS: Record<number, string> = {
  [grpc.status.NOT_FOUND]: 'not_found',
  [grpc.status.INVALID_ARGUMENT]: 'validation_error',
  [grpc.status.PERMISSION_DENIED]: 'internal_error',
  [grpc.status.UNAUTHENTICATED]: 'internal_error',
  [grpc.status.DEADLINE_EXCEEDED]: 'unavailable',
  [grpc.status.UNAVAILABLE]: 'unavailable',
  [grpc.status.RESOURCE_EXHAUSTED]: 'rate_limited',
};

/**
 * gRPC adapter for the API role: implements WorkerOperationsService against
 * the worker's gRPC server. Interchangeable with the in-process adapter —
 * every RPC is tested through both (AGENTS.md architecture rules).
 */
@Injectable()
export class GrpcWorkerOperations implements WorkerOperationsService, OnApplicationShutdown {
  private readonly logger = new Logger(GrpcWorkerOperations.name);
  private client: WorkerServiceClient;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    const definition = loadWorkerProto();
    const package_ = grpc.loadPackageDefinition(definition) as unknown as {
      hookline: {
        worker: {
          v1: {
            WorkerService: new (
              address: string,
              credentials: grpc.ChannelCredentials,
            ) => WorkerServiceClient;
          };
        };
      };
    };
    this.client = new package_.hookline.worker.v1.WorkerService(
      this.config.WORKER_GRPC_URL,
      grpc.credentials.createInsecure(),
    );
  }

  private metadata(): grpc.Metadata {
    const metadata = new grpc.Metadata();
    metadata.set('x-internal-token', this.config.INTERNAL_GRPC_TOKEN);
    return metadata;
  }

  /** Unary call with deadline, hookline error mapping and one retry. */
  private callUnary<TResponse>(
    method: (
      argument: Record<string, unknown>,
      metadata: grpc.Metadata,
      options: grpc.CallOptions,
      callback: (error: grpc.ServiceError | null, response: TResponse) => void,
    ) => void,
    argument: Record<string, unknown>,
    deadlineMs: number,
  ): Promise<TResponse> {
    const attempt = (): Promise<TResponse> =>
      new Promise((resolve, reject) => {
        method.bind(this.client)(
          argument,
          this.metadata(),
          { deadline: Date.now() + deadlineMs },
          (error, response) => {
            if (error) {
              reject(this.mapError(error));
              return;
            }
            resolve(response);
          },
        );
      });

    return attempt().catch((error: unknown) => {
      const status = (error as { grpcStatus?: number }).grpcStatus;
      if (typeof status === 'number' && RETRYABLE.has(status)) {
        this.logger.warn(`worker rpc failed (status ${status}), retrying once`);
        return new Promise<TResponse>((resolve, reject) => {
          setTimeout(() => {
            attempt().then(resolve, reject);
          }, RETRY_BACKOFF_MS);
        });
      }
      throw error;
    });
  }

  private mapError(error: grpc.ServiceError): Error {
    const hooklineCode = APP_CODE_BY_GRPC_STATUS[error.code] ?? 'internal_error';
    const mapped = new Error(
      hooklineCode === 'unavailable' ? `worker unavailable: ${error.message}` : error.message,
    );
    (mapped as Error & { hooklineCode: string; grpcStatus: number }).hooklineCode = hooklineCode;
    (mapped as Error & { hooklineCode: string; grpcStatus: number }).grpcStatus = error.code;
    return mapped;
  }

  async replayDelivery(input: ReplayDeliveryInput): Promise<ReplayDeliveryOutput> {
    const response = await this.callUnary<OReplayDeliveryShape>(
      this.client.replayDelivery as never,
      {
        organizationId: input.organizationId,
        deliveryId: input.deliveryId,
        waitForFirstAttempt: input.waitForFirstAttempt ?? false,
      },
      DEFAULT_DEADLINE_MS,
    );
    return {
      newDeliveryId: response.newDeliveryId,
      status: response.status,
      firstAttempt: response.firstAttempt
        ? {
            outcome: response.firstAttempt.outcome,
            responseStatus: response.firstAttempt.responseStatus,
            durationMs: response.firstAttempt.durationMs,
          }
        : undefined,
    };
  }

  async replayEvent(input: ReplayEventInput): Promise<ReplayEventOutput> {
    const response = await this.callUnary<{ newDeliveryIds: string[] }>(
      this.client.replayEvent as never,
      {
        organizationId: input.organizationId,
        eventId: input.eventId,
        endpointIds: input.endpointIds ?? [],
      },
      DEFAULT_DEADLINE_MS,
    );
    return { newDeliveryIds: response.newDeliveryIds };
  }

  async testEndpoint(input: TestEndpointInput): Promise<TestEndpointResult> {
    const response = await this.callUnary<OTestEndpointShape>(
      this.client.testEndpoint as never,
      {
        organizationId: input.organizationId,
        endpointId: input.endpointId,
        eventType: input.eventType ?? '',
      },
      TEST_ENDPOINT_DEADLINE_MS,
    );
    return {
      outcome: response.outcome as TestEndpointResult['outcome'],
      responseStatus: response.responseStatus === 0 ? null : response.responseStatus,
      durationMs: response.durationMs,
      responseBodySnippet: response.responseBodySnippet || null,
      error: response.error || null,
    };
  }

  async getEndpointHealth(input: {
    organizationId: string;
    endpointId: string;
  }): Promise<EndpointHealthOutput> {
    const response = await this.callUnary<OHealthShape>(
      this.client.getEndpointHealth as never,
      { organizationId: input.organizationId, endpointId: input.endpointId },
      DEFAULT_DEADLINE_MS,
    );
    return {
      state: response.state,
      consecutiveFailures: response.consecutiveFailures,
      openedAt: response.openedAt || null,
      lastSuccessAt: response.lastSuccessAt || null,
      lastFailureAt: response.lastFailureAt || null,
    };
  }

  async *streamDeliveryAttempts(
    input: { organizationId: string; endpointId: string },
    options: { signal: AbortSignal; maxDurationMs?: number },
  ): AsyncGenerator<DeliveryAttemptEvent, void, undefined> {
    const stream = this.client.streamDeliveryAttempts(
      { organizationId: input.organizationId, endpointId: input.endpointId },
      this.metadata(),
      { deadline: Date.now() + (options.maxDurationMs ?? STREAM_DEADLINE_MS) },
    );
    options.signal.addEventListener('abort', () => stream.cancel(), { once: true });
    const queue: DeliveryAttemptEvent[] = [];
    let wake: (() => void) | null = null;
    let failure: Error | null = null;

    stream.on('data', (chunk: unknown) => {
      const wire = chunk as OWireAttemptShape;
      queue.push({
        deliveryId: wire.deliveryId,
        attemptNumber: wire.attemptNumber,
        outcome: wire.outcome,
        responseStatus: wire.responseStatus === 0 ? null : wire.responseStatus,
        durationMs: wire.durationMs,
        finishedAt: wire.finishedAt || null,
      });
      wake?.();
    });
    stream.on('error', (error: grpc.ServiceError) => {
      // Our own abort is a clean end, not a failure.
      failure = options.signal.aborted ? null : this.mapError(error);
      wake?.();
    });
    stream.on('end', () => {
      wake?.();
    });

    while (true) {
      if (queue.length > 0) {
        yield queue.shift()!;
        continue;
      }
      if (failure) throw failure;
      if (stream.destroyed) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = null;
      if (failure) throw failure;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.client.close();
  }
}

interface OReplayDeliveryShape {
  newDeliveryId: string;
  status: string;
  firstAttempt: { outcome: string; responseStatus: number; durationMs: number } | null;
}
interface OTestEndpointShape {
  outcome: string;
  responseStatus: number;
  durationMs: number;
  responseBodySnippet: string;
  error: string;
}
interface OHealthShape {
  state: string;
  consecutiveFailures: number;
  openedAt: string;
  lastSuccessAt: string;
  lastFailureAt: string;
}
interface OWireAttemptShape {
  deliveryId: string;
  attemptNumber: number;
  outcome: string;
  responseStatus: number;
  durationMs: number;
  finishedAt: string;
}
