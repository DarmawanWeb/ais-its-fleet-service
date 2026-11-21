import { MetricsService } from '@darmawanweb/ais-its-nest/metrics';
import { Injectable } from '@nestjs/common';
import type { Counter } from 'prom-client';

/** Why snapshots were enqueued. */
export type SnapshotReason =
  'vessel_change' | 'vessel_delete' | 'reference_change' | 'republish';

/** Photo operations and their outcomes. */
export type PhotoOperation = 'upload' | 'delete';
export type PhotoOutcome = 'stored' | 'deleted' | 'rejected' | 'failed';

/**
 * Domain metrics of the fleet service (prefix `aisits_` added by the kit):
 * `aisits_fleet_snapshots_enqueued_total{reason}` and
 * `aisits_fleet_photo_operations_total{operation,outcome}`. Callers count
 * after their transaction committed (transactions may be retried).
 */
@Injectable()
export class FleetMetrics {
  private readonly enqueued: Counter<'reason'>;
  private readonly photos: Counter<'operation' | 'outcome'>;

  constructor(metrics: MetricsService) {
    this.enqueued = metrics.counter({
      name: 'fleet_snapshots_enqueued_total',
      help: 'Vessel snapshots and tombstones written to the outbox, by reason.',
      labelNames: ['reason'],
    });
    this.photos = metrics.counter({
      name: 'fleet_photo_operations_total',
      help: 'Vessel photo uploads and deletions by outcome.',
      labelNames: ['operation', 'outcome'],
    });
  }

  snapshotsEnqueued(reason: SnapshotReason, count: number): void {
    if (count > 0) this.enqueued.inc({ reason }, count);
  }

  photoOperation(operation: PhotoOperation, outcome: PhotoOutcome): void {
    this.photos.inc({ operation, outcome });
  }
}
