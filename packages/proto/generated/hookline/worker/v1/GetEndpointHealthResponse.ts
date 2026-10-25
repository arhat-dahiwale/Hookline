// Original file: C:/Users/arhat/Projects/Hookline/packages/proto/protos/worker.proto

export interface IGetEndpointHealthResponse {
  state?: string;
  consecutiveFailures?: number;
  openedAt?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
}

export interface OGetEndpointHealthResponse {
  state: string;
  consecutiveFailures: number;
  openedAt: string;
  lastSuccessAt: string;
  lastFailureAt: string;
}
