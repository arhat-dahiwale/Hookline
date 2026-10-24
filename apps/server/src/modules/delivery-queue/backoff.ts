/**
 * Retry schedule per ARCHITECTURE.md 6.2: delay before attempt N (1-based).
 * Attempt 1 is immediate. Jitter of ±20% is applied on top.
 */
export const RETRY_DELAYS_MS: readonly number[] = [
  0, // attempt 1: immediate
  5_000, // attempt 2
  30_000, // attempt 3
  120_000, // attempt 4
  600_000, // attempt 5
  3_600_000, // attempt 6
  21_600_000, // attempt 7
  86_400_000, // attempt 8
];

export const JITTER_RATIO = 0.2;

/** Deterministic delay (no jitter) before the given 1-based attempt number. */
export function baseDelayForAttempt(attemptNumber: number): number {
  const index = Math.min(Math.max(attemptNumber - 1, 0), RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[index]!;
}

/**
 * Delay with jitter for the given upcoming attempt number. `random` is
 * injectable for tests (0 = minimum −20%, 0.5 ≈ midpoint, 1 = maximum +20%).
 */
export function jitteredDelayForAttempt(attemptNumber: number, random = Math.random()): number {
  const base = baseDelayForAttempt(attemptNumber);
  if (base === 0) return 0;
  const spread = base * JITTER_RATIO;
  return Math.round(base - spread + random * 2 * spread);
}
