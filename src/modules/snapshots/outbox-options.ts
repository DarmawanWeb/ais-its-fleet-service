import {
  DEFAULT_OUTBOX_RETRY_BASE_MS,
  type OutboxModuleOptions,
} from '@darmawanweb/ais-its-nest/nats';

import type { Config } from '../../config.js';

/**
 * Options of the kit's outbox relay (`OutboxModule`) from the `OUTBOX_*`
 * variables. `fleet.outbox` has `seq` (identity) and `next_attempt_at`
 * (`NOT NULL DEFAULT now()`: due when written), so the relay runs **per
 * key**; the mode is explicit so that a table without the columns fails the
 * start instead of falling back to the serial relay.
 *
 * Every replica relays (`FOR UPDATE SKIP LOCKED`). The rows of one vessel —
 * its snapshots and its tombstone, entity key = vessel id — are published in
 * `seq` order (writers lock the vessel row before enqueueing, see
 * `SnapshotOutbox`), and a failing row backs off on its own (equal-jitter
 * exponential from 1 s up to `OUTBOX_MAX_BACKOFF_MS`) while the other vessels
 * keep flowing. Rows that can never be published (payload no longer valid,
 * subject mismatch, above the server's `max_payload`) are parked
 * (`failed_at`).
 *
 * Every vessel a pass claims is published at once, as the service's own relay
 * did (`publishConcurrency` = `OUTBOX_BATCH_SIZE`; the kit default is 64):
 * a pass keeps its transaction open while it publishes and a vessel stops at
 * its first failed row, so during a NATS outage a pass waits one JetStream
 * request timeout (10 s), not one per group of 64 vessels — which at
 * `OUTBOX_BATCH_SIZE=1000` would be 16 of them, longer than the
 * `SHUTDOWN_TIMEOUT_MS` a stop waits for the current pass.
 */
export function outboxModuleOptions(config: Config): OutboxModuleOptions {
  return {
    mode: 'per-key',
    pollIntervalMs: config.OUTBOX_POLL_INTERVAL_MS,
    batchSize: config.OUTBOX_BATCH_SIZE,
    publishConcurrency: config.OUTBOX_BATCH_SIZE,
    retentionMs: config.OUTBOX_RETENTION_HOURS * 3_600_000,
    retry: {
      // A cap below the kit's first delay (1 s) bounds every delay, as the
      // service's own relay did (the kit never waits less than `baseMs`).
      baseMs: Math.min(
        DEFAULT_OUTBOX_RETRY_BASE_MS,
        config.OUTBOX_MAX_BACKOFF_MS,
      ),
      maxMs: config.OUTBOX_MAX_BACKOFF_MS,
    },
  };
}
