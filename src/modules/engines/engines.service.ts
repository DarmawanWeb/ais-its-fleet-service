import type { Paginated } from '@darmawanweb/ais-its-contracts/api';
import { type EngineKind, newId } from '@darmawanweb/ais-its-contracts/domain';
import {
  type AuditRequest,
  AuditService,
} from '@darmawanweb/ais-its-nest/audit';
import type { Principal } from '@darmawanweb/ais-its-nest/auth';
import { InjectDb, InjectPool, type Pool } from '@darmawanweb/ais-its-nest/db';
import { pageOffsetOf, paginate } from '@darmawanweb/ais-its-nest/http';
import { Injectable } from '@nestjs/common';

import type { FleetDb } from '../../db/database.js';
import type { Engine } from '../../domain/vessel.js';
import { ReferenceInUseError, ReferenceNotFoundError } from '../../errors.js';
import {
  definedChanges,
  deleteUnusedReference,
  type ReferenceChange,
  updateReference,
  withUniqueCode,
} from '../common/reference-writes.js';
import { OutboxNotifier } from '../snapshots/outbox-notifier.js';
import { SnapshotOutbox } from '../snapshots/snapshot-outbox.js';
import { VesselAggregatesRepository } from '../snapshots/vessel-aggregates.repository.js';
import type { CreateEngineDto, UpdateEngineDto } from './dto/engine.dto.js';
import {
  ENGINE_CODE_CONSTRAINT,
  type EngineChanges,
  EnginesRepository,
} from './engines.repository.js';

/**
 * The engine catalogue (reference data, legacy `MainEngine` and
 * `AuxiliaryEngine`): a change republishes the snapshot of every vessel the
 * engine is fitted to; the kind of an engine in use cannot change (vessels
 * fit it in the matching role) and an engine in use cannot be deleted.
 */
@Injectable()
export class EnginesService {
  constructor(
    @InjectPool() private readonly pool: Pool,
    @InjectDb() private readonly db: FleetDb,
    private readonly repository: EnginesRepository,
    private readonly aggregates: VesselAggregatesRepository,
    private readonly snapshots: SnapshotOutbox,
    private readonly notifier: OutboxNotifier,
    private readonly audit: AuditService,
  ) {}

  async list(query: {
    readonly page: number;
    readonly pageSize: number;
    readonly search?: string | undefined;
    readonly kind?: EngineKind | undefined;
  }): Promise<Paginated<Engine>> {
    const { rows, total } = await this.repository.list(
      this.db,
      { search: query.search, kind: query.kind },
      { offset: pageOffsetOf(query), limit: query.pageSize },
    );
    return paginate(rows, query, total);
  }

  async get(id: string): Promise<Engine> {
    const engine = await this.repository.findById(this.db, id);
    if (engine === undefined) throw new ReferenceNotFoundError('engine', id);
    return engine;
  }

  async create(
    body: CreateEngineDto,
    principal: Principal,
    request?: AuditRequest,
  ): Promise<Engine> {
    const engine = await withUniqueCode(
      'engine',
      ENGINE_CODE_CONSTRAINT,
      body.code,
      () =>
        this.repository.insert(this.db, {
          id: newId(),
          code: body.code ?? null,
          kind: body.kind,
          name: body.name,
          rpm: body.rpm,
          powerKw: body.powerKw,
          sfoc: body.sfoc,
          source: body.source ?? null,
        }),
    );
    await this.audit.record(
      {
        action: 'engine.create',
        targetType: 'engine',
        targetId: engine.id,
        meta: { kind: engine.kind, name: engine.name },
      },
      principal,
      request,
    );
    return engine;
  }

  /** Applies the changes and republishes every vessel the engine is fitted to. */
  async update(
    id: string,
    body: UpdateEngineDto,
    principal: Principal,
    request?: AuditRequest,
  ): Promise<ReferenceChange<Engine>> {
    const changes = definedChanges(body);
    const fields = Object.keys(changes);
    if (fields.length === 0) {
      return { value: await this.get(id), republished: 0 };
    }
    const change = await withUniqueCode(
      'engine',
      ENGINE_CODE_CONSTRAINT,
      changes.code,
      () =>
        updateReference({
          pool: this.pool,
          resource: 'engine',
          id,
          snapshots: this.snapshots,
          notifier: this.notifier,
          embeddedBy: { engineId: id },
          update: (db) => this.updateChecked(db, id, changes),
        }),
    );
    await this.audit.record(
      {
        action: 'engine.update',
        targetType: 'engine',
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
      resource: 'engine',
      id,
      users: (db) => this.aggregates.countVesselsUsing(db, { engineId: id }),
      remove: (db) => this.repository.delete(db, id),
    });
    await this.audit.record(
      {
        action: 'engine.delete',
        targetType: 'engine',
        targetId: id,
        meta: { kind: deleted.kind, name: deleted.name },
      },
      principal,
      request,
    );
  }

  /**
   * Refuses a kind change of an engine in use, then updates. The engine row
   * is locked before the vessels are counted: a concurrent fit of the engine
   * (`VesselsService.fitEngines`, which checks the role against the kind
   * under a share lock) is then either counted here or sees the new kind —
   * never a fitted role that differs from the catalogue kind.
   */
  private async updateChecked(
    db: FleetDb,
    id: string,
    changes: EngineChanges,
  ): Promise<Engine | undefined> {
    if (changes.kind !== undefined) {
      const current = await this.repository.lockById(db, id);
      if (current === undefined) return undefined;
      if (current.kind !== changes.kind) {
        const users = await this.aggregates.countVesselsUsing(db, {
          engineId: id,
        });
        if (users > 0) throw new ReferenceInUseError('engine', id, users);
      }
    }
    return this.repository.update(db, id, changes);
  }
}
