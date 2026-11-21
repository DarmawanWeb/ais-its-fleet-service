import type { Pool } from '@darmawanweb/ais-its-nest/db';

import { type FleetDb, inTransaction } from '../../db/database.js';
import { isForeignKeyViolation, isUniqueViolation } from '../../db/errors.js';
import {
  CodeTakenError,
  type FleetResource,
  ReferenceInUseError,
  ReferenceNotFoundError,
} from '../../errors.js';
import type { OutboxNotifier } from '../snapshots/outbox-notifier.js';
import type { SnapshotOutbox } from '../snapshots/snapshot-outbox.js';
import type { ReferenceFilter } from '../snapshots/vessel-aggregates.repository.js';

/** Result of a reference-data change: the row and how many vessel snapshots it republished. */
export interface ReferenceChange<T> {
  readonly value: T;
  readonly republished: number;
}

/** Runs a write and maps a duplicate code (`constraint`) to `409 CODE_ALREADY_EXISTS`. */
export async function withUniqueCode<T>(
  resource: FleetResource,
  constraint: string,
  code: string | null | undefined,
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isUniqueViolation(error, constraint)) {
      throw new CodeTakenError(resource, code ?? '', error);
    }
    throw error;
  }
}

/** Options of {@link updateReference}. */
export interface UpdateReferenceOptions<T> {
  readonly pool: Pool;
  readonly resource: FleetResource;
  readonly id: string;
  readonly snapshots: SnapshotOutbox;
  readonly notifier: OutboxNotifier;
  /** The vessels whose snapshots embed the row; `null` when none do (ports). */
  readonly embeddedBy: ReferenceFilter | null;
  /** Updates the row (locking it); `undefined` when it does not exist. */
  readonly update: (db: FleetDb) => Promise<T | undefined>;
}

/**
 * Updates a reference row and, in the same transaction, republishes the
 * snapshot of every vessel that embeds it (spec §13.3); `404` when absent.
 */
export async function updateReference<T>(
  options: UpdateReferenceOptions<T>,
): Promise<ReferenceChange<T>> {
  const change = await inTransaction(options.pool, async (transaction) => {
    const value = await options.update(transaction.db);
    if (value === undefined) {
      throw new ReferenceNotFoundError(options.resource, options.id);
    }
    const republished =
      options.embeddedBy === null
        ? 0
        : await options.snapshots.enqueueVesselsUsing(
            transaction,
            options.embeddedBy,
          );
    return { value, republished };
  });
  options.notifier.committed('reference_change', change.republished);
  return change;
}

/** Options of {@link deleteUnusedReference}. */
export interface DeleteReferenceOptions<T> {
  readonly pool: Pool;
  readonly resource: FleetResource;
  readonly id: string;
  /** Number of vessels using the row. */
  readonly users: (db: FleetDb) => Promise<number>;
  /** Deletes the row; `undefined` when it does not exist. */
  readonly remove: (db: FleetDb) => Promise<T | undefined>;
}

/**
 * Deletes a reference row that no vessel uses: `409 REFERENCE_IN_USE`
 * otherwise (also when a vessel takes it concurrently: the foreign key is
 * `ON DELETE RESTRICT`), `404` when absent.
 */
export async function deleteUnusedReference<T>(
  options: DeleteReferenceOptions<T>,
): Promise<T> {
  const deleted = await inTransaction(options.pool, async (transaction) => {
    const users = await options.users(transaction.db);
    if (users > 0) {
      throw new ReferenceInUseError(options.resource, options.id, users);
    }
    try {
      return await options.remove(transaction.db);
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new ReferenceInUseError(options.resource, options.id, 1);
      }
      throw error;
    }
  });
  if (deleted === undefined) {
    throw new ReferenceNotFoundError(options.resource, options.id);
  }
  return deleted;
}

/** `value` without its `undefined` members (absent and `undefined` mean "keep"; `null` clears). */
export function definedChanges<T extends object>(
  value: T,
): { [Key in keyof T]?: Exclude<T[Key], undefined> } {
  // Object.fromEntries loses the key types; the filter keeps exactly the defined members.
  return Object.fromEntries(
    Object.entries(value).filter(([, member]) => member !== undefined),
  ) as { [Key in keyof T]?: Exclude<T[Key], undefined> };
}
