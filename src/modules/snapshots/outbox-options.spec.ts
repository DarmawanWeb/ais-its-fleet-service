import { DEFAULT_OUTBOX_RETRY_BASE_MS } from '@darmawanweb/ais-its-nest/nats';
import { describe, expect, it } from 'vitest';

import type { Config } from '../../config.js';
import { outboxModuleOptions } from './outbox-options.js';

function config(overrides: Partial<Config> = {}): Config {
  return {
    OUTBOX_POLL_INTERVAL_MS: 500,
    OUTBOX_BATCH_SIZE: 100,
    OUTBOX_MAX_BACKOFF_MS: 60_000,
    OUTBOX_RETENTION_HOURS: 24,
    ...overrides,
  } as Config;
}

describe('outboxModuleOptions', () => {
  it('runs the kit relay per key from the OUTBOX_* variables', () => {
    expect(outboxModuleOptions(config())).toEqual({
      mode: 'per-key',
      pollIntervalMs: 500,
      batchSize: 100,
      retentionMs: 24 * 3_600_000,
      retry: { baseMs: DEFAULT_OUTBOX_RETRY_BASE_MS, maxMs: 60_000 },
    });
  });

  it('keeps a backoff cap below the first delay as the bound of every delay', () => {
    expect(
      outboxModuleOptions(config({ OUTBOX_MAX_BACKOFF_MS: 200 })).retry,
    ).toEqual({ baseMs: 200, maxMs: 200 });
  });
});
