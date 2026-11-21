import { newId } from '@darmawanweb/ais-its-contracts/domain';
import { ServiceUnavailableError } from '@darmawanweb/ais-its-nest';
import {
  type AuditRequest,
  AuditService,
} from '@darmawanweb/ais-its-nest/audit';
import type { Principal } from '@darmawanweb/ais-its-nest/auth';
import { InjectDb, InjectPool, type Pool } from '@darmawanweb/ais-its-nest/db';
import { Injectable } from '@nestjs/common';

import { type FleetDb, inTransaction } from '../../db/database.js';
import {
  detectPhotoMediaType,
  PHOTO_MAX_BYTES,
  photoObjectKey,
} from '../../domain/photo.js';
import { ownsVessel } from '../../domain/vessel-access.js';
import {
  ForeignOrganizationError,
  PhotoNotFoundError,
  PhotoTooLargeError,
  UnsupportedPhotoError,
  VesselNotFoundError,
} from '../../errors.js';
import { FleetMetrics } from '../snapshots/fleet-metrics.js';
import { OutboxNotifier } from '../snapshots/outbox-notifier.js';
import { SnapshotOutbox } from '../snapshots/snapshot-outbox.js';
import { PhotoStorage } from '../storage/photo-storage.js';
import type { VesselView } from './vessel-view.js';
import { lockOwnedVessel } from './vessel-writes.js';
import { VesselsRepository } from './vessels.repository.js';
import { VesselsService } from './vessels.service.js';

/**
 * Vessel photos (spec §13.3): JPEG, PNG or WebP up to 5 MB, recognized by
 * their magic bytes, stored in S3 under a new key per upload; the vessel row
 * points at the current key. Object writes happen outside the database
 * transaction: a new object is removed again when the transaction fails, the
 * replaced or deleted object after it committed.
 */
@Injectable()
export class VesselPhotosService {
  constructor(
    @InjectPool() private readonly pool: Pool,
    @InjectDb() private readonly db: FleetDb,
    private readonly repository: VesselsRepository,
    private readonly vessels: VesselsService,
    private readonly snapshots: SnapshotOutbox,
    private readonly notifier: OutboxNotifier,
    private readonly storage: PhotoStorage,
    private readonly metrics: FleetMetrics,
    private readonly audit: AuditService,
  ) {}

  /** Stores a new photo of an owned vessel and returns the vessel view. */
  async upload(
    id: string,
    bytes: Uint8Array,
    principal: Principal,
    request?: AuditRequest,
  ): Promise<VesselView> {
    if (bytes.length > PHOTO_MAX_BYTES) {
      this.metrics.photoOperation('upload', 'rejected');
      throw new PhotoTooLargeError(PHOTO_MAX_BYTES);
    }
    const mediaType = detectPhotoMediaType(bytes);
    if (mediaType === undefined) {
      this.metrics.photoOperation('upload', 'rejected');
      throw new UnsupportedPhotoError(
        'The file is not a JPEG, PNG or WebP image (checked by its content)',
      );
    }
    // Tenancy before touching the bucket (checked again under the row lock below).
    const current = await this.repository.findRow(this.db, { id });
    if (current === undefined) throw new VesselNotFoundError({ id });
    if (!ownsVessel(principal, current.vessel))
      throw new ForeignOrganizationError();
    const key = photoObjectKey(id, newId(), mediaType);
    try {
      await this.storage.put(key, bytes, mediaType);
    } catch (error) {
      this.metrics.photoOperation('upload', 'failed');
      throw new ServiceUnavailableError('The photo storage is not available', {
        cause: error,
      });
    }
    let previous: string | null;
    try {
      previous = await inTransaction(this.pool, async (transaction) => {
        const vessel = await lockOwnedVessel(
          this.repository,
          transaction.db,
          id,
          principal,
        );
        await this.repository.update(transaction.db, id, { photoKey: key });
        await this.snapshots.enqueueUpserts(transaction, [id]);
        return vessel.photoKey;
      });
    } catch (error) {
      await this.storage.deleteQuietly(key);
      throw error;
    }
    this.notifier.committed('vessel_change', 1);
    this.metrics.photoOperation('upload', 'stored');
    if (previous !== null) await this.storage.deleteQuietly(previous);
    await this.audit.record(
      {
        action: 'vessel.photo.update',
        targetType: 'vessel',
        targetId: id,
        meta: { mediaType, bytes: bytes.length },
      },
      principal,
      request,
    );
    return this.vessels.get({ id }, principal);
  }

  /** Removes the photo of an owned vessel (`404 PHOTO_NOT_FOUND` without one). */
  async remove(
    id: string,
    principal: Principal,
    request?: AuditRequest,
  ): Promise<void> {
    const key = await inTransaction(this.pool, async (transaction) => {
      const vessel = await lockOwnedVessel(
        this.repository,
        transaction.db,
        id,
        principal,
      );
      if (vessel.photoKey === null) throw new PhotoNotFoundError(id);
      await this.repository.update(transaction.db, id, { photoKey: null });
      await this.snapshots.enqueueUpserts(transaction, [id]);
      return vessel.photoKey;
    });
    this.notifier.committed('vessel_change', 1);
    const deleted = await this.storage.deleteQuietly(key);
    this.metrics.photoOperation('delete', deleted ? 'deleted' : 'failed');
    await this.audit.record(
      {
        action: 'vessel.photo.delete',
        targetType: 'vessel',
        targetId: id,
        meta: {},
      },
      principal,
      request,
    );
  }
}
