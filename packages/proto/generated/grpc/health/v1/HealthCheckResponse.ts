// Original file: C:/Users/arhat/Projects/Hookline/packages/proto/protos/health.proto

// Original file: C:/Users/arhat/Projects/Hookline/packages/proto/protos/health.proto

export const _grpc_health_v1_HealthCheckResponse_ServingStatus = {
  UNKNOWN: 'UNKNOWN',
  SERVING: 'SERVING',
  NOT_SERVING: 'NOT_SERVING',
  SERVICE_UNKNOWN: 'SERVICE_UNKNOWN',
} as const;

export type I_grpc_health_v1_HealthCheckResponse_ServingStatus =
  'UNKNOWN' | 0 | 'SERVING' | 1 | 'NOT_SERVING' | 2 | 'SERVICE_UNKNOWN' | 3;

export type O_grpc_health_v1_HealthCheckResponse_ServingStatus =
  (typeof _grpc_health_v1_HealthCheckResponse_ServingStatus)[keyof typeof _grpc_health_v1_HealthCheckResponse_ServingStatus];

export interface IHealthCheckResponse {
  status?: I_grpc_health_v1_HealthCheckResponse_ServingStatus;
}

export interface OHealthCheckResponse {
  status: O_grpc_health_v1_HealthCheckResponse_ServingStatus;
}
