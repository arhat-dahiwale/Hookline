import { describe, expect, it } from 'vitest';

import { newId, ULID_PATTERN } from './ids.js';

describe('newId', () => {
  it('creates a prefixed ULID', () => {
    const id = newId('evt');
    expect(id).toMatch(/^evt_/);
    expect(id.slice(4)).toMatch(ULID_PATTERN);
  });

  it('is monotonic and unique', () => {
    const a = newId('dlv');
    const b = newId('dlv');
    expect(a).not.toEqual(b);
    expect(a < b).toBe(true);
  });
});
