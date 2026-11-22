import { setTimeout as sleep } from 'node:timers/promises';

import {
  type Database,
  type Pool,
  type PoolClient,
  withTransaction,
} from '@darmawanweb/ais-its-nest/db';
import { Logger } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';

import { pgErrorOf } from './errors.js';
import * as schema from './schema.js';

/** Drizzle over the pool (`@InjectDb()`) or over the client of a transaction. */
export type FleetDb = Database<typeof schema>;

/** An open transaction: drizzle for queries, the raw client for kit helpers (`enqueueEvent`). */
export interface FleetTransaction {
  readonly db: FleetDb;
  readonly client: PoolClient;
}

/**
 * Deadlocks and serialization failures are retried this often: a vessel
 * write locks the vessel row and then shares the reference rows it embeds,
 * a reference-data cascade does the opposite (see `SnapshotOutbox`), so two
 * such transactions racing on the same rows may deadlock and are re-run.
 */
export const TRANSACTION_RETRIES = 3;

/** SQLSTATEs worth re-running a transaction for: serialization failure, deadlock. */
const RETRYABLE_SQLSTATES: ReadonlySet<string> = new Set(['40001', '40P01']);

const logger = new Logger('Transaction');

/**
 * The SQLSTATE of a retryable failure behind `error` (drizzle wraps driver
 * errors in `DrizzleQueryError`, so causes are followed), or `undefined`.
 */
export function retryableSqlState(error: unknown): string | undefined {
  const state = pgErrorOf(error)?.code;
  return state !== undefined && RETRYABLE_SQLSTATES.has(state)
    ? state
    : undefined;
}

/**
 * Runs `work` in one transaction (`COMMIT` on success, `ROLLBACK` on error)
 * with drizzle bound to its client. `work` may run more than once (see
 * {@link TRANSACTION_RETRIES}): keep side effects outside the database
 * (S3, audit, metrics) after this call.
 *
 * WORKAROUND (platform issue): the kit's `withTransaction({ retries })`
 * reads the SQLSTATE of the thrown error only, so the deadlock of a drizzle
 * query (a `DrizzleQueryError` whose `cause` holds the code) was never
 * retried and surfaced as `500`. The retry loop lives here, with a short
 * jittered pause, until the kit follows error causes.
 */
export async function inTransaction<T>(
  pool: Pool,
  work: (transaction: FleetTransaction) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await withTransaction(pool, (client) =>
        work({ client, db: drizzle({ client, schema }) }),
      );
    } catch (error) {
      const state = retryableSqlState(error);
      if (state === undefined || attempt >= TRANSACTION_RETRIES) throw error;
      logger.warn(
        `Transaction failed with SQLSTATE ${state}, re-running it (retry ${attempt + 1} of ${TRANSACTION_RETRIES})`,
      );
      await sleep(10 * 2 ** attempt + Math.floor(Math.random() * 10));
    }
  }
}
