import { describe, expect, it } from 'vitest';

import { API_VERSION, APP_NAME } from './index.js';

describe('shared package skeleton', () => {
  it('exposes constants', () => {
    expect(APP_NAME).toBe('hookline');
    expect(API_VERSION).toBe('v1');
  });
});
