import { describe, expect, it } from 'vitest';

import { parseOrgRole, roleAtLeast } from './session-context.js';

describe('roleAtLeast', () => {
  it('orders owner > admin > member', () => {
    expect(roleAtLeast('owner', 'admin')).toBe(true);
    expect(roleAtLeast('admin', 'admin')).toBe(true);
    expect(roleAtLeast('member', 'admin')).toBe(false);
    expect(roleAtLeast('member', 'member')).toBe(true);
    expect(roleAtLeast('admin', 'owner')).toBe(false);
  });
});

describe('parseOrgRole', () => {
  it('accepts known roles only', () => {
    expect(parseOrgRole('owner')).toBe('owner');
    expect(parseOrgRole('admin')).toBe('admin');
    expect(parseOrgRole('member')).toBe('member');
    expect(parseOrgRole('superuser')).toBeNull();
    expect(parseOrgRole('')).toBeNull();
  });
});
