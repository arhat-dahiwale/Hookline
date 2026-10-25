// Original file: C:/Users/arhat/Projects/Hookline/packages/proto/protos/health.proto

import type * as grpc from '@grpc/grpc-js';
import type { MethodDefinition } from '@grpc/proto-loader';
import type {
  IHealthCheckRequest as I_grpc_health_v1_HealthCheckRequest,
  OHealthCheckRequest as O_grpc_health_v1_HealthCheckRequest,
} from '../../../grpc/health/v1/HealthCheckRequest';
import type {
  IHealthCheckResponse as I_grpc_health_v1_HealthCheckResponse,
  OHealthCheckResponse as O_grpc_health_v1_HealthCheckResponse,
} from '../../../grpc/health/v1/HealthCheckResponse';

export interface HealthClient extends grpc.Client {
  Check(
    argument: I_grpc_health_v1_HealthCheckRequest,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<O_grpc_health_v1_HealthCheckResponse>,
  ): grpc.ClientUnaryCall;
  Check(
    argument: I_grpc_health_v1_HealthCheckRequest,
    metadata: grpc.Metadata,
    callback: grpc.requestCallback<O_grpc_health_v1_HealthCheckResponse>,
  ): grpc.ClientUnaryCall;
  Check(
    argument: I_grpc_health_v1_HealthCheckRequest,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<O_grpc_health_v1_HealthCheckResponse>,
  ): grpc.ClientUnaryCall;
  Check(
    argument: I_grpc_health_v1_HealthCheckRequest,
    callback: grpc.requestCallback<O_grpc_health_v1_HealthCheckResponse>,
  ): grpc.ClientUnaryCall;
  check(
    argument: I_grpc_health_v1_HealthCheckRequest,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<O_grpc_health_v1_HealthCheckResponse>,
  ): grpc.ClientUnaryCall;
  check(
    argument: I_grpc_health_v1_HealthCheckRequest,
    metadata: grpc.Metadata,
    callback: grpc.requestCallback<O_grpc_health_v1_HealthCheckResponse>,
  ): grpc.ClientUnaryCall;
  check(
    argument: I_grpc_health_v1_HealthCheckRequest,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<O_grpc_health_v1_HealthCheckResponse>,
  ): grpc.ClientUnaryCall;
  check(
    argument: I_grpc_health_v1_HealthCheckRequest,
    callback: grpc.requestCallback<O_grpc_health_v1_HealthCheckResponse>,
  ): grpc.ClientUnaryCall;

  Watch(
    argument: I_grpc_health_v1_HealthCheckRequest,
    metadata: grpc.Metadata,
    options?: grpc.CallOptions,
  ): grpc.ClientReadableStream<O_grpc_health_v1_HealthCheckResponse>;
  Watch(
    argument: I_grpc_health_v1_HealthCheckRequest,
    options?: grpc.CallOptions,
  ): grpc.ClientReadableStream<O_grpc_health_v1_HealthCheckResponse>;
  watch(
    argument: I_grpc_health_v1_HealthCheckRequest,
    metadata: grpc.Metadata,
    options?: grpc.CallOptions,
  ): grpc.ClientReadableStream<O_grpc_health_v1_HealthCheckResponse>;
  watch(
    argument: I_grpc_health_v1_HealthCheckRequest,
    options?: grpc.CallOptions,
  ): grpc.ClientReadableStream<O_grpc_health_v1_HealthCheckResponse>;
}

export interface HealthHandlers extends grpc.UntypedServiceImplementation {
  Check: grpc.handleUnaryCall<
    O_grpc_health_v1_HealthCheckRequest,
    I_grpc_health_v1_HealthCheckResponse
  >;

  Watch: grpc.handleServerStreamingCall<
    O_grpc_health_v1_HealthCheckRequest,
    I_grpc_health_v1_HealthCheckResponse
  >;
}

export interface HealthDefinition extends grpc.ServiceDefinition {
  Check: MethodDefinition<
    I_grpc_health_v1_HealthCheckRequest,
    I_grpc_health_v1_HealthCheckResponse,
    O_grpc_health_v1_HealthCheckRequest,
    O_grpc_health_v1_HealthCheckResponse
  >;
  Watch: MethodDefinition<
    I_grpc_health_v1_HealthCheckRequest,
    I_grpc_health_v1_HealthCheckResponse,
    O_grpc_health_v1_HealthCheckRequest,
    O_grpc_health_v1_HealthCheckResponse
  >;
}
