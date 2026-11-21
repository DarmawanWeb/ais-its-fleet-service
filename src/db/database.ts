import {
  type Database,
  type Pool,
  type PoolClient,
  withTransaction,
} from '@darmawanweb/ais-its-nest/db';
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

/**
 * Runs `work` in one transaction (`COMMIT` on success, `ROLLBACK` on error)
 * with drizzle bound to its client. `work` may run more than once (see
 * {@link TRANSACTION_RETRIES}): keep side effects outside the database
 * (S3, audit, metrics) after this call.
 */
export function inTransaction<T>(
  pool: Pool,
  work: (transaction: FleetTransaction) => Promise<T>,
): Promise<T> {
  return withTransaction(
    pool,
    (client) => work({ client, db: drizzle({ client, schema }) }),
    { retries: TRANSACTION_RETRIES },
  );
}
