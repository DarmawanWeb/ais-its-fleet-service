import {
  type Database,
  type Pool,
  type PoolClient,
  withTransaction,
} from '@darmawanweb/ais-its-nest/db';
import { Logger } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';

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

const logger = new Logger('Transaction');

/**
 * Pause before re-running a transaction, ms (the kit's default range,
 * 10–50 ms), logging the re-run: deadlocks are expected but rare, and their
 * frequency tells whether writes and cascades contend.
 */
function retryDelayMs(retry: number): number {
  logger.warn(
    `Transaction failed with a deadlock or serialization failure, re-running it (retry ${retry} of ${TRANSACTION_RETRIES})`,
  );
  return 10 + Math.floor(Math.random() * 40);
}

/**
 * Runs `work` in one transaction (`COMMIT` on success, `ROLLBACK` on error)
 * with drizzle bound to its client. A deadlock (`40P01`) or serialization
 * failure (`40001`) re-runs it up to {@link TRANSACTION_RETRIES} times —
 * the kit's `withTransaction({ retries })` finds the SQLSTATE behind
 * drizzle's `DrizzleQueryError` and waits 10–50 ms on a released client
 * between attempts. `work` may therefore run more than once: keep side
 * effects outside the database (S3, audit, metrics, relay wake-ups) after
 * this call.
 */
export function inTransaction<T>(
  pool: Pool,
  work: (transaction: FleetTransaction) => Promise<T>,
): Promise<T> {
  return withTransaction(
    pool,
    (client) => work({ client, db: drizzle({ client, schema }) }),
    { retries: TRANSACTION_RETRIES, retryDelayMs },
  );
}
