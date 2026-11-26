import { APP_CONFIG } from '@darmawanweb/ais-its-nest';
import { OutboxModule } from '@darmawanweb/ais-its-nest/nats';
import { Module } from '@nestjs/common';

import type { Config } from '../../config.js';
import { FleetMetrics } from './fleet-metrics.js';
import { OutboxNotifier } from './outbox-notifier.js';
import { outboxModuleOptions } from './outbox-options.js';
import { ReferenceUsage } from './reference-usage.js';
import { RepublishService } from './republish.service.js';
import { SnapshotOutbox } from './snapshot-outbox.js';
import { VesselAggregatesRepository } from './vessel-aggregates.repository.js';

/**
 * VesselSnapshotV1 publication: aggregate loading, the transactional outbox
 * writer, the relay to the FLEET stream (the kit's `OutboxRelay` in per-key
 * mode, see {@link outboxModuleOptions}) and republishing.
 */
@Module({
  imports: [
    OutboxModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: Config) => outboxModuleOptions(config),
    }),
  ],
  providers: [
    VesselAggregatesRepository,
    SnapshotOutbox,
    RepublishService,
    FleetMetrics,
    OutboxNotifier,
    ReferenceUsage,
  ],
  exports: [
    OutboxModule,
    VesselAggregatesRepository,
    SnapshotOutbox,
    RepublishService,
    FleetMetrics,
    OutboxNotifier,
    ReferenceUsage,
  ],
})
export class SnapshotsModule {}
