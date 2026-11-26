import type { Paginated } from '@darmawanweb/ais-its-contracts/api';
import { newId } from '@darmawanweb/ais-its-contracts/domain';
import { ValidationFailedError } from '@darmawanweb/ais-its-nest';
import {
  type AuditRequest,
  AuditService,
} from '@darmawanweb/ais-its-nest/audit';
import type { Principal } from '@darmawanweb/ais-its-nest/auth';
import { InjectDb, InjectPool, type Pool } from '@darmawanweb/ais-its-nest/db';
import { pageOffsetOf, paginate } from '@darmawanweb/ais-its-nest/http';
import { Injectable } from '@nestjs/common';

import { type FleetDb, inTransaction } from '../../db/database.js';
import {
  type EngineAssignment,
  engineAssignmentErrors,
} from '../../domain/engine-assignment.js';
import { ownerOfNewVessel, vesselViewFor } from '../../domain/vessel-access.js';
import {
  type SortOrder,
  technicalSortScope,
  type VesselSortKey,
} from '../../domain/vessel-list.js';
import type { VesselDimensions, VesselRecord } from '../../domain/vessel.js';
import {
  ForeignOrganizationError,
  OrganizationRequiredError,
  PlatformAdminRequiredError,
  VesselNotFoundError,
} from '../../errors.js';
import { definedChanges } from '../common/reference-writes.js';
import { OutboxNotifier } from '../snapshots/outbox-notifier.js';
import { SnapshotOutbox } from '../snapshots/snapshot-outbox.js';
import { VesselAggregatesRepository } from '../snapshots/vessel-aggregates.repository.js';
import { PhotoStorage } from '../storage/photo-storage.js';
import type {
  CreateVesselDto,
  UpdateVesselDto,
  VesselDimensionsDto,
} from './dto/vessel-input.dto.js';
import type { PortSummary, VesselView } from './vessel-view.js';
import { lockOwnedVessel, mappingVesselErrors } from './vessel-writes.js';
import {
  type VesselFilter,
  type VesselListRow,
  VesselsRepository,
} from './vessels.repository.js';

/** Query of {@link VesselsService.list} (`GET /vessels`). */
export interface VesselListQuery extends Omit<VesselFilter, 'mmsi'> {
  readonly page: number;
  readonly pageSize: number;
  /** MMSIs as validated nine-digit strings. */
  readonly mmsi?: readonly string[] | undefined;
  readonly sort?: VesselSortKey | undefined;
  readonly order?: SortOrder | undefined;
}

/** A vessel key of the read endpoints. */
export type VesselKey = { readonly id: string } | { readonly mmsi: number };

function dimensionsOf(input: VesselDimensionsDto): VesselDimensions {
  return {
    capacity: input.capacity,
    dwt: input.dwt ?? null,
    gt: input.gt ?? null,
    cb: input.cb,
    lwl: input.lwl,
    b: input.b,
    t: input.t,
    cwp: input.cwp,
    loa: input.loa,
    lpp: input.lpp,
    cp: input.cp,
    cm: input.cm,
    cbnsp: input.cbnsp,
    bulbousBow: input.bulbousBow,
    cstern: input.cstern,
    c1: input.c1,
    c2: input.c2,
    c3: input.c3,
    c5: input.c5,
    vs: input.vs,
  };
}

/** Prefixes the field paths of validation errors (`engines.0.role`). */
function prefixed(
  errors: ValidationFailedError,
  prefix: string,
): ValidationFailedError {
  return new ValidationFailedError(
    (errors.errors ?? []).map((error) => ({
      ...error,
      field: `${prefix}${error.field}`,
    })),
  );
}

/**
 * Use cases of vessels (spec §13.3, tenancy §8.5): identity for everybody,
 * technical data and writes for the owning organization (and platform
 * administrators). Every write locks the vessel row and enqueues its new
 * snapshot in the same transaction; audit records follow the commit.
 */
@Injectable()
export class VesselsService {
  constructor(
    @InjectPool() private readonly pool: Pool,
    @InjectDb() private readonly db: FleetDb,
    private readonly repository: VesselsRepository,
    private readonly aggregates: VesselAggregatesRepository,
    private readonly snapshots: SnapshotOutbox,
    private readonly notifier: OutboxNotifier,
    private readonly storage: PhotoStorage,
    private readonly audit: AuditService,
  ) {}

  /**
   * One page of vessels, each in the view the principal may see, optionally
   * only the given MMSIs (batch identity lookup) and sorted; technical sort
   * keys order only the vessels the principal may see in detail.
   */
  async list(
    query: VesselListQuery,
    principal: Principal,
  ): Promise<Paginated<VesselView>> {
    if (
      query.orgId !== undefined &&
      !principal.isPlatformAdmin &&
      query.orgId !== principal.orgId
    ) {
      // Identity is shared, ownership is not: filtering by another tenant would reveal its fleet.
      throw new ForeignOrganizationError(
        'Only platform administrators may filter by another organization',
      );
    }
    const { rows, total } = await this.repository.list(
      this.db,
      {
        search: query.search,
        typeCode: query.typeCode,
        orgId: query.orgId,
        status: query.status,
        mmsi:
          query.mmsi === undefined
            ? undefined
            : [...new Set(query.mmsi.map(Number))],
      },
      { offset: pageOffsetOf(query), limit: query.pageSize },
      {
        key: query.sort ?? 'name',
        order: query.order ?? 'asc',
        technical: technicalSortScope(principal),
      },
    );
    return paginate(await this.views(rows, principal), query, total);
  }

  /** A vessel by id or MMSI in the principal's view; `404 VESSEL_NOT_FOUND` when absent. */
  async get(key: VesselKey, principal: Principal): Promise<VesselView> {
    const row = await this.repository.findRow(this.db, key);
    if (row === undefined) throw new VesselNotFoundError(key);
    const [view] = await this.views([row], principal);
    if (view === undefined) throw new VesselNotFoundError(key);
    return view;
  }

  /** Registers a vessel in the principal's active organization (any for platform admins). */
  async create(
    body: CreateVesselDto,
    principal: Principal,
    request?: AuditRequest,
  ): Promise<VesselView> {
    const owner = ownerOfNewVessel(principal, body.orgId);
    if (!owner.allowed) {
      throw owner.reason === 'organization_required'
        ? new OrganizationRequiredError()
        : new ForeignOrganizationError(
            'Vessels can only be created in your active organization',
          );
    }
    if (body.legacyId !== undefined && !principal.isPlatformAdmin) {
      throw new PlatformAdminRequiredError('set legacyId');
    }
    const id = newId();
    await mappingVesselErrors(body, () =>
      inTransaction(this.pool, async (transaction) => {
        await this.repository.insert(transaction.db, {
          id,
          orgId: owner.orgId,
          mmsi: body.mmsi,
          imo: body.imo ?? null,
          name: body.name,
          flag: body.flag ?? null,
          builtYear: body.builtYear ?? null,
          status: body.status ?? 'active',
          annualVoyagePercentage: body.annualVoyagePercentage,
          photoKey: null,
          typeId: body.typeId,
          fuelId: body.fuelId,
          firstFuelFormulaId: body.firstFuelFormulaId ?? null,
          legacyId: body.legacyId ?? null,
        });
        await this.repository.upsertDimensions(
          transaction.db,
          id,
          dimensionsOf(body.dimensions),
        );
        await this.fitEngines(
          transaction.db,
          id,
          body.engines ?? [],
          'engines.',
        );
        await this.callAt(transaction.db, id, body.portIds ?? [], 'portIds.');
        await this.snapshots.enqueueUpserts(transaction, [id]);
      }),
    );
    this.notifier.committed('vessel_change', 1);
    await this.record(
      'vessel.create',
      id,
      owner.orgId,
      { mmsi: body.mmsi },
      principal,
      request,
    );
    return this.get({ id }, principal);
  }

  /** Changes identity, status, voyage share or references of an owned vessel. */
  async update(
    id: string,
    body: UpdateVesselDto,
    principal: Principal,
    request?: AuditRequest,
  ): Promise<VesselView> {
    if (body.orgId !== undefined && !principal.isPlatformAdmin) {
      throw new PlatformAdminRequiredError(
        'move vessels between organizations',
      );
    }
    const changes = definedChanges(body);
    const fields = Object.keys(changes);
    if (fields.length === 0) return this.get({ id }, principal);
    const vessel = await this.change(id, principal, body, (db) =>
      this.repository.update(db, id, changes),
    );
    await this.record(
      'vessel.update',
      id,
      vessel.orgId,
      { fields },
      principal,
      request,
    );
    return this.get({ id }, principal);
  }

  /** Replaces the dimensions and hull coefficients. */
  async replaceDimensions(
    id: string,
    body: VesselDimensionsDto,
    principal: Principal,
    request?: AuditRequest,
  ): Promise<VesselView> {
    const vessel = await this.change(id, principal, {}, async (db) => {
      await this.repository.upsertDimensions(db, id, dimensionsOf(body));
      return this.repository.update(db, id, {});
    });
    await this.record(
      'vessel.dimensions.update',
      id,
      vessel.orgId,
      {},
      principal,
      request,
    );
    return this.get({ id }, principal);
  }

  /** Replaces the fitted engines (`[{ engineId, role, quantity }]`). */
  async replaceEngines(
    id: string,
    assignments: readonly EngineAssignment[],
    principal: Principal,
    request?: AuditRequest,
  ): Promise<VesselView> {
    const vessel = await this.change(id, principal, {}, async (db) => {
      await this.fitEngines(db, id, assignments, '');
      return this.repository.update(db, id, {});
    });
    await this.record(
      'vessel.engines.update',
      id,
      vessel.orgId,
      { engines: assignments.length },
      principal,
      request,
    );
    return this.get({ id }, principal);
  }

  /** Replaces the ports of call (`[portId]`, in order). */
  async replacePorts(
    id: string,
    portIds: readonly string[],
    principal: Principal,
    request?: AuditRequest,
  ): Promise<VesselView> {
    const vessel = await this.change(id, principal, {}, async (db) => {
      await this.callAt(db, id, portIds, '');
      return this.repository.update(db, id, {});
    });
    await this.record(
      'vessel.ports.update',
      id,
      vessel.orgId,
      { ports: portIds.length },
      principal,
      request,
    );
    return this.get({ id }, principal);
  }

  /** Deletes an owned vessel; consumers receive the tombstone `fleet.vessel.deleted.v1`. */
  async remove(
    id: string,
    principal: Principal,
    request?: AuditRequest,
  ): Promise<void> {
    const deleted = await inTransaction(this.pool, async (transaction) => {
      await lockOwnedVessel(this.repository, transaction.db, id, principal);
      const vessel = await this.repository.delete(transaction.db, id);
      if (vessel === undefined) throw new VesselNotFoundError({ id });
      await this.snapshots.enqueueDeleted(transaction, vessel);
      return vessel;
    });
    this.notifier.committed('vessel_delete', 1);
    if (deleted.photoKey !== null)
      await this.storage.deleteQuietly(deleted.photoKey);
    await this.record(
      'vessel.delete',
      id,
      deleted.orgId,
      { mmsi: deleted.mmsi },
      principal,
      request,
    );
  }

  /**
   * Re-enqueues the current snapshot of a vessel. The route is reserved to
   * platform administrators (`@RequirePlatformAdmin()`).
   */
  async republish(
    id: string,
    principal: Principal,
    request?: AuditRequest,
  ): Promise<number> {
    const vessel = await inTransaction(this.pool, async (transaction) => {
      const locked = await this.repository.lockShared(transaction.db, id);
      if (locked === undefined) throw new VesselNotFoundError({ id });
      await this.snapshots.enqueueUpserts(transaction, [id]);
      return locked;
    });
    this.notifier.committed('republish', 1);
    await this.record(
      'vessel.republish',
      id,
      vessel.orgId,
      {},
      principal,
      request,
    );
    return 1;
  }

  /**
   * The views of list rows: detail (aggregate + ports) for owned vessels,
   * summary for the others, each with its presigned photo URL.
   */
  async views(
    rows: readonly VesselListRow[],
    principal: Principal,
  ): Promise<VesselView[]> {
    const owned = rows
      .filter((row) => vesselViewFor(principal, row.vessel) === 'detail')
      .map((row) => row.vessel.id);
    const aggregates = await this.aggregates.load(this.db, owned);
    const portIds = [
      ...new Set(
        [...aggregates.values()].flatMap((aggregate) => aggregate.portIds),
      ),
    ];
    const ports = await this.repository.portSummaries(this.db, portIds);
    return Promise.all(
      rows.map(async (row): Promise<VesselView> => {
        const identity = {
          vessel: row.vessel,
          type: row.type,
          photoUrl: await this.photoUrl(row.vessel),
        };
        const aggregate = aggregates.get(row.vessel.id);
        if (aggregate === undefined) return { view: 'summary', identity };
        return {
          view: 'detail',
          identity,
          aggregate,
          ports: aggregate.portIds
            .map((portId) => ports.get(portId))
            .filter((port): port is PortSummary => port !== undefined),
        };
      }),
    );
  }

  /**
   * One owned-vessel write: lock (404/403), `apply` (which advances
   * `updated_at`), enqueue the snapshot — in one transaction.
   */
  private async change(
    id: string,
    principal: Principal,
    input: {
      readonly mmsi?: number | undefined;
      readonly imo?: string | null | undefined;
    },
    apply: (db: FleetDb) => Promise<VesselRecord | undefined>,
  ): Promise<VesselRecord> {
    const vessel = await mappingVesselErrors(input, () =>
      inTransaction(this.pool, async (transaction) => {
        await lockOwnedVessel(this.repository, transaction.db, id, principal);
        const changed = await apply(transaction.db);
        if (changed === undefined) throw new VesselNotFoundError({ id });
        await this.snapshots.enqueueUpserts(transaction, [id]);
        return changed;
      }),
    );
    this.notifier.committed('vessel_change', 1);
    return vessel;
  }

  /** Validates engines against the catalogue (share-locked) and replaces them. */
  private async fitEngines(
    db: FleetDb,
    vesselId: string,
    assignments: readonly EngineAssignment[],
    fieldPrefix: string,
  ): Promise<void> {
    const kinds = await this.repository.engineKinds(
      db,
      assignments.map((assignment) => assignment.engineId),
    );
    const errors = engineAssignmentErrors(assignments, kinds);
    if (errors.length > 0) {
      throw prefixed(new ValidationFailedError(errors), fieldPrefix);
    }
    await this.repository.replaceEngines(db, vesselId, assignments);
  }

  /** Validates the ports (share-locked; ids are unique by DTO validation) and replaces the ports of call. */
  private async callAt(
    db: FleetDb,
    vesselId: string,
    portIds: readonly string[],
    fieldPrefix: string,
  ): Promise<void> {
    const known = await this.repository.portSummaries(db, portIds, {
      lock: true,
    });
    const errors = portIds.flatMap((portId, index) =>
      known.has(portId)
        ? []
        : [
            {
              field: `${fieldPrefix}${index}`,
              message: `No port with id ${portId}`,
              code: 'notFound',
            },
          ],
    );
    if (errors.length > 0) throw new ValidationFailedError(errors);
    await this.repository.replacePorts(db, vesselId, portIds);
  }

  private async photoUrl(vessel: VesselRecord): Promise<string | null> {
    return vessel.photoKey === null
      ? null
      : this.storage.presignedUrl(vessel.photoKey);
  }

  private async record(
    action: string,
    vesselId: string,
    orgId: string | null,
    meta: Readonly<Record<string, unknown>>,
    principal: Principal,
    request: AuditRequest | undefined,
  ): Promise<void> {
    await this.audit.record(
      { action, targetType: 'vessel', targetId: vesselId, orgId, meta },
      principal,
      request,
    );
  }
}
