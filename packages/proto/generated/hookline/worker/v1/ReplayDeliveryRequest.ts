// Original file: C:/Users/arhat/Projects/Hookline/packages/proto/protos/worker.proto

export interface IReplayDeliveryRequest {
  organizationId?: string;
  deliveryId?: string;
  waitForFirstAttempt?: boolean;
}

export interface OReplayDeliveryRequest {
  organizationId: string;
  deliveryId: string;
  waitForFirstAttempt: boolean;
}
