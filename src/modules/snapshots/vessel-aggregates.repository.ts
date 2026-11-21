import { Injectable } from '@nestjs/common';
import { asc, eq, inArray, type SQL, sql } from 'drizzle-orm';

import type { FleetDb } from '../../db/database.js';
import {
  engines,
  fuelFormulas,
  fuels,
  vesselDimensions,
  vesselEngines,
  vesselPorts,
  vessels,
  vesselTypes,
} from '../../db/schema.js';
import type {
  Engine,
  Fuel,
  FuelFormula,
  VesselAggregate,
  VesselEngine,
  VesselType,
} from '../../domain/vessel.js';

/** Options of {@link VesselAggregatesRepository.load}. */
export interface LoadAggregatesOptions {
  /**
   * Inside a writing transaction: lock the embedded reference rows
   * (`FOR SHARE`), so a concurrent fuel/type/formula/engine change either
   * waits for this transaction or is seen by it — the snapshot never embeds
   * reference data that a committed change already replaced.
   */
  readonly lockReferences?: boolean | undefined;
}

/** Reference rows referenced by a filter of {@link VesselAggregatesRepository.lockVesselsUsing}. */
export type ReferenceFilter =
  | { readonly typeId: string }
  | { readonly fuelId: string }
  | { readonly firstFuelFormulaId: string }
  | { readonly engineId: string };

function byId<T extends { readonly id: string }>(
  rows: readonly T[],
): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

function unique(values: readonly (string | null)[]): string[] {
  return [
    ...new Set(values.filter((value): value is string => value !== null)),
  ];
}

/** The vessels that embed the reference row of `filter`. */
function usingCondition(db: FleetDb, filter: ReferenceFilter): SQL {
  if ('typeId' in filter) return eq(vessels.typeId, filter.typeId);
  if ('fuelId' in filter) return eq(vessels.fuelId, filter.fuelId);
  if ('firstFuelFormulaId' in filter)
    return eq(vessels.firstFuelFormulaId, filter.firstFuelFormulaId);
  return inArray(
    vessels.id,
    db
      .select({ id: vesselEngines.vesselId })
      .from(vesselEngines)
      .where(eq(vesselEngines.engineId, filter.engineId)),
  );
}

/**
 * Loads complete vessel aggregates (vessel, dimensions, type, fuel, formula,
 * engines, ports) in a fixed number of queries per batch — for snapshots,
 * cascades and detail views.
 */
@Injectable()
export class VesselAggregatesRepository {
  /**
   * The aggregates of `ids` that exist (a vessel without its dimensions row
   * is skipped: creation writes both in one transaction).
   */
  async load(
    db: FleetDb,
    ids: readonly string[],
    options: LoadAggregatesOptions = {},
  ): Promise<Map<string, VesselAggregate>> {
    if (ids.length === 0) return new Map();
    const lock = options.lockReferences === true;
    const rows = await db
      .select({ vessel: vessels, dimensions: vesselDimensions })
      .from(vessels)
      .innerJoin(vesselDimensions, eq(vesselDimensions.vesselId, vessels.id))
      .where(inArray(vessels.id, [...ids]));
    if (rows.length === 0) return new Map();

    const vesselIds = rows.map((row) => row.vessel.id);
    const [types, fuelRows, formulas, fitted, calls] = await Promise.all([
      this.types(db, unique(rows.map((row) => row.vessel.typeId)), lock),
      this.fuels(db, unique(rows.map((row) => row.vessel.fuelId)), lock),
      this.formulas(
        db,
        unique(rows.map((row) => row.vessel.firstFuelFormulaId)),
        lock,
      ),
      this.fittedEngines(db, vesselIds, lock),
      db
        .select()
        .from(vesselPorts)
        .where(inArray(vesselPorts.vesselId, vesselIds))
        .orderBy(asc(vesselPorts.vesselId), asc(vesselPorts.position)),
    ]);

    const result = new Map<string, VesselAggregate>();
    for (const { vessel, dimensions } of rows) {
      const type = types.get(vessel.typeId);
      const fuel = fuelRows.get(vessel.fuelId);
      // Foreign keys guarantee both; a miss would be a concurrent delete under RESTRICT.
      if (type === undefined || fuel === undefined) continue;
      const { vesselId: _vesselId, ...dimensionValues } = dimensions;
      result.set(vessel.id, {
        vessel,
        dimensions: dimensionValues,
        type,
        fuel,
        firstFuelFormula:
          vessel.firstFuelFormulaId === null
            ? null
            : (formulas.get(vessel.firstFuelFormulaId) ?? null),
        engines: fitted.get(vessel.id) ?? [],
        portIds: calls
          .filter((call) => call.vesselId === vessel.id)
          .map((call) => call.portId),
      });
    }
    return result;
  }

  /**
   * Locks (`FOR UPDATE`, in id order) the vessels that embed a reference
   * row and advances their `updated_at`, so the snapshots enqueued next
   * carry a newer `updatedAt` than any earlier one.
   *
   * @returns the ids of the affected vessels
   */
  async touchVesselsUsing(
    db: FleetDb,
    filter: ReferenceFilter,
  ): Promise<string[]> {
    const locked = await db
      .select({ id: vessels.id })
      .from(vessels)
      .where(usingCondition(db, filter))
      .orderBy(asc(vessels.id))
      .for('update');
    const ids = locked.map((row) => row.id);
    if (ids.length > 0) {
      await db
        .update(vessels)
        .set({ updatedAt: sql`clock_timestamp()` })
        .where(inArray(vessels.id, ids));
    }
    return ids;
  }

  /** Number of vessels that embed a reference row. */
  async countVesselsUsing(
    db: FleetDb,
    filter: ReferenceFilter,
  ): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(vessels)
      .where(usingCondition(db, filter));
    return row?.count ?? 0;
  }

  /**
   * One page of vessel ids in id order, share-locked for a republish (a
   * concurrent write waits, so its snapshot is enqueued after ours).
   */
  async lockPageForRepublish(
    db: FleetDb,
    afterId: string | null,
    limit: number,
  ): Promise<string[]> {
    const rows = await db
      .select({ id: vessels.id })
      .from(vessels)
      .where(afterId === null ? undefined : sql`${vessels.id} > ${afterId}`)
      .orderBy(asc(vessels.id))
      .limit(limit)
      .for('share');
    return rows.map((row) => row.id);
  }

  private async types(
    db: FleetDb,
    ids: string[],
    lock: boolean,
  ): Promise<Map<string, VesselType>> {
    if (ids.length === 0) return new Map();
    const query = db
      .select()
      .from(vesselTypes)
      .where(inArray(vesselTypes.id, ids));
    return byId(lock ? await query.for('share') : await query);
  }

  private async fuels(
    db: FleetDb,
    ids: string[],
    lock: boolean,
  ): Promise<Map<string, Fuel>> {
    if (ids.length === 0) return new Map();
    const query = db.select().from(fuels).where(inArray(fuels.id, ids));
    return byId(lock ? await query.for('share') : await query);
  }

  private async formulas(
    db: FleetDb,
    ids: string[],
    lock: boolean,
  ): Promise<Map<string, FuelFormula>> {
    if (ids.length === 0) return new Map();
    const query = db
      .select()
      .from(fuelFormulas)
      .where(inArray(fuelFormulas.id, ids));
    return byId(lock ? await query.for('share') : await query);
  }

  /** Fitted engines per vessel: the main engine first, then auxiliaries by position. */
  private async fittedEngines(
    db: FleetDb,
    vesselIds: string[],
    lock: boolean,
  ): Promise<Map<string, VesselEngine[]>> {
    const query = db
      .select({ fitted: vesselEngines, engine: engines })
      .from(vesselEngines)
      .innerJoin(engines, eq(engines.id, vesselEngines.engineId))
      .where(inArray(vesselEngines.vesselId, vesselIds))
      .orderBy(
        asc(vesselEngines.vesselId),
        sql`${vesselEngines.role} = 'main' DESC`,
        asc(vesselEngines.position),
      );
    const rows = lock ? await query.for('share', { of: engines }) : await query;
    const result = new Map<string, VesselEngine[]>();
    for (const { fitted, engine } of rows) {
      const list = result.get(fitted.vesselId) ?? [];
      list.push({
        role: fitted.role,
        quantity: fitted.quantity,
        engine: engine satisfies Engine,
      });
      result.set(fitted.vesselId, list);
    }
    return result;
  }
}
