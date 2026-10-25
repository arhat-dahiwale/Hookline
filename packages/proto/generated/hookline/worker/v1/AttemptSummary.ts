// Original file: C:/Users/arhat/Projects/Hookline/packages/proto/protos/worker.proto

export interface IAttemptSummary {
  outcome?: string;
  responseStatus?: number;
  durationMs?: number;
}

export interface OAttemptSummary {
  outcome: string;
  responseStatus: number;
  durationMs: number;
}
