import type { EventType } from '@darmawanweb/ais-its-contracts/events';
import type { Pool, PoolClient } from '@darmawanweb/ais-its-nest/db';
import { Injectable } from '@nestjs/common';

/** A pending outbox row claimed by a relay pass. */
export interface OutboxRow {
  readonly id: string;
  readonly type: EventType;
  readonly entityKey: string | null;
  readonly data: unknown;
  readonly createdAt: Date;
  readonly attempts: number;
}

/** Pending/failed counts of the outbox (gauges). */
export interface OutboxStats {
  readonly pending: number;
  readonly failed: number;
  readonly oldestPendingAt: Date | null;
}

interface OutboxRowRecord {
  readonly id: string;
  readonly type: EventType;
  readonly entity_key: string | null;
  readonly data: unknown;
  readonly created_at: Date;
  readonly attempts: number;
}

const ERROR_MAX_LENGTH = 1000;

/**
 * SQL of the relay over `fleet.outbox` (raw `pg`: row locks with
 * `SKIP LOCKED` and the column set of the kit's `enqueueEvent`).
 */
@Injectable()
export class OutboxRepository {
  /**
   * Locks up to `limit` publishable rows for the current transaction with
   * `FOR UPDATE SKIP LOCKED`: rows whose retry time has come and that are
   * the **oldest pending row of their vessel** (no pending row of the same
   * `entity_key` with a lower `seq`). Concurrent relays therefore share the
   * work without ever publishing two snapshots of one vessel out of order:
   * while a row is locked or waiting for its retry, the later rows of its
   * vessel are not eligible.
   */
  async claim(client: PoolClient, limit: number): Promise<OutboxRow[]> {
    const { rows } = await client.query<OutboxRowRecord>(
      `SELECT o.id, o.type, o.entity_key, o.data, o.created_at, o.attempts
         FROM outbox o
        WHERE o.published_at IS NULL AND o.failed_at IS NULL
          AND o.next_attempt_at <= now()
          AND NOT EXISTS (
                SELECT 1 FROM outbox p
                 WHERE p.entity_key = o.entity_key
                   AND p.published_at IS NULL AND p.failed_at IS NULL
                   AND p.seq < o.seq)
        ORDER BY o.seq
        LIMIT $1
          FOR UPDATE OF o SKIP LOCKED`,
      [limit],
    );
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      entityKey: row.entity_key,
      data: row.data,
      createdAt: row.created_at,
      attempts: row.attempts,
    }));
  }

  async markPublished(
    client: PoolClient,
    ids: readonly string[],
  ): Promise<void> {
    if (ids.length === 0) return;
    await client.query(
      'UPDATE outbox SET published_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = ANY($1::uuid[])',
      [ids],
    );
  }

  /** Records a failed attempt; the row becomes eligible again at `retryAt`. */
  async markRetry(
    client: PoolClient,
    id: string,
    error: string,
    retryAt: Date,
  ): Promise<void> {
    await client.query(
      'UPDATE outbox SET attempts = attempts + 1, last_error = $2, next_attempt_at = $3 WHERE id = $1',
      [id, error.slice(0, ERROR_MAX_LENGTH), retryAt],
    );
  }

  /** Parks a row that can never be published (it no longer blocks its vessel). */
  async markFailed(
    client: PoolClient,
    id: string,
    error: string,
  ): Promise<void> {
    await client.query(
      'UPDATE outbox SET attempts = attempts + 1, last_error = $2, failed_at = now() WHERE id = $1',
      [id, error.slice(0, ERROR_MAX_LENGTH)],
    );
  }

  async stats(pool: Pool): Promise<OutboxStats> {
    const { rows } = await pool.query<{
      pending: number;
      failed: number;
      oldest: Date | null;
    }>(
      `SELECT count(*) FILTER (WHERE published_at IS NULL AND failed_at IS NULL)::int AS pending,
              count(*) FILTER (WHERE failed_at IS NOT NULL)::int AS failed,
              min(created_at) FILTER (WHERE published_at IS NULL AND failed_at IS NULL) AS oldest
         FROM outbox
        WHERE published_at IS NULL`,
    );
    const row = rows[0];
    return {
      pending: row?.pending ?? 0,
      failed: row?.failed ?? 0,
      oldestPendingAt: row?.oldest ?? null,
    };
  }

  /** Deletes rows published before `before`; returns how many. */
  async deletePublishedBefore(pool: Pool, before: Date): Promise<number> {
    const result = await pool.query(
      'DELETE FROM outbox WHERE published_at < $1',
      [before],
    );
    return result.rowCount ?? 0;
  }
}
