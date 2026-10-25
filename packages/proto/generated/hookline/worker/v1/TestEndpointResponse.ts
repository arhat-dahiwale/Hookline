// Original file: C:/Users/arhat/Projects/Hookline/packages/proto/protos/worker.proto

export interface ITestEndpointResponse {
  outcome?: string;
  responseStatus?: number;
  durationMs?: number;
  responseBodySnippet?: string;
  error?: string;
}

export interface OTestEndpointResponse {
  outcome: string;
  responseStatus: number;
  durationMs: number;
  responseBodySnippet: string;
  error: string;
}
