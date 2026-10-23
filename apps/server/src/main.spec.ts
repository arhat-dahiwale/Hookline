import { describe, expect, it } from 'vitest';

import { boot } from './main.js';

describe('server skeleton', () => {
  it('boots', () => {
    expect(boot()).toBe('hookline server skeleton');
  });
});
