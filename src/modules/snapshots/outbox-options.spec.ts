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
      publishConcurrency: 100,
      retentionMs: 24 * 3_600_000,
      retry: { baseMs: DEFAULT_OUTBOX_RETRY_BASE_MS, maxMs: 60_000 },
    });
  });

  it('publishes every claimed vessel at once (one request timeout per pass during an outage)', () => {
    // The kit default (64 keys at once) would make a pass of 1000 vessels
    // wait 16 JetStream request timeouts while NATS is unreachable.
    for (const size of [1, 64, 65, 1000]) {
      const options = outboxModuleOptions(config({ OUTBOX_BATCH_SIZE: size }));
      expect(options.publishConcurrency).toBe(size);
      expect(options.publishConcurrency).toBe(options.batchSize);
    }
  });

  it('keeps a backoff cap below the first delay as the bound of every delay', () => {
    expect(
      outboxModuleOptions(config({ OUTBOX_MAX_BACKOFF_MS: 200 })).retry,
    ).toEqual({ baseMs: 200, maxMs: 200 });
  });
});
