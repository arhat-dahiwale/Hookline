import type { EventRow } from './events.repository.js';

/** List shape: no payload (kept out of tables and logs, API.md 1.1). */
export function presentEvent(event: EventRow) {
  return {
    id: event.id,
    type: event.type,
    createdAt: event.createdAt.toISOString(),
  };
}

/** Detail shape: includes the payload (owner-scoped reads only). */
export function presentEventDetailed(event: EventRow) {
  return { ...presentEvent(event), payload: event.payload };
}
