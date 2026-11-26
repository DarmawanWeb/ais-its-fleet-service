import type { Paginated } from '@darmawanweb/ais-its-contracts/api';
import { newId } from '@darmawanweb/ais-its-contracts/domain';
import {
  type AuditRequest,
  AuditService,
} from '@darmawanweb/ais-its-nest/audit';
import type { Principal } from '@darmawanweb/ais-its-nest/auth';
import { InjectDb, InjectPool, type Pool } from '@darmawanweb/ais-its-nest/db';
import { pageOffsetOf, paginate } from '@darmawanweb/ais-its-nest/http';
import { Injectable } from '@nestjs/common';

import type { FleetDb } from '../../db/database.js';
import type { VesselType } from '../../domain/vessel.js';
import { ReferenceNotFoundError } from '../../errors.js';
import {
  changesEmbedded,
  deleteUnusedReference,
  type ReferenceChange,
  updateReference,
  withUniqueCode,
} from '../common/reference-writes.js';
import { OutboxNotifier } from '../snapshots/outbox-notifier.js';
import { SnapshotOutbox } from '../snapshots/snapshot-outbox.js';
import { VesselAggregatesRepository } from '../snapshots/vessel-aggregates.repository.js';
import type {
  CreateVesselTypeDto,
  UpdateVesselTypeDto,
} from './dto/vessel-type.dto.js';
import {
  VESSEL_TYPE_CODE_CONSTRAINT,
  type VesselTypeChanges,
  VesselTypesRepository,
} from './vessel-types.repository.js';

/** The defined members of a PATCH body as column changes (`null` clears). */
function changesOf(body: UpdateVesselTypeDto): VesselTypeChanges {
  return {
    ...(body.code === undefined ? {} : { code: body.code }),
    ...(body.name === undefined ? {} : { name: body.name }),
    ...(body.capacityUnit === undefined
      ? {}
      : { capacityUnit: body.capacityUnit }),
    ...(body.a === undefined ? {} : { a: body.a }),
    ...(body.c === undefined ? {} : { c: body.c }),
    ...(body.capacityFixed === undefined
      ? {}
      : { capacityFixed: body.capacityFixed }),
    ...(body.d === undefined
      ? {}
      : { d1: body.d.d1, d2: body.d.d2, d3: body.d.d3, d4: body.d.d4 }),
    ...(body.icon === undefined ? {} : { icon: body.icon }),
    ...(body.source === undefined ? {} : { source: body.source }),
    ...(body.referenceIds === undefined
      ? {}
      : { referenceIds: body.referenceIds }),
  };
}

/** The members vessel snapshots embed: only their changes republish vessels. */
const VESSEL_TYPE_EMBEDDED: readonly (keyof VesselTypeChanges)[] = [
  'code',
  'name',
  'capacityUnit',
  'a',
  'c',
  'capacityFixed',
  'd1',
  'd2',
  'd3',
  'd4',
];

/**
 * Ship types (reference data): CRUD with unique codes; a change republishes
 * the snapshot of every vessel of the type in the same transaction, a type
 * in use cannot be deleted.
 */
@Injectable()
export class VesselTypesService {
  constructor(
    @InjectPool() private readonly pool: Pool,
    @InjectDb() private readonly db: FleetDb,
    private readonly repository: VesselTypesRepository,
    private readonly aggregates: VesselAggregatesRepository,
    private readonly snapshots: SnapshotOutbox,
    private readonly notifier: OutboxNotifier,
    private readonly audit: AuditService,
  ) {}

  async list(query: {
    readonly page: number;
    readonly pageSize: number;
    readonly search?: string | undefined;
  }): Promise<Paginated<VesselType>> {
    const { rows, total } = await this.repository.list(this.db, query.search, {
      offset: pageOffsetOf(query),
      limit: query.pageSize,
    });
    return paginate(rows, query, total);
  }

  async get(id: string): Promise<VesselType> {
    const type = await this.repository.findById(this.db, id);
    if (type === undefined) throw new ReferenceNotFoundError('vessel_type', id);
    return type;
  }

  async create(
    body: CreateVesselTypeDto,
    principal: Principal,
    request?: AuditRequest,
  ): Promise<VesselType> {
    const type = await withUniqueCode(
      'vessel_type',
      VESSEL_TYPE_CODE_CONSTRAINT,
      body.code,
      () =>
        this.repository.insert(this.db, {
          id: newId(),
          code: body.code,
          name: body.name,
          capacityUnit: body.capacityUnit,
          a: body.a,
          c: body.c,
          capacityFixed: body.capacityFixed ?? null,
          d1: body.d.d1,
          d2: body.d.d2,
          d3: body.d.d3,
          d4: body.d.d4,
          icon: body.icon ?? null,
          source: body.source ?? null,
          referenceIds: body.referenceIds ?? [],
        }),
    );
    await this.audit.record(
      {
        action: 'vessel_type.create',
        targetType: 'vessel_type',
        targetId: type.id,
        meta: { code: type.code },
      },
      principal,
      request,
    );
    return type;
  }

  /** Applies the changes and republishes every vessel of the type. */
  async update(
    id: string,
    body: UpdateVesselTypeDto,
    principal: Principal,
    request?: AuditRequest,
  ): Promise<ReferenceChange<VesselType>> {
    const changes = changesOf(body);
    const fields = Object.keys(changes);
    if (fields.length === 0) {
      return { value: await this.get(id), republished: 0 };
    }
    const change = await withUniqueCode(
      'vessel_type',
      VESSEL_TYPE_CODE_CONSTRAINT,
      changes.code,
      () =>
        updateReference({
          pool: this.pool,
          resource: 'vessel_type',
          id,
          snapshots: this.snapshots,
          notifier: this.notifier,
          embeddedBy: changesEmbedded(changes, VESSEL_TYPE_EMBEDDED)
            ? { typeId: id }
            : null,
          update: (db) => this.repository.update(db, id, changes),
        }),
    );
    await this.audit.record(
      {
        action: 'vessel_type.update',
        targetType: 'vessel_type',
        targetId: id,
        meta: { fields, republished: change.republished },
      },
      principal,
      request,
    );
    return change;
  }

  async remove(
    id: string,
    principal: Principal,
    request?: AuditRequest,
  ): Promise<void> {
    const deleted = await deleteUnusedReference({
      pool: this.pool,
      resource: 'vessel_type',
      id,
      users: (db) => this.aggregates.countVesselsUsing(db, { typeId: id }),
      remove: (db) => this.repository.delete(db, id),
    });
    await this.audit.record(
      {
        action: 'vessel_type.delete',
        targetType: 'vessel_type',
        targetId: id,
        meta: { code: deleted.code },
      },
      principal,
      request,
    );
  }
}
