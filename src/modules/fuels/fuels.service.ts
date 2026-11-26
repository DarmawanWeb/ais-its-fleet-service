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
import type { Fuel } from '../../domain/vessel.js';
import { ReferenceNotFoundError } from '../../errors.js';
import {
  changesEmbedded,
  definedChanges,
  deleteUnusedReference,
  type ReferenceChange,
  updateReference,
  withUniqueCode,
} from '../common/reference-writes.js';
import { OutboxNotifier } from '../snapshots/outbox-notifier.js';
import { SnapshotOutbox } from '../snapshots/snapshot-outbox.js';
import { VesselAggregatesRepository } from '../snapshots/vessel-aggregates.repository.js';
import type { CreateFuelDto, UpdateFuelDto } from './dto/fuel.dto.js';
import { FUEL_CODE_CONSTRAINT, FuelsRepository } from './fuels.repository.js';

/** The members vessel snapshots embed: only their changes republish vessels. */
const FUEL_EMBEDDED: readonly (keyof UpdateFuelDto)[] = [
  'code',
  'name',
  'carbonContent',
  'conversionFactor',
  'density',
];

/**
 * Fuels (reference data): CRUD with unique codes; a change (e.g. a corrected
 * Cf or density) republishes the snapshot of every vessel burning the fuel
 * in the same transaction, a fuel in use cannot be deleted.
 */
@Injectable()
export class FuelsService {
  constructor(
    @InjectPool() private readonly pool: Pool,
    @InjectDb() private readonly db: FleetDb,
    private readonly repository: FuelsRepository,
    private readonly aggregates: VesselAggregatesRepository,
    private readonly snapshots: SnapshotOutbox,
    private readonly notifier: OutboxNotifier,
    private readonly audit: AuditService,
  ) {}

  async list(query: {
    readonly page: number;
    readonly pageSize: number;
    readonly search?: string | undefined;
  }): Promise<Paginated<Fuel>> {
    const { rows, total } = await this.repository.list(this.db, query.search, {
      offset: pageOffsetOf(query),
      limit: query.pageSize,
    });
    return paginate(rows, query, total);
  }

  async get(id: string): Promise<Fuel> {
    const fuel = await this.repository.findById(this.db, id);
    if (fuel === undefined) throw new ReferenceNotFoundError('fuel', id);
    return fuel;
  }

  async create(
    body: CreateFuelDto,
    principal: Principal,
    request?: AuditRequest,
  ): Promise<Fuel> {
    const fuel = await withUniqueCode(
      'fuel',
      FUEL_CODE_CONSTRAINT,
      body.code,
      () =>
        this.repository.insert(this.db, {
          id: newId(),
          code: body.code,
          name: body.name,
          carbonContent: body.carbonContent,
          conversionFactor: body.conversionFactor,
          density: body.density,
          source: body.source ?? null,
          referenceIds: body.referenceIds ?? [],
        }),
    );
    await this.audit.record(
      {
        action: 'fuel.create',
        targetType: 'fuel',
        targetId: fuel.id,
        meta: { code: fuel.code },
      },
      principal,
      request,
    );
    return fuel;
  }

  /** Applies the changes and republishes every vessel burning the fuel. */
  async update(
    id: string,
    body: UpdateFuelDto,
    principal: Principal,
    request?: AuditRequest,
  ): Promise<ReferenceChange<Fuel>> {
    const changes = definedChanges(body);
    const fields = Object.keys(changes);
    if (fields.length === 0) {
      return { value: await this.get(id), republished: 0 };
    }
    const change = await withUniqueCode(
      'fuel',
      FUEL_CODE_CONSTRAINT,
      changes.code,
      () =>
        updateReference({
          pool: this.pool,
          resource: 'fuel',
          id,
          snapshots: this.snapshots,
          notifier: this.notifier,
          embeddedBy: changesEmbedded(changes, FUEL_EMBEDDED)
            ? { fuelId: id }
            : null,
          update: (db) => this.repository.update(db, id, changes),
        }),
    );
    await this.audit.record(
      {
        action: 'fuel.update',
        targetType: 'fuel',
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
      resource: 'fuel',
      id,
      users: (db) => this.aggregates.countVesselsUsing(db, { fuelId: id }),
      remove: (db) => this.repository.delete(db, id),
    });
    await this.audit.record(
      {
        action: 'fuel.delete',
        targetType: 'fuel',
        targetId: id,
        meta: { code: deleted.code },
      },
      principal,
      request,
    );
  }
}
