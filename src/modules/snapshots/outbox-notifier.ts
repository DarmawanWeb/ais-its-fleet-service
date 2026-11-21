import { Injectable } from '@nestjs/common';

import { FleetMetrics, type SnapshotReason } from './fleet-metrics.js';
import { FleetOutboxRelay } from './outbox-relay.js';

/**
 * Called after a transaction that enqueued snapshots committed: counts them
 * and wakes the relay (counting inside the transaction would double-count a
 * retried one; waking before the commit would find nothing to publish).
 */
@Injectable()
export class OutboxNotifier {
  constructor(
    private readonly relay: FleetOutboxRelay,
    private readonly metrics: FleetMetrics,
  ) {}

  committed(reason: SnapshotReason, count: number): void {
    this.metrics.snapshotsEnqueued(reason, count);
    if (count > 0) this.relay.notify();
  }
}
