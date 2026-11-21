import { InjectConfig } from '@darmawanweb/ais-its-nest';
import { InjectPool, type Pool } from '@darmawanweb/ais-its-nest/db';
import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';

import type { Config } from '../../config.js';
import { inTransaction } from '../../db/database.js';
import { OutboxNotifier } from './outbox-notifier.js';
import { SnapshotOutbox } from './snapshot-outbox.js';
import { VesselAggregatesRepository } from './vessel-aggregates.repository.js';

/** Vessels re-enqueued per transaction by a full republish. */
const REPUBLISH_PAGE_SIZE = 500;

/**
 * Re-enqueues snapshots without changing data: the full fleet at startup
 * when `FLEET_REPUBLISH_ON_BOOT=true` (rebuilding the FLEET stream after it
 * was lost or purged), or everything on demand.
 */
@Injectable()
export class RepublishService
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger('Republish');
  private running: Promise<void> | undefined;

  constructor(
    @InjectPool() private readonly pool: Pool,
    @InjectConfig() private readonly config: Config,
    private readonly aggregates: VesselAggregatesRepository,
    private readonly snapshots: SnapshotOutbox,
    private readonly notifier: OutboxNotifier,
  ) {}

  /** Starts the boot republish in the background (the HTTP port opens meanwhile). */
  onApplicationBootstrap(): void {
    if (!this.config.FLEET_REPUBLISH_ON_BOOT) return;
    this.running = this.republishAll().then(
      (count) => {
        this.logger.log(`Republished the snapshots of ${count} vessels`);
      },
      (error: unknown) => {
        this.logger.error(
          `Republishing the fleet on boot failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      },
    );
  }

  /** Waits for a running boot republish (its pages commit independently). */
  async beforeApplicationShutdown(): Promise<void> {
    await this.running;
  }

  /**
   * Enqueues the snapshot of every vessel, page by page (each page is one
   * transaction that share-locks its vessels).
   *
   * @returns the number of snapshots enqueued
   */
  async republishAll(): Promise<number> {
    let afterId: string | null = null;
    let total = 0;
    for (;;) {
      const cursor: string | null = afterId;
      const page = await inTransaction(this.pool, async (transaction) => {
        const ids = await this.aggregates.lockPageForRepublish(
          transaction.db,
          cursor,
          REPUBLISH_PAGE_SIZE,
        );
        await this.snapshots.enqueueUpserts(transaction, ids);
        return ids;
      });
      this.notifier.committed('republish', page.length);
      total += page.length;
      const last = page.at(-1);
      if (last === undefined || page.length < REPUBLISH_PAGE_SIZE) return total;
      afterId = last;
    }
  }
}
