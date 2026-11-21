import type { Paginated } from '@darmawanweb/ais-its-contracts/api';
import type { BBox } from '@darmawanweb/ais-its-contracts/domain';
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
import { ReferenceNotFoundError } from '../../errors.js';
import {
  deleteUnusedReference,
  updateReference,
  withUniqueCode,
} from '../common/reference-writes.js';
import { OutboxNotifier } from '../snapshots/outbox-notifier.js';
import { SnapshotOutbox } from '../snapshots/snapshot-outbox.js';
import type { CreatePortDto, UpdatePortDto } from './dto/port.dto.js';
import type { Port, PortChanges } from './port.js';
import { PORT_CODE_CONSTRAINT, PortsRepository } from './ports.repository.js';

/** The defined members of a PATCH body as column changes (`null` clears). */
function changesOf(body: UpdatePortDto): PortChanges {
  return {
    ...(body.name === undefined ? {} : { name: body.name }),
    ...(body.code === undefined ? {} : { code: body.code }),
    ...(body.administrativeLocation === undefined
      ? {}
      : { administrativeLocation: body.administrativeLocation }),
    ...(body.location === undefined
      ? {}
      : {
          lon: body.location.coordinates[0],
          lat: body.location.coordinates[1],
        }),
    ...(body.radiusM === undefined ? {} : { radiusM: body.radiusM }),
    ...(body.source === undefined ? {} : { source: body.source }),
  };
}

/**
 * Ports of call (reference data, legacy `Port`) with GeoJSON positions.
 * Snapshots carry only port ids, so a port change republishes nothing; a
 * port vessels call at cannot be deleted.
 */
@Injectable()
export class PortsService {
  constructor(
    @InjectPool() private readonly pool: Pool,
    @InjectDb() private readonly db: FleetDb,
    private readonly repository: PortsRepository,
    private readonly snapshots: SnapshotOutbox,
    private readonly notifier: OutboxNotifier,
    private readonly audit: AuditService,
  ) {}

  async list(query: {
    readonly page: number;
    readonly pageSize: number;
    readonly search?: string | undefined;
    readonly bbox?: BBox | undefined;
  }): Promise<Paginated<Port>> {
    const { rows, total } = await this.repository.list(
      this.db,
      { search: query.search, bbox: query.bbox },
      { offset: pageOffsetOf(query), limit: query.pageSize },
    );
    return paginate(rows, query, total);
  }

  async get(id: string): Promise<Port> {
    const port = await this.repository.findById(this.db, id);
    if (port === undefined) throw new ReferenceNotFoundError('port', id);
    return port;
  }

  async create(
    body: CreatePortDto,
    principal: Principal,
    request?: AuditRequest,
  ): Promise<Port> {
    const [lon, lat] = body.location.coordinates;
    const port = await withUniqueCode(
      'port',
      PORT_CODE_CONSTRAINT,
      body.code,
      () =>
        this.repository.insert(this.db, {
          id: newId(),
          name: body.name,
          code: body.code,
          administrativeLocation: body.administrativeLocation ?? null,
          lon,
          lat,
          radiusM: body.radiusM ?? null,
          source: body.source ?? null,
        }),
    );
    await this.audit.record(
      {
        action: 'port.create',
        targetType: 'port',
        targetId: port.id,
        meta: { code: port.code },
      },
      principal,
      request,
    );
    return port;
  }

  async update(
    id: string,
    body: UpdatePortDto,
    principal: Principal,
    request?: AuditRequest,
  ): Promise<Port> {
    const changes = changesOf(body);
    const fields = Object.keys(changes);
    if (fields.length === 0) return this.get(id);
    const { value } = await withUniqueCode(
      'port',
      PORT_CODE_CONSTRAINT,
      changes.code,
      () =>
        updateReference({
          pool: this.pool,
          resource: 'port',
          id,
          snapshots: this.snapshots,
          notifier: this.notifier,
          embeddedBy: null,
          update: (db) => this.repository.update(db, id, changes),
        }),
    );
    await this.audit.record(
      {
        action: 'port.update',
        targetType: 'port',
        targetId: id,
        meta: { fields },
      },
      principal,
      request,
    );
    return value;
  }

  async remove(
    id: string,
    principal: Principal,
    request?: AuditRequest,
  ): Promise<void> {
    const deleted = await deleteUnusedReference({
      pool: this.pool,
      resource: 'port',
      id,
      users: (db) => this.repository.countVessels(db, id),
      remove: (db) => this.repository.delete(db, id),
    });
    await this.audit.record(
      {
        action: 'port.delete',
        targetType: 'port',
        targetId: id,
        meta: { code: deleted.code },
      },
      principal,
      request,
    );
  }
}
