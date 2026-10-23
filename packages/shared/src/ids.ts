import { monotonicFactory } from 'ulidx';

const monotonicUlid = monotonicFactory();

/**
 * Prefixed ULID: sortable, readable in logs, matches DATA.md conventions
 * (e.g. `evt_01J...`, `end_01J...`). Monotonic within a process so IDs
 * created in the same millisecond still sort in creation order (stable
 * keyset pagination). Never use raw UUIDs or auto-increment.
 */
export function newId(prefix: string): string {
  return `${prefix}_${monotonicUlid()}`;
}

export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
