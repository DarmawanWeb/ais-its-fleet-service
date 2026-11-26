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
import type { FuelFormula } from '../../domain/vessel.js';
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
import type {
  CreateFuelFormulaDto,
  UpdateFuelFormulaDto,
} from './dto/fuel-formula.dto.js';
import {
  FUEL_FORMULA_CODE_CONSTRAINT,
  FuelFormulasRepository,
} from './fuel-formulas.repository.js';

/** The members vessel snapshots embed: only their changes republish vessels. */
const FUEL_FORMULA_EMBEDDED: readonly (keyof UpdateFuelFormulaDto)[] = [
  'mainEngineFormula',
  'auxiliaryEngineFormula',
];

/**
 * First fuel formulas (reference data, legacy `FirstFuelFormula`): both
 * strings are checked against the safe grammar on write (400
 * VALIDATION_FAILED otherwise); a change republishes the snapshot of every
 * vessel using the formula, a formula in use cannot be deleted.
 */
@Injectable()
export class FuelFormulasService {
  constructor(
    @InjectPool() private readonly pool: Pool,
    @InjectDb() private readonly db: FleetDb,
    private readonly repository: FuelFormulasRepository,
    private readonly aggregates: VesselAggregatesRepository,
    private readonly snapshots: SnapshotOutbox,
    private readonly notifier: OutboxNotifier,
    private readonly audit: AuditService,
  ) {}

  async list(query: {
    readonly page: number;
    readonly pageSize: number;
    readonly search?: string | undefined;
  }): Promise<Paginated<FuelFormula>> {
    const { rows, total } = await this.repository.list(this.db, query.search, {
      offset: pageOffsetOf(query),
      limit: query.pageSize,
    });
    return paginate(rows, query, total);
  }

  async get(id: string): Promise<FuelFormula> {
    const formula = await this.repository.findById(this.db, id);
    if (formula === undefined)
      throw new ReferenceNotFoundError('fuel_formula', id);
    return formula;
  }

  async create(
    body: CreateFuelFormulaDto,
    principal: Principal,
    request?: AuditRequest,
  ): Promise<FuelFormula> {
    const formula = await withUniqueCode(
      'fuel_formula',
      FUEL_FORMULA_CODE_CONSTRAINT,
      body.code,
      () =>
        this.repository.insert(this.db, {
          id: newId(),
          code: body.code ?? null,
          name: body.name,
          mainEngineFormula: body.mainEngineFormula,
          auxiliaryEngineFormula: body.auxiliaryEngineFormula,
          source: body.source ?? null,
        }),
    );
    await this.audit.record(
      {
        action: 'fuel_formula.create',
        targetType: 'fuel_formula',
        targetId: formula.id,
        meta: { name: formula.name },
      },
      principal,
      request,
    );
    return formula;
  }

  /** Applies the changes and republishes every vessel using the formula. */
  async update(
    id: string,
    body: UpdateFuelFormulaDto,
    principal: Principal,
    request?: AuditRequest,
  ): Promise<ReferenceChange<FuelFormula>> {
    const changes = definedChanges(body);
    const fields = Object.keys(changes);
    if (fields.length === 0) {
      return { value: await this.get(id), republished: 0 };
    }
    const change = await withUniqueCode(
      'fuel_formula',
      FUEL_FORMULA_CODE_CONSTRAINT,
      changes.code,
      () =>
        updateReference({
          pool: this.pool,
          resource: 'fuel_formula',
          id,
          snapshots: this.snapshots,
          notifier: this.notifier,
          embeddedBy: changesEmbedded(changes, FUEL_FORMULA_EMBEDDED)
            ? { firstFuelFormulaId: id }
            : null,
          update: (db) => this.repository.update(db, id, changes),
        }),
    );
    await this.audit.record(
      {
        action: 'fuel_formula.update',
        targetType: 'fuel_formula',
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
      resource: 'fuel_formula',
      id,
      users: (db) =>
        this.aggregates.countVesselsUsing(db, { firstFuelFormulaId: id }),
      remove: (db) => this.repository.delete(db, id),
    });
    await this.audit.record(
      {
        action: 'fuel_formula.delete',
        targetType: 'fuel_formula',
        targetId: id,
        meta: { name: deleted.name },
      },
      principal,
      request,
    );
  }
}
