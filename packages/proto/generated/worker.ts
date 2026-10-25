import type * as grpc from '@grpc/grpc-js';
import type { MessageTypeDefinition } from '@grpc/proto-loader';

import type {
  IAttemptSummary as I_hookline_worker_v1_AttemptSummary,
  OAttemptSummary as O_hookline_worker_v1_AttemptSummary,
} from './hookline/worker/v1/AttemptSummary';
import type {
  IDeliveryAttemptEvent as I_hookline_worker_v1_DeliveryAttemptEvent,
  ODeliveryAttemptEvent as O_hookline_worker_v1_DeliveryAttemptEvent,
} from './hookline/worker/v1/DeliveryAttemptEvent';
import type {
  IGetEndpointHealthRequest as I_hookline_worker_v1_GetEndpointHealthRequest,
  OGetEndpointHealthRequest as O_hookline_worker_v1_GetEndpointHealthRequest,
} from './hookline/worker/v1/GetEndpointHealthRequest';
import type {
  IGetEndpointHealthResponse as I_hookline_worker_v1_GetEndpointHealthResponse,
  OGetEndpointHealthResponse as O_hookline_worker_v1_GetEndpointHealthResponse,
} from './hookline/worker/v1/GetEndpointHealthResponse';
import type {
  IReplayDeliveryRequest as I_hookline_worker_v1_ReplayDeliveryRequest,
  OReplayDeliveryRequest as O_hookline_worker_v1_ReplayDeliveryRequest,
} from './hookline/worker/v1/ReplayDeliveryRequest';
import type {
  IReplayDeliveryResponse as I_hookline_worker_v1_ReplayDeliveryResponse,
  OReplayDeliveryResponse as O_hookline_worker_v1_ReplayDeliveryResponse,
} from './hookline/worker/v1/ReplayDeliveryResponse';
import type {
  IReplayEventRequest as I_hookline_worker_v1_ReplayEventRequest,
  OReplayEventRequest as O_hookline_worker_v1_ReplayEventRequest,
} from './hookline/worker/v1/ReplayEventRequest';
import type {
  IReplayEventResponse as I_hookline_worker_v1_ReplayEventResponse,
  OReplayEventResponse as O_hookline_worker_v1_ReplayEventResponse,
} from './hookline/worker/v1/ReplayEventResponse';
import type {
  IStreamDeliveryAttemptsRequest as I_hookline_worker_v1_StreamDeliveryAttemptsRequest,
  OStreamDeliveryAttemptsRequest as O_hookline_worker_v1_StreamDeliveryAttemptsRequest,
} from './hookline/worker/v1/StreamDeliveryAttemptsRequest';
import type {
  ITestEndpointRequest as I_hookline_worker_v1_TestEndpointRequest,
  OTestEndpointRequest as O_hookline_worker_v1_TestEndpointRequest,
} from './hookline/worker/v1/TestEndpointRequest';
import type {
  ITestEndpointResponse as I_hookline_worker_v1_TestEndpointResponse,
  OTestEndpointResponse as O_hookline_worker_v1_TestEndpointResponse,
} from './hookline/worker/v1/TestEndpointResponse';
import type {
  WorkerServiceClient as _hookline_worker_v1_WorkerServiceClient,
  WorkerServiceDefinition as _hookline_worker_v1_WorkerServiceDefinition,
} from './hookline/worker/v1/WorkerService';

type SubtypeConstructor<Constructor extends new (...args: any) => any, Subtype> = {
  new (...args: ConstructorParameters<Constructor>): Subtype;
};

export interface ProtoGrpcType {
  hookline: {
    worker: {
      v1: {
        AttemptSummary: MessageTypeDefinition<
          I_hookline_worker_v1_AttemptSummary,
          O_hookline_worker_v1_AttemptSummary
        >;
        DeliveryAttemptEvent: MessageTypeDefinition<
          I_hookline_worker_v1_DeliveryAttemptEvent,
          O_hookline_worker_v1_DeliveryAttemptEvent
        >;
        GetEndpointHealthRequest: MessageTypeDefinition<
          I_hookline_worker_v1_GetEndpointHealthRequest,
          O_hookline_worker_v1_GetEndpointHealthRequest
        >;
        GetEndpointHealthResponse: MessageTypeDefinition<
          I_hookline_worker_v1_GetEndpointHealthResponse,
          O_hookline_worker_v1_GetEndpointHealthResponse
        >;
        ReplayDeliveryRequest: MessageTypeDefinition<
          I_hookline_worker_v1_ReplayDeliveryRequest,
          O_hookline_worker_v1_ReplayDeliveryRequest
        >;
        ReplayDeliveryResponse: MessageTypeDefinition<
          I_hookline_worker_v1_ReplayDeliveryResponse,
          O_hookline_worker_v1_ReplayDeliveryResponse
        >;
        ReplayEventRequest: MessageTypeDefinition<
          I_hookline_worker_v1_ReplayEventRequest,
          O_hookline_worker_v1_ReplayEventRequest
        >;
        ReplayEventResponse: MessageTypeDefinition<
          I_hookline_worker_v1_ReplayEventResponse,
          O_hookline_worker_v1_ReplayEventResponse
        >;
        StreamDeliveryAttemptsRequest: MessageTypeDefinition<
          I_hookline_worker_v1_StreamDeliveryAttemptsRequest,
          O_hookline_worker_v1_StreamDeliveryAttemptsRequest
        >;
        TestEndpointRequest: MessageTypeDefinition<
          I_hookline_worker_v1_TestEndpointRequest,
          O_hookline_worker_v1_TestEndpointRequest
        >;
        TestEndpointResponse: MessageTypeDefinition<
          I_hookline_worker_v1_TestEndpointResponse,
          O_hookline_worker_v1_TestEndpointResponse
        >;
        WorkerService: SubtypeConstructor<
          typeof grpc.Client,
          _hookline_worker_v1_WorkerServiceClient
        > & { service: _hookline_worker_v1_WorkerServiceDefinition };
      };
    };
  };
}
