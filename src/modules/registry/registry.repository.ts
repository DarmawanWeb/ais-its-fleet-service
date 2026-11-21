import { newId } from '@darmawanweb/ais-its-contracts/domain';
import { Injectable } from '@nestjs/common';
import {
  asc,
  between,
  count,
  desc,
  eq,
  ilike,
  like,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';

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

/** Drizzle access to `registry_particulars`. */
@Injectable()
export class RegistryRepository {
  /**
   * Entries matching the plan: exact and prefix matches first (MMSI, IMO,
   * name), then substring matches of the name, each ordered by name.
   */
  async search(
    db: FleetDb,
    plan: RegistrySearchPlan,
    page: { readonly offset: number; readonly limit: number },
  ): Promise<{ rows: RegistryEntry[]; total: number }> {
    const namePrefix = `${escapeLikePattern(plan.namePrefix)}%`;
    const prefixMatch = or(
      like(sql`lower(${registryParticulars.name})`, namePrefix),
      plan.imoPrefix === undefined
        ? undefined
        : like(registryParticulars.imo, `${plan.imoPrefix}%`),
      plan.mmsiRange === undefined
        ? undefined
        : between(registryParticulars.mmsi, ...plan.mmsiRange),
    );
    const where: SQL | undefined =
      plan.nameContains === undefined
        ? prefixMatch
        : or(
            prefixMatch,
            ilike(
              registryParticulars.name,
              `%${escapeLikePattern(plan.nameContains)}%`,
            ),
          );
    const [rows, totals] = await Promise.all([
      db
        .select()
        .from(registryParticulars)
        .where(where)
        .orderBy(
          desc(sql`(${prefixMatch ?? sql`false`})`),
          asc(registryParticulars.name),
          asc(registryParticulars.mmsi),
        )
        .limit(page.limit)
        .offset(page.offset),
      db.select({ total: count() }).from(registryParticulars).where(where),
    ]);
    return { rows, total: totals[0]?.total ?? 0 };
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
