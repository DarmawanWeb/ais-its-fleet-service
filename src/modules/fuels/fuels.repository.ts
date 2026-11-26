import { Injectable } from '@nestjs/common';
import { asc, count, eq, ilike, or, sql } from 'drizzle-orm';

import type { FleetDb } from '../../db/database.js';
import { fuels } from '../../db/schema.js';
import type { Fuel } from '../../domain/vessel.js';
import { escapeLikePattern } from '../common/validation.js';

/** Columns of a new fuel (timestamps by the database). */
export type NewFuel = Omit<Fuel, 'createdAt' | 'updatedAt'>;

/** Changeable columns of a fuel. */
export type FuelChanges = Partial<Omit<NewFuel, 'id'>>;

/** Name of the unique constraint on `code`. */
export const FUEL_CODE_CONSTRAINT = 'fuels_code_key';

/** `changes` with `referenceIds` copied into the mutable array drizzle writes. */
function columnsOf(changes: FuelChanges) {
  const { referenceIds, ...columns } = changes;
  return referenceIds === undefined
    ? columns
    : { ...columns, referenceIds: [...referenceIds] };
}

/** Drizzle access to `fuels`. */
@Injectable()
export class FuelsRepository {
  async list(
    db: FleetDb,
    search: string | undefined,
    page: { readonly offset: number; readonly limit: number },
  ): Promise<{ rows: Fuel[]; total: number }> {
    const where =
      search === undefined
        ? undefined
        : or(
            ilike(fuels.name, `%${escapeLikePattern(search)}%`),
            ilike(fuels.code, `%${escapeLikePattern(search)}%`),
          );
    const [rows, totals] = await Promise.all([
      db
        .select()
        .from(fuels)
        .where(where)
        .orderBy(asc(fuels.code))
        .limit(page.limit)
        .offset(page.offset),
      db.select({ total: count() }).from(fuels).where(where),
    ]);
    return { rows, total: totals[0]?.total ?? 0 };
  }

  async findById(db: FleetDb, id: string): Promise<Fuel | undefined> {
    const [row] = await db
      .select()
      .from(fuels)
      .where(eq(fuels.id, id))
      .limit(1);
    return row;
  }

  async insert(db: FleetDb, fuel: NewFuel): Promise<Fuel> {
    const [row] = await db
      .insert(fuels)
      .values({ ...fuel, referenceIds: [...fuel.referenceIds] })
      .returning();
    if (row === undefined)
      throw new Error('INSERT … RETURNING returned no row');
    return row;
  }

  /** Applies `changes` (row-locked) and advances `updated_at`; `undefined` when absent. */
  async update(
    db: FleetDb,
    id: string,
    changes: FuelChanges,
  ): Promise<Fuel | undefined> {
    const [row] = await db
      .update(fuels)
      .set({ ...columnsOf(changes), updatedAt: sql`clock_timestamp()` })
      .where(eq(fuels.id, id))
      .returning();
    return row;
  }

  async delete(db: FleetDb, id: string): Promise<Fuel | undefined> {
    const [row] = await db.delete(fuels).where(eq(fuels.id, id)).returning();
    return row;
  }
}
