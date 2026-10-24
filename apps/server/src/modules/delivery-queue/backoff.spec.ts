import { describe, expect, it } from 'vitest';

import { baseDelayForAttempt, jitteredDelayForAttempt, RETRY_DELAYS_MS } from './backoff.js';

describe('retry schedule', () => {
  it('matches ARCHITECTURE.md 6.2', () => {
    expect(RETRY_DELAYS_MS).toEqual([
      0, 5_000, 30_000, 120_000, 600_000, 3_600_000, 21_600_000, 86_400_000,
    ]);
  });

  it('clamps to the last schedule entry beyond attempt 8', () => {
    expect(baseDelayForAttempt(9)).toBe(86_400_000);
    expect(baseDelayForAttempt(50)).toBe(86_400_000);
    expect(baseDelayForAttempt(1)).toBe(0);
  });

  it('applies ±20% jitter within bounds', () => {
    expect(jitteredDelayForAttempt(2, 0)).toBe(4_000);
    expect(jitteredDelayForAttempt(2, 0.5)).toBe(5_000);
    expect(jitteredDelayForAttempt(2, 1)).toBe(6_000);
    // Attempt 1 stays immediate.
    expect(jitteredDelayForAttempt(1, 1)).toBe(0);
  });
});
