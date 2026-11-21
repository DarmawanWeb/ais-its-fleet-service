import { setTimeout as sleep } from 'node:timers/promises';

import {
  type EventPayload,
  type EventType,
  InvalidEventError,
} from '@darmawanweb/ais-its-contracts/events';
import { InjectConfig } from '@darmawanweb/ais-its-nest';
import {
  InjectPool,
  type Pool,
  type PoolClient,
  withTransaction,
} from '@darmawanweb/ais-its-nest/db';
import { MetricsService } from '@darmawanweb/ais-its-nest/metrics';
import {
  EventPublisher,
  EventSubjectMismatchError,
} from '@darmawanweb/ais-its-nest/nats';
import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { Counter, Gauge } from 'prom-client';

import type { Config } from '../../config.js';
import { type OutboxRow, OutboxRepository } from './outbox.repository.js';
import { outboxRetryDelayMs } from './retry-backoff.js';

/** Result of one relay pass. */
export interface RelayPassResult {
  /** Rows claimed by this pass. */
  readonly claimed: number;
  readonly published: number;
  /** Rows that failed and were rescheduled with backoff. */
  readonly retried: number;
  /** Rows parked as never publishable (`failed_at`). */
  readonly rejected: number;
}

/** What happened to a claimed row. */
type RelayOutcome = 'published' | 'retried' | 'rejected';

/** How often published rows are purged, ms. */
const CLEANUP_INTERVAL_MS = 10 * 60_000;

/** Errors a retry can never fix: the row is parked instead of blocking its vessel. */
function isPoison(error: unknown): boolean {
  return (
    error instanceof InvalidEventError ||
    error instanceof EventSubjectMismatchError
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Publishes `fleet.outbox` to the FLEET stream (`fleet.vessel.v1.<vesselId>`)
 * — this service is the stream's producer (spec §7.2, §13.3).
 *
 * Each pass claims rows with `FOR UPDATE SKIP LOCKED` (only the oldest
 * pending row of each vessel, see {@link OutboxRepository.claim}), publishes
 * them concurrently with the row id as envelope id and `Nats-Msg-Id`
 * (JetStream deduplicates a re-send after a crash between publish and
 * commit), and records the outcome in the same transaction. A failed row is
 * rescheduled with exponential backoff and blocks only its own vessel;
 * a row whose payload no longer validates is parked (`failed_at`).
 * Several replicas may run the relay at once.
 *
 * Metrics: `aisits_outbox_relayed_total{type,outcome}`,
 * `aisits_outbox_pending`, `aisits_outbox_oldest_pending_seconds`,
 * `aisits_outbox_failed`.
 */
@Injectable()
export class FleetOutboxRelay
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger('OutboxRelay');
  private readonly relayed: Counter<'type' | 'outcome'>;
  private readonly pending: Gauge;
  private readonly oldest: Gauge;
  private readonly failed: Gauge;
  private readonly stopping = new AbortController();
  private loop: Promise<void> | undefined;
  private wake: (() => void) | undefined;
  private lastCleanup = 0;

  constructor(
    @InjectPool() private readonly pool: Pool,
    @InjectConfig() private readonly config: Config,
    private readonly publisher: EventPublisher,
    private readonly outbox: OutboxRepository,
    metrics: MetricsService,
  ) {
    this.relayed = metrics.counter({
      name: 'outbox_relayed_total',
      help: 'Outbox rows relayed to NATS by event type and outcome (published, retried, rejected).',
      labelNames: ['type', 'outcome'],
    });
    this.pending = metrics.gauge({
      name: 'outbox_pending',
      help: 'Outbox rows waiting to be published.',
    });
    this.oldest = metrics.gauge({
      name: 'outbox_oldest_pending_seconds',
      help: 'Age of the oldest outbox row waiting to be published, seconds.',
    });
    this.failed = metrics.gauge({
      name: 'outbox_failed',
      help: 'Outbox rows parked because they can never be published.',
    });
  }

  /** Starts the relay loop (migrations ran in `onModuleInit`). */
  onApplicationBootstrap(): void {
    this.loop = this.run();
  }

  /** Stops the loop after the current pass. */
  async beforeApplicationShutdown(): Promise<void> {
    this.stopping.abort();
    this.wake?.();
    await this.loop;
  }

  /** Wakes the relay now (after a commit that enqueued rows) instead of at the next poll. */
  notify(): void {
    this.wake?.();
  }

  /** One pass: claim, publish, record. Never throws for publication failures. */
  async relayOnce(): Promise<RelayPassResult> {
    const outcomes = await withTransaction(this.pool, async (client) => {
      const rows = await this.outbox.claim(
        client,
        this.config.OUTBOX_BATCH_SIZE,
      );
      const settled = await Promise.allSettled(
        rows.map((row) => this.publish(row)),
      );
      const recorded: { row: OutboxRow; outcome: RelayOutcome }[] = [];
      for (const [index, attempt] of settled.entries()) {
        const row = rows[index];
        if (row === undefined) continue;
        recorded.push({
          row,
          outcome: await this.record(client, row, attempt),
        });
      }
      await this.outbox.markPublished(
        client,
        recorded
          .filter((entry) => entry.outcome === 'published')
          .map((entry) => entry.row.id),
      );
      return recorded;
    });
    // Counted after the commit: a rolled-back pass publishes its rows again.
    const result = {
      claimed: outcomes.length,
      published: 0,
      retried: 0,
      rejected: 0,
    };
    for (const { row, outcome } of outcomes) {
      this.relayed.inc({ type: row.type, outcome });
      result[outcome] += 1;
    }
    await this.updateGauges();
    return result;
  }

  /** Records a failed attempt (retry with backoff, or park a poison row). */
  private async record(
    client: PoolClient,
    row: OutboxRow,
    attempt: PromiseSettledResult<void>,
  ): Promise<RelayOutcome> {
    if (attempt.status === 'fulfilled') return 'published';
    const error = messageOf(attempt.reason);
    if (isPoison(attempt.reason)) {
      this.logger.error(
        `Outbox row ${row.id} (${row.type}, vessel ${row.entityKey}) can never be published, parked: ${error}`,
      );
      await this.outbox.markFailed(client, row.id, error);
      return 'rejected';
    }
    const delayMs = outboxRetryDelayMs(
      row.attempts + 1,
      this.config.OUTBOX_MAX_BACKOFF_MS,
    );
    this.logger.warn(
      `Publishing outbox row ${row.id} (${row.type}, vessel ${row.entityKey}) failed, retry in ${delayMs} ms: ${error}`,
    );
    await this.outbox.markRetry(
      client,
      row.id,
      error,
      new Date(Date.now() + delayMs),
    );
    return 'retried';
  }

  /** Deletes rows published longer than `OUTBOX_RETENTION_HOURS` ago. */
  async cleanup(): Promise<number> {
    const before = new Date(
      Date.now() - this.config.OUTBOX_RETENTION_HOURS * 3_600_000,
    );
    return this.outbox.deletePublishedBefore(this.pool, before);
  }

  private async publish(row: OutboxRow): Promise<void> {
    await this.publisher.publishEvent(
      row.type,
      // Validated by enqueueEvent when written; validated again by the publisher.
      row.data as EventPayload<EventType>,
      {
        id: row.id,
        msgId: row.id,
        time: row.createdAt,
        entityKey: row.entityKey ?? undefined,
      },
    );
  }

  private async updateGauges(): Promise<void> {
    const stats = await this.outbox.stats(this.pool);
    this.pending.set(stats.pending);
    this.failed.set(stats.failed);
    this.oldest.set(
      stats.oldestPendingAt === null
        ? 0
        : Math.max(0, (Date.now() - stats.oldestPendingAt.getTime()) / 1000),
    );
  }

  /** Read through a method: the signal changes while the loop awaits. */
  private isStopping(): boolean {
    return this.stopping.signal.aborted;
  }

  private async run(): Promise<void> {
    const pollMs = this.config.OUTBOX_POLL_INTERVAL_MS;
    let idleMs = pollMs;
    while (!this.isStopping()) {
      let busy = false;
      try {
        const pass = await this.relayOnce();
        busy = pass.claimed >= this.config.OUTBOX_BATCH_SIZE;
        idleMs = pollMs;
        if (Date.now() - this.lastCleanup > CLEANUP_INTERVAL_MS) {
          this.lastCleanup = Date.now();
          const deleted = await this.cleanup();
          if (deleted > 0)
            this.logger.log(`Purged ${deleted} published outbox rows`);
        }
      } catch (error) {
        // Database unreachable or similar: back off the whole loop.
        idleMs = Math.min(idleMs * 2, this.config.OUTBOX_MAX_BACKOFF_MS);
        this.logger.error(`Outbox relay pass failed: ${messageOf(error)}`);
      }
      if (busy || this.isStopping()) continue;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
        void sleep(idleMs, undefined, {
          signal: this.stopping.signal,
          ref: false,
        })
          .catch(() => undefined)
          .then(resolve);
      });
      this.wake = undefined;
    }
  }
}
