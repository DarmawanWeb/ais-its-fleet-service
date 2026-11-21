import { Module } from '@nestjs/common';

import { FleetMetrics } from './fleet-metrics.js';
import { OutboxNotifier } from './outbox-notifier.js';
import { FleetOutboxRelay } from './outbox-relay.js';
import { OutboxRepository } from './outbox.repository.js';
import { RepublishService } from './republish.service.js';
import { SnapshotOutbox } from './snapshot-outbox.js';
import { VesselAggregatesRepository } from './vessel-aggregates.repository.js';

/**
 * VesselSnapshotV1 publication: aggregate loading, the transactional outbox
 * writer, the relay to the FLEET stream and republishing.
 */
@Module({
  providers: [
    VesselAggregatesRepository,
    SnapshotOutbox,
    OutboxRepository,
    FleetOutboxRelay,
    RepublishService,
    FleetMetrics,
    OutboxNotifier,
  ],
  exports: [
    VesselAggregatesRepository,
    SnapshotOutbox,
    FleetOutboxRelay,
    RepublishService,
    FleetMetrics,
    OutboxNotifier,
  ],
})
export class SnapshotsModule {}
