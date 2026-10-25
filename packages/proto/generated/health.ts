import type * as grpc from '@grpc/grpc-js';
import type { MessageTypeDefinition } from '@grpc/proto-loader';

import type {
  HealthClient as _grpc_health_v1_HealthClient,
  HealthDefinition as _grpc_health_v1_HealthDefinition,
} from './grpc/health/v1/Health';
import type {
  IHealthCheckRequest as I_grpc_health_v1_HealthCheckRequest,
  OHealthCheckRequest as O_grpc_health_v1_HealthCheckRequest,
} from './grpc/health/v1/HealthCheckRequest';
import type {
  IHealthCheckResponse as I_grpc_health_v1_HealthCheckResponse,
  OHealthCheckResponse as O_grpc_health_v1_HealthCheckResponse,
} from './grpc/health/v1/HealthCheckResponse';

type SubtypeConstructor<Constructor extends new (...args: any) => any, Subtype> = {
  new (...args: ConstructorParameters<Constructor>): Subtype;
};

export interface ProtoGrpcType {
  grpc: {
    health: {
      v1: {
        Health: SubtypeConstructor<typeof grpc.Client, _grpc_health_v1_HealthClient> & {
          service: _grpc_health_v1_HealthDefinition;
        };
        HealthCheckRequest: MessageTypeDefinition<
          I_grpc_health_v1_HealthCheckRequest,
          O_grpc_health_v1_HealthCheckRequest
        >;
        HealthCheckResponse: MessageTypeDefinition<
          I_grpc_health_v1_HealthCheckResponse,
          O_grpc_health_v1_HealthCheckResponse
        >;
      };
    };
  };
}
