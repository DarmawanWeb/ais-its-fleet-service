import { Injectable } from '@nestjs/common';
import { asc, count, eq, ilike, or, sql } from 'drizzle-orm';

import type { FleetDb } from '../../db/database.js';
import { vesselTypes } from '../../db/schema.js';
import type { VesselType } from '../../domain/vessel.js';
import { escapeLikePattern } from '../common/validation.js';

/** Columns of a new vessel type (timestamps by the database). */
export type NewVesselType = Omit<VesselType, 'createdAt' | 'updatedAt'>;

/** Changeable columns of a vessel type. */
export type VesselTypeChanges = Partial<Omit<NewVesselType, 'id'>>;

/** Name of the unique constraint on `code`. */
export const VESSEL_TYPE_CODE_CONSTRAINT = 'vessel_types_code_key';

/** Drizzle access to `vessel_types`. */
@Injectable()
export class VesselTypesRepository {
  async list(
    db: FleetDb,
    search: string | undefined,
    page: { readonly offset: number; readonly limit: number },
  ): Promise<{ rows: VesselType[]; total: number }> {
    const where =
      search === undefined
        ? undefined
        : or(
            ilike(vesselTypes.name, `%${escapeLikePattern(search)}%`),
            ilike(vesselTypes.code, `%${escapeLikePattern(search)}%`),
          );
    const [rows, totals] = await Promise.all([
      db
        .select()
        .from(vesselTypes)
        .where(where)
        .orderBy(asc(vesselTypes.code))
        .limit(page.limit)
        .offset(page.offset),
      db.select({ total: count() }).from(vesselTypes).where(where),
    ]);
    return { rows, total: totals[0]?.total ?? 0 };
  }

  async findById(db: FleetDb, id: string): Promise<VesselType | undefined> {
    const [row] = await db
      .select()
      .from(vesselTypes)
      .where(eq(vesselTypes.id, id))
      .limit(1);
    return row;
  }

  async findByCode(db: FleetDb, code: string): Promise<VesselType | undefined> {
    const [row] = await db
      .select()
      .from(vesselTypes)
      .where(eq(vesselTypes.code, code))
      .limit(1);
    return row;
  }

  async insert(db: FleetDb, type: NewVesselType): Promise<VesselType> {
    const [row] = await db.insert(vesselTypes).values(type).returning();
    if (row === undefined)
      throw new Error('INSERT … RETURNING returned no row');
    return row;
  }

  /** Applies `changes` (row-locked) and advances `updated_at`; `undefined` when absent. */
  async update(
    db: FleetDb,
    id: string,
    changes: VesselTypeChanges,
  ): Promise<VesselType | undefined> {
    const [row] = await db
      .update(vesselTypes)
      .set({ ...changes, updatedAt: sql`clock_timestamp()` })
      .where(eq(vesselTypes.id, id))
      .returning();
    return row;
  }

  async delete(db: FleetDb, id: string): Promise<VesselType | undefined> {
    const [row] = await db
      .delete(vesselTypes)
      .where(eq(vesselTypes.id, id))
      .returning();
    return row;
  }
}
