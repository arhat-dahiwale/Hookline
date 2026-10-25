// Original file: C:/Users/arhat/Projects/Hookline/packages/proto/protos/worker.proto

export interface IReplayEventRequest {
  organizationId?: string;
  eventId?: string;
  endpointIds?: string[];
}

export interface OReplayEventRequest {
  organizationId: string;
  eventId: string;
  endpointIds: string[];
}
