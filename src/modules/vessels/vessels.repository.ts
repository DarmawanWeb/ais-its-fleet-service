import type { EngineKind } from '@darmawanweb/ais-its-contracts/domain';
import { Injectable } from '@nestjs/common';
import {
  and,
  asc,
  between,
  count,
  eq,
  ilike,
  inArray,
  like,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';

import type { FleetDb } from '../../db/database.js';
import {
  engines,
  ports,
  vesselDimensions,
  vesselEngines,
  vesselPorts,
  vessels,
  vesselTypes,
} from '../../db/schema.js';
import type { EngineAssignment } from '../../domain/engine-assignment.js';
import type { VesselDimensions, VesselRecord } from '../../domain/vessel.js';
import { escapeLikePattern } from '../common/validation.js';
import type { PortSummary, VesselTypeSummary } from './vessel-view.js';

/** Columns of a new vessel (timestamps by the database). */
export type NewVessel = Omit<VesselRecord, 'createdAt' | 'updatedAt'>;

/** Changeable columns of a vessel. */
export type VesselChanges = Partial<Omit<NewVessel, 'id' | 'legacyId'>>;

/** Filters of `GET /vessels`. */
export interface VesselFilter {
  readonly search?: string | undefined;
  readonly typeCode?: string | undefined;
  readonly orgId?: string | undefined;
  readonly status?: VesselRecord['status'] | undefined;
}

/** A row of the vessel list: the vessel and the identity of its type. */
export interface VesselListRow {
  readonly vessel: VesselRecord;
  readonly type: VesselTypeSummary;
}

const TYPE_SUMMARY = {
  id: vesselTypes.id,
  code: vesselTypes.code,
  name: vesselTypes.name,
  icon: vesselTypes.icon,
};

/**
 * `search` of the vessel list: a case-insensitive substring of the name; a
 * query of 1–9 digits (optionally `IMO…`) also matches IMO numbers and MMSIs
 * starting with it (the MMSI as an index range).
 */
function searchCondition(search: string): SQL | undefined {
  const name = ilike(vessels.name, `%${escapeLikePattern(search)}%`);
  const digits = /^(?:imo\s*)?(\d{1,9})$/i.exec(search)?.[1];
  if (digits === undefined) return name;
  const scale = 10 ** (9 - digits.length);
  const low = Number(digits) * scale;
  return or(
    name,
    like(vessels.imo, `${digits}%`),
    digits.startsWith('0')
      ? undefined
      : between(vessels.mmsi, low, low + scale - 1),
  );
}

/** Drizzle access to `vessels` and its 1:1 / 1:n tables. */
@Injectable()
export class VesselsRepository {
  async list(
    db: FleetDb,
    filter: VesselFilter,
    page: { readonly offset: number; readonly limit: number },
  ): Promise<{ rows: VesselListRow[]; total: number }> {
    const where = and(
      filter.search === undefined ? undefined : searchCondition(filter.search),
      filter.typeCode === undefined
        ? undefined
        : eq(vesselTypes.code, filter.typeCode),
      filter.orgId === undefined ? undefined : eq(vessels.orgId, filter.orgId),
      filter.status === undefined
        ? undefined
        : eq(vessels.status, filter.status),
    );
    const [rows, totals] = await Promise.all([
      db
        .select({ vessel: vessels, type: TYPE_SUMMARY })
        .from(vessels)
        .innerJoin(vesselTypes, eq(vesselTypes.id, vessels.typeId))
        .where(where)
        .orderBy(asc(sql`lower(${vessels.name})`), asc(vessels.id))
        .limit(page.limit)
        .offset(page.offset),
      db
        .select({ total: count() })
        .from(vessels)
        .innerJoin(vesselTypes, eq(vesselTypes.id, vessels.typeId))
        .where(where),
    ]);
    return { rows, total: totals[0]?.total ?? 0 };
  }

  /** A vessel and the identity of its type, by id or MMSI. */
  async findRow(
    db: FleetDb,
    key: { readonly id: string } | { readonly mmsi: number },
  ): Promise<VesselListRow | undefined> {
    const [row] = await db
      .select({ vessel: vessels, type: TYPE_SUMMARY })
      .from(vessels)
      .innerJoin(vesselTypes, eq(vesselTypes.id, vessels.typeId))
      .where('id' in key ? eq(vessels.id, key.id) : eq(vessels.mmsi, key.mmsi))
      .limit(1);
    return row;
  }

  /** Locks the vessel row for this transaction (`FOR UPDATE`). */
  async lock(db: FleetDb, id: string): Promise<VesselRecord | undefined> {
    const [row] = await db
      .select()
      .from(vessels)
      .where(eq(vessels.id, id))
      .for('update');
    return row;
  }

  /** Share-locks the vessel row (republish without changes). */
  async lockShared(db: FleetDb, id: string): Promise<VesselRecord | undefined> {
    const [row] = await db
      .select()
      .from(vessels)
      .where(eq(vessels.id, id))
      .for('share');
    return row;
  }

  async insert(db: FleetDb, vessel: NewVessel): Promise<VesselRecord> {
    const [row] = await db.insert(vessels).values(vessel).returning();
    if (row === undefined)
      throw new Error('INSERT … RETURNING returned no row');
    return row;
  }

  /**
   * Applies `changes` and advances `updated_at` with `clock_timestamp()`, so
   * every snapshot of the vessel carries a strictly newer `updatedAt`.
   */
  async update(
    db: FleetDb,
    id: string,
    changes: VesselChanges,
  ): Promise<VesselRecord | undefined> {
    const [row] = await db
      .update(vessels)
      .set({ ...changes, updatedAt: sql`clock_timestamp()` })
      .where(eq(vessels.id, id))
      .returning();
    return row;
  }

  async delete(db: FleetDb, id: string): Promise<VesselRecord | undefined> {
    const [row] = await db
      .delete(vessels)
      .where(eq(vessels.id, id))
      .returning();
    return row;
  }

  async upsertDimensions(
    db: FleetDb,
    vesselId: string,
    dimensions: VesselDimensions,
  ): Promise<void> {
    await db
      .insert(vesselDimensions)
      .values({ vesselId, ...dimensions })
      .onConflictDoUpdate({
        target: vesselDimensions.vesselId,
        set: dimensions,
      });
  }

  /** Replaces the fitted engines (positions follow the request order). */
  async replaceEngines(
    db: FleetDb,
    vesselId: string,
    assignments: readonly EngineAssignment[],
  ): Promise<void> {
    await db.delete(vesselEngines).where(eq(vesselEngines.vesselId, vesselId));
    if (assignments.length === 0) return;
    await db.insert(vesselEngines).values(
      assignments.map((assignment, position) => ({
        vesselId,
        engineId: assignment.engineId,
        role: assignment.role,
        quantity: assignment.quantity,
        position,
      })),
    );
  }

  /** Replaces the ports of call (positions follow the request order). */
  async replacePorts(
    db: FleetDb,
    vesselId: string,
    portIds: readonly string[],
  ): Promise<void> {
    await db.delete(vesselPorts).where(eq(vesselPorts.vesselId, vesselId));
    if (portIds.length === 0) return;
    await db
      .insert(vesselPorts)
      .values(
        portIds.map((portId, position) => ({ vesselId, portId, position })),
      );
  }

  /** Catalogue kind of each existing engine among `ids` (share-locked). */
  async engineKinds(
    db: FleetDb,
    ids: readonly string[],
  ): Promise<Map<string, EngineKind>> {
    if (ids.length === 0) return new Map();
    const rows = await db
      .select({ id: engines.id, kind: engines.kind })
      .from(engines)
      .where(inArray(engines.id, [...ids]))
      .for('share');
    return new Map(rows.map((row) => [row.id, row.kind]));
  }

  /** The existing ports among `ids`, by id (share-locked). */
  async portSummaries(
    db: FleetDb,
    ids: readonly string[],
    options: { readonly lock?: boolean } = {},
  ): Promise<Map<string, PortSummary>> {
    if (ids.length === 0) return new Map();
    const query = db
      .select({ id: ports.id, code: ports.code, name: ports.name })
      .from(ports)
      .where(inArray(ports.id, [...ids]));
    const rows = options.lock === true ? await query.for('share') : await query;
    return new Map(rows.map((row) => [row.id, row]));
  }
}
