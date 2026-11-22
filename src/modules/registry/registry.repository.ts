import { newId } from '@darmawanweb/ais-its-contracts/domain';
import { Injectable } from '@nestjs/common';
import { desc, eq, inArray, type SQL, sql } from 'drizzle-orm';

import type { FleetDb } from '../../db/database.js';
import { registryParticulars } from '../../db/schema.js';
import type {
  RegistryKey,
  RegistryParticulars,
  RegistrySearchPlan,
} from '../../domain/registry.js';
import { escapeLikePattern } from '../common/validation.js';

/** A stored registry entry. */
export type RegistryEntry = RegistryParticulars & {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

/** Options of {@link registrySearchSql}. */
export interface RegistrySearchOptions {
  /** Adds the substring arm `name ILIKE '%text%'` (a sequential scan). */
  readonly substring: boolean;
}

/** A page of a registry search query. */
export interface RegistrySearchPage {
  readonly offset: number;
  readonly limit: number;
}

/**
 * The id query of a registry search. Each arm of the plan is its own
 * `UNION ALL` branch, so every indexed arm is an index range scan:
 * `lower(name) LIKE 'text%'` (`registry_particulars_name_idx`), `imo LIKE
 * 'digits%'` (`registry_particulars_imo_idx`) and the MMSI range
 * (`registry_particulars_mmsi_key`); only the optional substring arm scans.
 * Entries matched by several arms keep their best rank (0 exact, 1 prefix,
 * 2 substring); the matches are counted once and paged by rank, name and
 * MMSI. The result always has one row: `total`, with `id` `NULL` when the
 * page is empty.
 */
export function registrySearchSql(
  plan: RegistrySearchPlan,
  options: RegistrySearchOptions,
  page: RegistrySearchPage,
): SQL {
  const t = registryParticulars;
  const columns = sql`${t.id} AS id, ${t.name} AS name, ${t.mmsi} AS mmsi`;
  const arms: SQL[] = [
    sql`SELECT ${columns}, CASE WHEN lower(${t.name}) = ${plan.text} THEN 0 ELSE 1 END AS rank
          FROM ${t} WHERE lower(${t.name}) LIKE ${`${escapeLikePattern(plan.text)}%`}`,
  ];
  if (plan.imoPrefix !== undefined) {
    arms.push(
      sql`SELECT ${columns}, CASE WHEN ${t.imo} = ${plan.imoPrefix} THEN 0 ELSE 1 END
            FROM ${t} WHERE ${t.imo} LIKE ${`${plan.imoPrefix}%`}`,
    );
  }
  if (plan.mmsiRange !== undefined) {
    const [low, high] = plan.mmsiRange;
    // A range of one MMSI is the exact MMSI of a 9-digit query.
    const rank = low === high ? sql`0` : sql`1`;
    arms.push(
      sql`SELECT ${columns}, ${rank} FROM ${t} WHERE ${t.mmsi} BETWEEN ${low} AND ${high}`,
    );
  }
  if (options.substring) {
    arms.push(
      sql`SELECT ${columns}, 2 FROM ${t} WHERE ${t.name} ILIKE ${`%${escapeLikePattern(plan.text)}%`}`,
    );
  }
  return sql`
    WITH candidates AS (${sql.join(arms, sql` UNION ALL `)}),
         ranked AS (SELECT DISTINCT ON (id) id, name, mmsi, rank FROM candidates ORDER BY id, rank),
         total AS (SELECT count(*)::int AS total FROM ranked)
    SELECT total.total, page.id
      FROM total
      LEFT JOIN LATERAL (
             SELECT id, rank, name, mmsi FROM ranked
              ORDER BY rank, name, mmsi
              LIMIT ${page.limit} OFFSET ${page.offset}
           ) page ON true
     ORDER BY page.rank, page.name, page.mmsi`;
}

/** Drizzle access to `registry_particulars`. */
@Injectable()
export class RegistryRepository {
  /**
   * One page of the entries matching the plan (see {@link registrySearchSql}),
   * best matches first, and how many match in total.
   */
  async search(
    db: FleetDb,
    plan: RegistrySearchPlan,
    options: RegistrySearchOptions,
    page: RegistrySearchPage,
  ): Promise<{ rows: RegistryEntry[]; total: number }> {
    const { rows: hits } = await db.execute<{
      total: number;
      id: string | null;
    }>(registrySearchSql(plan, options, page));
    const total = hits[0]?.total ?? 0;
    const ids = hits.flatMap((hit) => (hit.id === null ? [] : [hit.id]));
    if (ids.length === 0) return { rows: [], total };
    const entries = await db
      .select()
      .from(registryParticulars)
      .where(inArray(registryParticulars.id, ids));
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    return {
      // A row deleted between the two statements is simply left out.
      rows: ids.flatMap((id) => {
        const entry = byId.get(id);
        return entry === undefined ? [] : [entry];
      }),
      total,
    };
  }

  /** The entry of an MMSI, or the most recently updated entry of an IMO number. */
  async findByKey(
    db: FleetDb,
    key: RegistryKey,
  ): Promise<RegistryEntry | undefined> {
    const [row] = await db
      .select()
      .from(registryParticulars)
      .where(
        key.kind === 'mmsi'
          ? eq(registryParticulars.mmsi, key.mmsi)
          : eq(registryParticulars.imo, key.imo),
      )
      .orderBy(desc(registryParticulars.updatedAt))
      .limit(1);
    return row;
  }

  /**
   * Inserts or replaces entries by MMSI (the legacy unique key).
   *
   * @returns how many rows were inserted and how many updated
   */
  async upsertMany(
    db: FleetDb,
    entries: readonly RegistryParticulars[],
  ): Promise<{ inserted: number; updated: number }> {
    if (entries.length === 0) return { inserted: 0, updated: 0 };
    const rows = await db
      .insert(registryParticulars)
      .values(
        entries.map((entry) => ({
          ...entry,
          id: newId(),
          raw: { ...entry.raw },
        })),
      )
      .onConflictDoUpdate({
        target: registryParticulars.mmsi,
        set: {
          imo: sql`excluded.imo`,
          name: sql`excluded.name`,
          built: sql`excluded.built`,
          flag: sql`excluded.flag`,
          flagName: sql`excluded.flag_name`,
          type: sql`excluded.type`,
          typeName: sql`excluded.type_name`,
          gt: sql`excluded.gt`,
          dwt: sql`excluded.dwt`,
          loa: sql`excluded.loa`,
          beam: sql`excluded.beam`,
          draught: sql`excluded.draught`,
          class: sql`excluded.class`,
          classCode: sql`excluded.class_code`,
          raw: sql`excluded.raw`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    const inserted = rows.filter((row) => row.inserted).length;
    return { inserted, updated: rows.length - inserted };
  }
}
