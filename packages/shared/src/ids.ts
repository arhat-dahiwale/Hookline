import { ulid } from 'ulidx';

/**
 * Prefixed ULID: sortable, readable in logs, matches DATA.md conventions
 * (e.g. `evt_01J...`, `end_01J...`). Never use raw UUIDs or auto-increment.
 */
export function newId(prefix: string): string {
  return `${prefix}_${ulid()}`;
}

export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
