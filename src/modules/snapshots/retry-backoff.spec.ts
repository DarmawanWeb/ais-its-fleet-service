import { describe, expect, it } from 'vitest';

import { OUTBOX_BASE_BACKOFF_MS, outboxRetryDelayMs } from './retry-backoff.js';

describe('outboxRetryDelayMs', () => {
  it('doubles per attempt with equal jitter', () => {
    expect(outboxRetryDelayMs(1, 60_000, () => 0)).toBe(
      OUTBOX_BASE_BACKOFF_MS / 2,
    );
    expect(outboxRetryDelayMs(1, 60_000, () => 0.999_999)).toBe(
      OUTBOX_BASE_BACKOFF_MS,
    );
    expect(outboxRetryDelayMs(3, 60_000, () => 0.5)).toBe(3000);
  });

  it('is capped and tolerates nonsense attempt counts', () => {
    expect(outboxRetryDelayMs(50, 60_000, () => 0.999_999)).toBe(60_000);
    expect(outboxRetryDelayMs(0, 60_000, () => 0)).toBe(500);
  });
});
