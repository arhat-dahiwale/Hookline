import * as grpc from '@grpc/grpc-js';
import { loadSync, type PackageDefinition } from '@grpc/proto-loader';
import { createRequire } from 'node:module';
import { Inject, Logger } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../platform/config/app-config.js';
import { WORKER_OPERATIONS, type WorkerOperationsService } from './worker-operations.js';
import type { WorkerServiceHandlers } from '@hookline/proto/generated/hookline/worker/v1/WorkerService';
import type { IHealthCheckRequest } from '@hookline/proto/generated/grpc/health/v1/HealthCheckRequest';
import type { OHealthCheckResponse } from '@hookline/proto/generated/grpc/health/v1/HealthCheckResponse';

const requireProto = createRequire(__filename);

const PROTO_DIR = dirname(requireProto.resolve('@hookline/proto/protos/worker.proto'));

function dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '.' : path.slice(0, idx);
}

export function loadWorkerProto(): PackageDefinition {
  // Resolved through @hookline/proto's exports so the same files drive
  // codegen and the runtime server/client.
  return loadSync(requireProto.resolve('@hookline/proto/protos/worker.proto'), {
    keepCase: false,
    longs: Number,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [PROTO_DIR],
  });
}

const TOKEN_METADATA = 'x-internal-token';

/** Maps AppError codes onto gRPC statuses (API.md section 5, reverse side). */
const GRPC_STATUS_BY_APP_CODE: Record<string, grpc.status> = {
  validation_error: grpc.status.INVALID_ARGUMENT,
  unauthorized: grpc.status.UNAUTHENTICATED,
  forbidden: grpc.status.PERMISSION_DENIED,
  not_found: grpc.status.NOT_FOUND,
  conflict: grpc.status.FAILED_PRECONDITION,
  idempotency_key_reuse: grpc.status.INVALID_ARGUMENT,
  endpoint_url_blocked: grpc.status.INVALID_ARGUMENT,
  rate_limited: grpc.status.RESOURCE_EXHAUSTED,
  unavailable: grpc.status.UNAVAILABLE,
};

function toServiceError(error: unknown): grpc.ServiceError {
  const candidate = error as { code?: string; message?: string; name?: string };
  if (candidate?.name === 'AppError' && typeof candidate.code === 'string') {
    return {
      code: GRPC_STATUS_BY_APP_CODE[candidate.code] ?? grpc.status.INTERNAL,
      message: candidate.message ?? 'internal error',
      name: 'ServiceError',
      details: candidate.message ?? 'internal error',
      metadata: new grpc.Metadata(),
    };
  }
  return {
    code: grpc.status.INTERNAL,
    message: 'internal error',
    name: 'ServiceError',
    details: 'internal error',
    metadata: new grpc.Metadata(),
  };
}

function unauthenticated(): grpc.ServiceError {
  return {
    code: grpc.status.UNAUTHENTICATED,
    message: 'invalid internal token',
    name: 'ServiceError',
    details: 'invalid internal token',
    metadata: new grpc.Metadata(),
  };
}

/**
 * Internal gRPC server (API.md section 5): binds the worker operations on
 * GRPC_PORT with the x-internal-token check and the standard health service.
 * mTLS is documented as future work.
 */
export class WorkerGrpcServer {
  private server: grpc.Server | null = null;
  private readonly logger = new Logger(WorkerGrpcServer.name);

  constructor(
    @Inject(WORKER_OPERATIONS) private readonly operations: WorkerOperationsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async start(): Promise<void> {
    if (this.server) return;
    const definition = loadWorkerProto();
    const server = new grpc.Server();

    const checkToken = (call: { metadata: grpc.Metadata }): grpc.ServiceError | null => {
      const token = call.metadata.get(TOKEN_METADATA)[0];
      if (typeof token !== 'string' || token !== this.config.INTERNAL_GRPC_TOKEN) {
        return unauthenticated();
      }
      return null;
    };

    const handlers: WorkerServiceHandlers = {
      ReplayDelivery: (call, callback) => {
        const tokenFailure = checkToken(call);
        if (tokenFailure) {
          callback(tokenFailure);
          return;
        }
        const request = call.request;
        this.operations
          .replayDelivery({
            organizationId: request.organizationId ?? '',
            deliveryId: request.deliveryId ?? '',
            waitForFirstAttempt: request.waitForFirstAttempt,
          })
          .then((result) =>
            callback(null, {
              newDeliveryId: result.newDeliveryId,
              status: result.status,
              firstAttempt: result.firstAttempt
                ? {
                    outcome: result.firstAttempt.outcome,
                    responseStatus: result.firstAttempt.responseStatus ?? 0,
                    durationMs: result.firstAttempt.durationMs ?? 0,
                  }
                : null,
            }),
          )
          .catch((error: unknown) => callback(toServiceError(error)));
      },

      ReplayEvent: (call, callback) => {
        const tokenFailure = checkToken(call);
        if (tokenFailure) {
          callback(tokenFailure);
          return;
        }
        const request = call.request;
        this.operations
          .replayEvent({
            organizationId: request.organizationId ?? '',
            eventId: request.eventId ?? '',
            endpointIds: request.endpointIds,
          })
          .then((result) => callback(null, { newDeliveryIds: result.newDeliveryIds }))
          .catch((error: unknown) => callback(toServiceError(error)));
      },

      TestEndpoint: (call, callback) => {
        const tokenFailure = checkToken(call);
        if (tokenFailure) {
          callback(tokenFailure);
          return;
        }
        const request = call.request;
        this.operations
          .testEndpoint({
            organizationId: request.organizationId ?? '',
            endpointId: request.endpointId ?? '',
            eventType: request.eventType || undefined,
          })
          .then((result) =>
            callback(null, {
              outcome: result.outcome,
              responseStatus: result.responseStatus ?? 0,
              durationMs: result.durationMs,
              responseBodySnippet: result.responseBodySnippet ?? '',
              error: result.error ?? '',
            }),
          )
          .catch((error: unknown) => callback(toServiceError(error)));
      },

      GetEndpointHealth: (call, callback) => {
        const tokenFailure = checkToken(call);
        if (tokenFailure) {
          callback(tokenFailure);
          return;
        }
        const request = call.request;
        this.operations
          .getEndpointHealth({
            organizationId: request.organizationId ?? '',
            endpointId: request.endpointId ?? '',
          })
          .then((result) =>
            callback(null, {
              state: result.state,
              consecutiveFailures: result.consecutiveFailures,
              openedAt: result.openedAt ?? '',
              lastSuccessAt: result.lastSuccessAt ?? '',
              lastFailureAt: result.lastFailureAt ?? '',
            }),
          )
          .catch((error: unknown) => callback(toServiceError(error)));
      },

      StreamDeliveryAttempts: (call) => {
        const tokenFailure = checkToken(call);
        if (tokenFailure) {
          call.destroy(tokenFailure);
          return;
        }
        const request = call.request;
        const controller = new AbortController();
        call.on('cancelled', () => controller.abort());
        call.on('error', () => controller.abort());
        void (async () => {
          try {
            for await (const event of this.operations.streamDeliveryAttempts(
              {
                organizationId: request.organizationId ?? '',
                endpointId: request.endpointId ?? '',
              },
              { signal: controller.signal },
            )) {
              call.write({
                deliveryId: event.deliveryId,
                attemptNumber: event.attemptNumber,
                outcome: event.outcome,
                responseStatus: event.responseStatus ?? 0,
                durationMs: event.durationMs ?? 0,
                finishedAt: event.finishedAt ?? '',
              });
            }
            call.end();
          } catch (error) {
            call.destroy(toServiceError(error));
          }
        })();
      },
    };
    server.addService(definition['hookline.worker.v1.WorkerService'] as never, handlers as never);

    // Standard grpc.health.v1.Health: SERVING while the process runs.
    const healthDefinition = loadSync(requireProto.resolve('@hookline/proto/protos/health.proto'), {
      keepCase: false,
      longs: Number,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [PROTO_DIR],
    });
    server.addService(
      healthDefinition['grpc.health.v1.Health'] as never,
      {
        Check: (
          _call: grpc.ServerUnaryCall<IHealthCheckRequest, OHealthCheckResponse>,
          callback: grpc.sendUnaryData<OHealthCheckResponse>,
        ) => {
          callback(null, { status: 'SERVING' });
        },
        Watch: (call: grpc.ServerWritableStream<IHealthCheckRequest, OHealthCheckResponse>) => {
          call.write({ status: 'SERVING' });
          // Keep the stream open; status changes are not modelled yet.
        },
      } as never,
    );

    const bound = await new Promise<number>((resolve, reject) => {
      server.bindAsync(
        `0.0.0.0:${this.config.GRPC_PORT}`,
        grpc.ServerCredentials.createInsecure(),
        (error, port) => (error ? reject(error) : resolve(port)),
      );
    });
    this.server = server;
    this.logger.log(`worker gRPC server listening on ${bound}`);
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise<void>((resolve, reject) => {
      server.tryShutdown((error) => (error ? reject(error) : resolve()));
    });
  }
}
