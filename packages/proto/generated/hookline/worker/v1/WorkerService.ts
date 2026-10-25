// Original file: C:/Users/arhat/Projects/Hookline/packages/proto/protos/worker.proto

import type * as grpc from '@grpc/grpc-js';
import type { MethodDefinition } from '@grpc/proto-loader';
import type {
  IDeliveryAttemptEvent as I_hookline_worker_v1_DeliveryAttemptEvent,
  ODeliveryAttemptEvent as O_hookline_worker_v1_DeliveryAttemptEvent,
} from '../../../hookline/worker/v1/DeliveryAttemptEvent';
import type {
  IGetEndpointHealthRequest as I_hookline_worker_v1_GetEndpointHealthRequest,
  OGetEndpointHealthRequest as O_hookline_worker_v1_GetEndpointHealthRequest,
} from '../../../hookline/worker/v1/GetEndpointHealthRequest';
import type {
  IGetEndpointHealthResponse as I_hookline_worker_v1_GetEndpointHealthResponse,
  OGetEndpointHealthResponse as O_hookline_worker_v1_GetEndpointHealthResponse,
} from '../../../hookline/worker/v1/GetEndpointHealthResponse';
import type {
  IReplayDeliveryRequest as I_hookline_worker_v1_ReplayDeliveryRequest,
  OReplayDeliveryRequest as O_hookline_worker_v1_ReplayDeliveryRequest,
} from '../../../hookline/worker/v1/ReplayDeliveryRequest';
import type {
  IReplayDeliveryResponse as I_hookline_worker_v1_ReplayDeliveryResponse,
  OReplayDeliveryResponse as O_hookline_worker_v1_ReplayDeliveryResponse,
} from '../../../hookline/worker/v1/ReplayDeliveryResponse';
import type {
  IReplayEventRequest as I_hookline_worker_v1_ReplayEventRequest,
  OReplayEventRequest as O_hookline_worker_v1_ReplayEventRequest,
} from '../../../hookline/worker/v1/ReplayEventRequest';
import type {
  IReplayEventResponse as I_hookline_worker_v1_ReplayEventResponse,
  OReplayEventResponse as O_hookline_worker_v1_ReplayEventResponse,
} from '../../../hookline/worker/v1/ReplayEventResponse';
import type {
  IStreamDeliveryAttemptsRequest as I_hookline_worker_v1_StreamDeliveryAttemptsRequest,
  OStreamDeliveryAttemptsRequest as O_hookline_worker_v1_StreamDeliveryAttemptsRequest,
} from '../../../hookline/worker/v1/StreamDeliveryAttemptsRequest';
import type {
  ITestEndpointRequest as I_hookline_worker_v1_TestEndpointRequest,
  OTestEndpointRequest as O_hookline_worker_v1_TestEndpointRequest,
} from '../../../hookline/worker/v1/TestEndpointRequest';
import type {
  ITestEndpointResponse as I_hookline_worker_v1_TestEndpointResponse,
  OTestEndpointResponse as O_hookline_worker_v1_TestEndpointResponse,
} from '../../../hookline/worker/v1/TestEndpointResponse';

export interface WorkerServiceClient extends grpc.Client {
  GetEndpointHealth(
    argument: I_hookline_worker_v1_GetEndpointHealthRequest,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<O_hookline_worker_v1_GetEndpointHealthResponse>,
  ): grpc.ClientUnaryCall;
  GetEndpointHealth(
    argument: I_hookline_worker_v1_GetEndpointHealthRequest,
    metadata: grpc.Metadata,
    callback: grpc.requestCallback<O_hookline_worker_v1_GetEndpointHealthResponse>,
  ): grpc.ClientUnaryCall;
  GetEndpointHealth(
    argument: I_hookline_worker_v1_GetEndpointHealthRequest,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<O_hookline_worker_v1_GetEndpointHealthResponse>,
  ): grpc.ClientUnaryCall;
  GetEndpointHealth(
    argument: I_hookline_worker_v1_GetEndpointHealthRequest,
    callback: grpc.requestCallback<O_hookline_worker_v1_GetEndpointHealthResponse>,
  ): grpc.ClientUnaryCall;
  getEndpointHealth(
    argument: I_hookline_worker_v1_GetEndpointHealthRequest,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<O_hookline_worker_v1_GetEndpointHealthResponse>,
  ): grpc.ClientUnaryCall;
  getEndpointHealth(
    argument: I_hookline_worker_v1_GetEndpointHealthRequest,
    metadata: grpc.Metadata,
    callback: grpc.requestCallback<O_hookline_worker_v1_GetEndpointHealthResponse>,
  ): grpc.ClientUnaryCall;
  getEndpointHealth(
    argument: I_hookline_worker_v1_GetEndpointHealthRequest,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<O_hookline_worker_v1_GetEndpointHealthResponse>,
  ): grpc.ClientUnaryCall;
  getEndpointHealth(
    argument: I_hookline_worker_v1_GetEndpointHealthRequest,
    callback: grpc.requestCallback<O_hookline_worker_v1_GetEndpointHealthResponse>,
  ): grpc.ClientUnaryCall;

  ReplayDelivery(
    argument: I_hookline_worker_v1_ReplayDeliveryRequest,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<O_hookline_worker_v1_ReplayDeliveryResponse>,
  ): grpc.ClientUnaryCall;
  ReplayDelivery(
    argument: I_hookline_worker_v1_ReplayDeliveryRequest,
    metadata: grpc.Metadata,
    callback: grpc.requestCallback<O_hookline_worker_v1_ReplayDeliveryResponse>,
  ): grpc.ClientUnaryCall;
  ReplayDelivery(
    argument: I_hookline_worker_v1_ReplayDeliveryRequest,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<O_hookline_worker_v1_ReplayDeliveryResponse>,
  ): grpc.ClientUnaryCall;
  ReplayDelivery(
    argument: I_hookline_worker_v1_ReplayDeliveryRequest,
    callback: grpc.requestCallback<O_hookline_worker_v1_ReplayDeliveryResponse>,
  ): grpc.ClientUnaryCall;
  replayDelivery(
    argument: I_hookline_worker_v1_ReplayDeliveryRequest,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<O_hookline_worker_v1_ReplayDeliveryResponse>,
  ): grpc.ClientUnaryCall;
  replayDelivery(
    argument: I_hookline_worker_v1_ReplayDeliveryRequest,
    metadata: grpc.Metadata,
    callback: grpc.requestCallback<O_hookline_worker_v1_ReplayDeliveryResponse>,
  ): grpc.ClientUnaryCall;
  replayDelivery(
    argument: I_hookline_worker_v1_ReplayDeliveryRequest,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<O_hookline_worker_v1_ReplayDeliveryResponse>,
  ): grpc.ClientUnaryCall;
  replayDelivery(
    argument: I_hookline_worker_v1_ReplayDeliveryRequest,
    callback: grpc.requestCallback<O_hookline_worker_v1_ReplayDeliveryResponse>,
  ): grpc.ClientUnaryCall;

  ReplayEvent(
    argument: I_hookline_worker_v1_ReplayEventRequest,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<O_hookline_worker_v1_ReplayEventResponse>,
  ): grpc.ClientUnaryCall;
  ReplayEvent(
    argument: I_hookline_worker_v1_ReplayEventRequest,
    metadata: grpc.Metadata,
    callback: grpc.requestCallback<O_hookline_worker_v1_ReplayEventResponse>,
  ): grpc.ClientUnaryCall;
  ReplayEvent(
    argument: I_hookline_worker_v1_ReplayEventRequest,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<O_hookline_worker_v1_ReplayEventResponse>,
  ): grpc.ClientUnaryCall;
  ReplayEvent(
    argument: I_hookline_worker_v1_ReplayEventRequest,
    callback: grpc.requestCallback<O_hookline_worker_v1_ReplayEventResponse>,
  ): grpc.ClientUnaryCall;
  replayEvent(
    argument: I_hookline_worker_v1_ReplayEventRequest,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<O_hookline_worker_v1_ReplayEventResponse>,
  ): grpc.ClientUnaryCall;
  replayEvent(
    argument: I_hookline_worker_v1_ReplayEventRequest,
    metadata: grpc.Metadata,
    callback: grpc.requestCallback<O_hookline_worker_v1_ReplayEventResponse>,
  ): grpc.ClientUnaryCall;
  replayEvent(
    argument: I_hookline_worker_v1_ReplayEventRequest,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<O_hookline_worker_v1_ReplayEventResponse>,
  ): grpc.ClientUnaryCall;
  replayEvent(
    argument: I_hookline_worker_v1_ReplayEventRequest,
    callback: grpc.requestCallback<O_hookline_worker_v1_ReplayEventResponse>,
  ): grpc.ClientUnaryCall;

  StreamDeliveryAttempts(
    argument: I_hookline_worker_v1_StreamDeliveryAttemptsRequest,
    metadata: grpc.Metadata,
    options?: grpc.CallOptions,
  ): grpc.ClientReadableStream<O_hookline_worker_v1_DeliveryAttemptEvent>;
  StreamDeliveryAttempts(
    argument: I_hookline_worker_v1_StreamDeliveryAttemptsRequest,
    options?: grpc.CallOptions,
  ): grpc.ClientReadableStream<O_hookline_worker_v1_DeliveryAttemptEvent>;
  streamDeliveryAttempts(
    argument: I_hookline_worker_v1_StreamDeliveryAttemptsRequest,
    metadata: grpc.Metadata,
    options?: grpc.CallOptions,
  ): grpc.ClientReadableStream<O_hookline_worker_v1_DeliveryAttemptEvent>;
  streamDeliveryAttempts(
    argument: I_hookline_worker_v1_StreamDeliveryAttemptsRequest,
    options?: grpc.CallOptions,
  ): grpc.ClientReadableStream<O_hookline_worker_v1_DeliveryAttemptEvent>;

  TestEndpoint(
    argument: I_hookline_worker_v1_TestEndpointRequest,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<O_hookline_worker_v1_TestEndpointResponse>,
  ): grpc.ClientUnaryCall;
  TestEndpoint(
    argument: I_hookline_worker_v1_TestEndpointRequest,
    metadata: grpc.Metadata,
    callback: grpc.requestCallback<O_hookline_worker_v1_TestEndpointResponse>,
  ): grpc.ClientUnaryCall;
  TestEndpoint(
    argument: I_hookline_worker_v1_TestEndpointRequest,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<O_hookline_worker_v1_TestEndpointResponse>,
  ): grpc.ClientUnaryCall;
  TestEndpoint(
    argument: I_hookline_worker_v1_TestEndpointRequest,
    callback: grpc.requestCallback<O_hookline_worker_v1_TestEndpointResponse>,
  ): grpc.ClientUnaryCall;
  testEndpoint(
    argument: I_hookline_worker_v1_TestEndpointRequest,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<O_hookline_worker_v1_TestEndpointResponse>,
  ): grpc.ClientUnaryCall;
  testEndpoint(
    argument: I_hookline_worker_v1_TestEndpointRequest,
    metadata: grpc.Metadata,
    callback: grpc.requestCallback<O_hookline_worker_v1_TestEndpointResponse>,
  ): grpc.ClientUnaryCall;
  testEndpoint(
    argument: I_hookline_worker_v1_TestEndpointRequest,
    options: grpc.CallOptions,
    callback: grpc.requestCallback<O_hookline_worker_v1_TestEndpointResponse>,
  ): grpc.ClientUnaryCall;
  testEndpoint(
    argument: I_hookline_worker_v1_TestEndpointRequest,
    callback: grpc.requestCallback<O_hookline_worker_v1_TestEndpointResponse>,
  ): grpc.ClientUnaryCall;
}

export interface WorkerServiceHandlers extends grpc.UntypedServiceImplementation {
  GetEndpointHealth: grpc.handleUnaryCall<
    O_hookline_worker_v1_GetEndpointHealthRequest,
    I_hookline_worker_v1_GetEndpointHealthResponse
  >;

  ReplayDelivery: grpc.handleUnaryCall<
    O_hookline_worker_v1_ReplayDeliveryRequest,
    I_hookline_worker_v1_ReplayDeliveryResponse
  >;

  ReplayEvent: grpc.handleUnaryCall<
    O_hookline_worker_v1_ReplayEventRequest,
    I_hookline_worker_v1_ReplayEventResponse
  >;

  StreamDeliveryAttempts: grpc.handleServerStreamingCall<
    O_hookline_worker_v1_StreamDeliveryAttemptsRequest,
    I_hookline_worker_v1_DeliveryAttemptEvent
  >;

  TestEndpoint: grpc.handleUnaryCall<
    O_hookline_worker_v1_TestEndpointRequest,
    I_hookline_worker_v1_TestEndpointResponse
  >;
}

export interface WorkerServiceDefinition extends grpc.ServiceDefinition {
  GetEndpointHealth: MethodDefinition<
    I_hookline_worker_v1_GetEndpointHealthRequest,
    I_hookline_worker_v1_GetEndpointHealthResponse,
    O_hookline_worker_v1_GetEndpointHealthRequest,
    O_hookline_worker_v1_GetEndpointHealthResponse
  >;
  ReplayDelivery: MethodDefinition<
    I_hookline_worker_v1_ReplayDeliveryRequest,
    I_hookline_worker_v1_ReplayDeliveryResponse,
    O_hookline_worker_v1_ReplayDeliveryRequest,
    O_hookline_worker_v1_ReplayDeliveryResponse
  >;
  ReplayEvent: MethodDefinition<
    I_hookline_worker_v1_ReplayEventRequest,
    I_hookline_worker_v1_ReplayEventResponse,
    O_hookline_worker_v1_ReplayEventRequest,
    O_hookline_worker_v1_ReplayEventResponse
  >;
  StreamDeliveryAttempts: MethodDefinition<
    I_hookline_worker_v1_StreamDeliveryAttemptsRequest,
    I_hookline_worker_v1_DeliveryAttemptEvent,
    O_hookline_worker_v1_StreamDeliveryAttemptsRequest,
    O_hookline_worker_v1_DeliveryAttemptEvent
  >;
  TestEndpoint: MethodDefinition<
    I_hookline_worker_v1_TestEndpointRequest,
    I_hookline_worker_v1_TestEndpointResponse,
    O_hookline_worker_v1_TestEndpointRequest,
    O_hookline_worker_v1_TestEndpointResponse
  >;
}
