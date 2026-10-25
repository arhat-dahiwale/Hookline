// Original file: C:/Users/arhat/Projects/Hookline/packages/proto/protos/worker.proto

export interface IDeliveryAttemptEvent {
  deliveryId?: string;
  attemptNumber?: number;
  outcome?: string;
  responseStatus?: number;
  durationMs?: number;
  finishedAt?: string;
}

export interface ODeliveryAttemptEvent {
  deliveryId: string;
  attemptNumber: number;
  outcome: string;
  responseStatus: number;
  durationMs: number;
  finishedAt: string;
}
