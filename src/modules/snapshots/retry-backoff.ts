/** First retry delay of a failing outbox row, ms. */
export const OUTBOX_BASE_BACKOFF_MS = 1000;

/**
 * Delay before the next publication attempt of an outbox row: exponential
 * (`base · 2^(attempts − 1)`), capped at `maxMs`, with "equal jitter"
 * (between half and all of it) so rows that failed together during a NATS
 * outage do not retry in lockstep.
 *
 * @param attempts - failed attempts so far, including the one just made (≥ 1)
 * @param maxMs - upper bound (`OUTBOX_MAX_BACKOFF_MS`)
 * @param random - source of randomness in [0, 1) (tests pass a constant)
 */
export function outboxRetryDelayMs(
  attempts: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  const exponent = Math.min(Math.max(attempts, 1) - 1, 30);
  const capped = Math.min(maxMs, OUTBOX_BASE_BACKOFF_MS * 2 ** exponent);
  return Math.round(capped / 2 + (capped / 2) * random());
}
