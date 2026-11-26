import { EVENT_TYPES } from '@darmawanweb/ais-its-contracts/events';
import { enqueueEvent } from '@darmawanweb/ais-its-nest/nats';
import { Injectable } from '@nestjs/common';

import type { FleetTransaction } from '../../db/database.js';
import {
  toVesselDeleted,
  toVesselSnapshot,
} from '../../domain/vessel-snapshot.js';
import type { VesselRecord } from '../../domain/vessel.js';
import {
  type ReferenceFilter,
  VesselAggregatesRepository,
} from './vessel-aggregates.repository.js';

/** Vessels snapshotted per aggregate query (cascades over large fleets). */
const SNAPSHOT_BATCH_SIZE = 500;

function* chunks<T>(items: readonly T[], size: number): Generator<T[]> {
  for (let start = 0; start < items.length; start += size) {
    yield items.slice(start, start + size);
  }
}

/**
 * Writes VesselSnapshotV1 / VesselDeletedV1 rows into `fleet.outbox` inside
 * the caller's transaction (transactional outbox, spec §13.3): they commit or
 * roll back with the change and the kit's `OutboxRelay` publishes them to
 * `fleet.vessel.v1.<vesselId>` afterwards.
 *
 * Ordering contract: callers lock the vessel row before enqueueing (an
 * `UPDATE`, `DELETE` or `SELECT … FOR UPDATE/SHARE` of the vessel), so the
 * outbox `seq` of one vessel follows commit order and the per-key relay
 * publishes its snapshots in that order. Database only (the seed CLI uses it too);
 * after the commit, callers signal {@link OutboxNotifier}.
 */
@Injectable()
export class SnapshotOutbox {
  constructor(private readonly aggregates: VesselAggregatesRepository) {}

  /**
   * Enqueues the current snapshot of every vessel in `vesselIds`, read in
   * the transaction (reference rows share-locked).
   *
   * @returns the number of rows enqueued
   * @throws Error when a vessel has no complete aggregate (the transaction rolls back)
   */
  async enqueueUpserts(
    transaction: FleetTransaction,
    vesselIds: readonly string[],
  ): Promise<number> {
    let enqueued = 0;
    for (const chunk of chunks([...new Set(vesselIds)], SNAPSHOT_BATCH_SIZE)) {
      const loaded = await this.aggregates.load(transaction.db, chunk, {
        lockReferences: true,
      });
      for (const id of chunk) {
        const aggregate = loaded.get(id);
        if (aggregate === undefined) {
          throw new Error(
            `Vessel ${id} has no complete aggregate (row or dimensions missing)`,
          );
        }
        await enqueueEvent(
          transaction.client,
          EVENT_TYPES.FLEET_VESSEL_UPSERTED,
          toVesselSnapshot(aggregate),
          { entityKey: id },
        );
        enqueued += 1;
      }
    }
    return enqueued;
  }

  /**
   * Cascade of a reference-data change (spec §13.3): locks every vessel
   * that embeds the changed row, advances its `updated_at` and enqueues its
   * new snapshot — call it in the transaction that changed the row.
   *
   * @returns the number of vessels republished
   */
  async enqueueVesselsUsing(
    transaction: FleetTransaction,
    filter: ReferenceFilter,
  ): Promise<number> {
    const ids = await this.aggregates.touchVesselsUsing(transaction.db, filter);
    return this.enqueueUpserts(transaction, ids);
  }

  /** Enqueues the tombstone of a vessel deleted in the transaction. */
  async enqueueDeleted(
    transaction: FleetTransaction,
    vessel: Pick<VesselRecord, 'id' | 'mmsi' | 'orgId'>,
  ): Promise<void> {
    await enqueueEvent(
      transaction.client,
      EVENT_TYPES.FLEET_VESSEL_DELETED,
      toVesselDeleted(vessel),
      { entityKey: vessel.id },
    );
  }
}
