// Original file: C:/Users/arhat/Projects/Hookline/packages/proto/protos/worker.proto

import type {
  IAttemptSummary as I_hookline_worker_v1_AttemptSummary,
  OAttemptSummary as O_hookline_worker_v1_AttemptSummary,
} from '../../../hookline/worker/v1/AttemptSummary';

export interface IReplayDeliveryResponse {
  newDeliveryId?: string;
  status?: string;
  firstAttempt?: I_hookline_worker_v1_AttemptSummary | null;
}

export interface OReplayDeliveryResponse {
  newDeliveryId: string;
  status: string;
  firstAttempt: O_hookline_worker_v1_AttemptSummary | null;
}
