import { newId } from '@darmawanweb/ais-its-contracts/domain';
import { pointGeography } from '@darmawanweb/ais-its-nest/db';
import { type SQL, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

import type { FleetDb, FleetTransaction } from '../db/database.js';
import {
  engines,
  fuelFormulas,
  fuels,
  ports,
  vesselTypes,
} from '../db/schema.js';
import type { SnapshotOutbox } from '../modules/snapshots/snapshot-outbox.js';
import type { ReferenceFilter } from '../modules/snapshots/vessel-aggregates.repository.js';
import { FUEL_SEEDS } from './fuels.seed.js';
import {
  ENGINE_SEEDS,
  FUEL_FORMULA_SEEDS,
  PORT_SEEDS,
} from './samples.seed.js';
import { VESSEL_TYPE_SEEDS } from './vessel-types.seed.js';

/** Outcome of one seeded table. */
export interface SeedCounts {
  readonly inserted: number;
  readonly updated: number;
  readonly unchanged: number;
}

/** Outcome of a seed run. */
export interface SeedReport {
  readonly vesselTypes: SeedCounts;
  readonly fuels: SeedCounts;
  readonly engines: SeedCounts;
  readonly fuelFormulas: SeedCounts;
  readonly ports: SeedCounts;
  /** Vessel snapshots re-enqueued because seeded rows they embed changed. */
  readonly republished: number;
  /**
   * Existing ship types, fuels and engines whose catalog reference ids were
   * set to the seeded ones (no snapshot embeds them: nothing republished).
   */
  readonly referencesLinked: number;
}

interface UpsertedRow {
  readonly id: string;
  readonly inserted: boolean;
}

/** `excluded.<column>` of an `ON CONFLICT … DO UPDATE`. */
function excluded(column: PgColumn): SQL {
  return sql`excluded.${sql.identifier(column.name)}`;
}

/**
 * The `SET` and `WHERE` of an idempotent upsert: overwrite `columns` from
 * the seed, but only when one of them differs (unchanged rows are neither
 * updated nor returned, so their `updated_at` and their vessels stay as
 * they are).
 */
function upsertBy(columns: Readonly<Record<string, PgColumn>>): {
  set: Record<string, SQL>;
  setWhere: SQL;
} {
  const entries = Object.entries(columns);
  return {
    set: {
      ...Object.fromEntries(
        entries.map(([key, column]) => [key, excluded(column)]),
      ),
      updatedAt: sql`clock_timestamp()`,
    },
    setWhere: sql`(${sql.join(
      entries.map(([, column]) => sql`${column}::text`),
      sql`, `,
    )}) IS DISTINCT FROM (${sql.join(
      entries.map(([, column]) => sql`${excluded(column)}::text`),
      sql`, `,
    )})`,
  };
}

function counts(rows: readonly UpsertedRow[], total: number): SeedCounts {
  const inserted = rows.filter((row) => row.inserted).length;
  return {
    inserted,
    updated: rows.length - inserted,
    unchanged: total - rows.length,
  };
}

const RETURNING = { inserted: sql<boolean>`(xmax = 0)` };

/** A seed row with catalog reference ids. */
interface ReferencedSeed {
  readonly code: string;
  readonly referenceIds: readonly string[];
}

/**
 * Sets the seeded `reference_ids` of existing rows of `table` that differ.
 * A separate statement from the upsert: the ids are provenance that no
 * vessel snapshot embeds, so linking them republishes nothing (new rows get
 * them with their insert).
 *
 * @returns the number of rows changed
 */
async function linkReferences(
  db: FleetDb,
  table: typeof vesselTypes | typeof fuels | typeof engines,
  seeds: readonly ReferencedSeed[],
): Promise<number> {
  const records = JSON.stringify(
    seeds.map((seed) => ({
      code: seed.code,
      reference_ids: seed.referenceIds,
    })),
  );
  const result = await db.execute(sql`
    UPDATE ${table} AS t
       SET reference_ids = s.reference_ids, updated_at = clock_timestamp()
      FROM jsonb_to_recordset(${records}::jsonb) AS s(code text, reference_ids text[])
     WHERE t.code = s.code AND t.reference_ids IS DISTINCT FROM s.reference_ids`);
  return result.rowCount ?? 0;
}

/**
 * `pnpm seed`: idempotent upserts by `code` of the reference data — ship
 * types (MEPC.353(78)/MEPC.354(78)), fuels (MEPC.364(79)), the example
 * engines, fuel formula and ports of the case-study vessel. Every row
 * carries its `source` (ship types, fuels and engines also the catalog
 * `referenceIds`). Rows whose seeded values changed republish the vessels
 * embedding them, in the same transaction; reference ids are linked without
 * republishing (no snapshot embeds them).
 */
export class ReferenceSeeder {
  constructor(private readonly snapshots: SnapshotOutbox) {}

  async run(transaction: FleetTransaction): Promise<SeedReport> {
    const { db } = transaction;
    const typeRows = await db
      .insert(vesselTypes)
      .values(
        VESSEL_TYPE_SEEDS.map((seed) => ({
          id: newId(),
          ...seed,
          referenceIds: [...seed.referenceIds],
        })),
      )
      .onConflictDoUpdate({
        target: vesselTypes.code,
        ...upsertBy({
          name: vesselTypes.name,
          capacityUnit: vesselTypes.capacityUnit,
          a: vesselTypes.a,
          c: vesselTypes.c,
          capacityFixed: vesselTypes.capacityFixed,
          d1: vesselTypes.d1,
          d2: vesselTypes.d2,
          d3: vesselTypes.d3,
          d4: vesselTypes.d4,
          icon: vesselTypes.icon,
          source: vesselTypes.source,
        }),
      })
      .returning({ id: vesselTypes.id, ...RETURNING });
    const fuelRows = await db
      .insert(fuels)
      .values(
        FUEL_SEEDS.map((seed) => ({
          id: newId(),
          ...seed,
          referenceIds: [...seed.referenceIds],
        })),
      )
      .onConflictDoUpdate({
        target: fuels.code,
        ...upsertBy({
          name: fuels.name,
          carbonContent: fuels.carbonContent,
          conversionFactor: fuels.conversionFactor,
          density: fuels.density,
          source: fuels.source,
        }),
      })
      .returning({ id: fuels.id, ...RETURNING });
    const engineRows = await db
      .insert(engines)
      .values(
        ENGINE_SEEDS.map((seed) => ({
          id: newId(),
          ...seed,
          referenceIds: [...seed.referenceIds],
        })),
      )
      .onConflictDoUpdate({
        target: engines.code,
        ...upsertBy({
          kind: engines.kind,
          name: engines.name,
          rpm: engines.rpm,
          powerKw: engines.powerKw,
          sfoc: engines.sfoc,
          source: engines.source,
        }),
      })
      .returning({ id: engines.id, ...RETURNING });
    const formulaRows = await db
      .insert(fuelFormulas)
      .values(FUEL_FORMULA_SEEDS.map((seed) => ({ id: newId(), ...seed })))
      .onConflictDoUpdate({
        target: fuelFormulas.code,
        ...upsertBy({
          name: fuelFormulas.name,
          mainEngineFormula: fuelFormulas.mainEngineFormula,
          auxiliaryEngineFormula: fuelFormulas.auxiliaryEngineFormula,
          source: fuelFormulas.source,
        }),
      })
      .returning({ id: fuelFormulas.id, ...RETURNING });
    const portRows = await db
      .insert(ports)
      .values(
        PORT_SEEDS.map(({ lon, lat, ...seed }) => ({
          id: newId(),
          ...seed,
          geom: pointGeography(lon, lat),
        })),
      )
      .onConflictDoUpdate({
        target: ports.code,
        ...upsertBy({
          name: ports.name,
          administrativeLocation: ports.administrativeLocation,
          geom: ports.geom,
          radiusM: ports.radiusM,
          source: ports.source,
        }),
      })
      .returning({ id: ports.id, ...RETURNING });

    // Changed rows that snapshots embed: republish their vessels (ports are not embedded).
    const cascades: ReferenceFilter[] = [
      ...typeRows
        .filter((row) => !row.inserted)
        .map((row) => ({ typeId: row.id })),
      ...fuelRows
        .filter((row) => !row.inserted)
        .map((row) => ({ fuelId: row.id })),
      ...engineRows
        .filter((row) => !row.inserted)
        .map((row) => ({ engineId: row.id })),
      ...formulaRows
        .filter((row) => !row.inserted)
        .map((row) => ({ firstFuelFormulaId: row.id })),
    ];
    let republished = 0;
    for (const filter of cascades) {
      republished += await this.snapshots.enqueueVesselsUsing(
        transaction,
        filter,
      );
    }
    const referencesLinked =
      (await linkReferences(db, vesselTypes, VESSEL_TYPE_SEEDS)) +
      (await linkReferences(db, fuels, FUEL_SEEDS)) +
      (await linkReferences(db, engines, ENGINE_SEEDS));
    return {
      vesselTypes: counts(typeRows, VESSEL_TYPE_SEEDS.length),
      fuels: counts(fuelRows, FUEL_SEEDS.length),
      engines: counts(engineRows, ENGINE_SEEDS.length),
      fuelFormulas: counts(formulaRows, FUEL_FORMULA_SEEDS.length),
      ports: counts(portRows, PORT_SEEDS.length),
      republished,
      referencesLinked,
    };
  }
}
