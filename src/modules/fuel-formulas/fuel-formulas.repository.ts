import { Injectable } from '@nestjs/common';
import { asc, count, eq, ilike, or, sql } from 'drizzle-orm';

import type { FleetDb } from '../../db/database.js';
import { fuelFormulas } from '../../db/schema.js';
import type { FuelFormula } from '../../domain/vessel.js';
import { escapeLikePattern } from '../common/validation.js';

/** Columns of a new fuel formula (timestamps by the database). */
export type NewFuelFormula = Omit<FuelFormula, 'createdAt' | 'updatedAt'>;

/** Changeable columns of a fuel formula. */
export type FuelFormulaChanges = Partial<Omit<NewFuelFormula, 'id'>>;

/** Name of the unique constraint on `code`. */
export const FUEL_FORMULA_CODE_CONSTRAINT = 'fuel_formulas_code_key';

/** Drizzle access to `fuel_formulas`. */
@Injectable()
export class FuelFormulasRepository {
  async list(
    db: FleetDb,
    search: string | undefined,
    page: { readonly offset: number; readonly limit: number },
  ): Promise<{ rows: FuelFormula[]; total: number }> {
    const where =
      search === undefined
        ? undefined
        : or(
            ilike(fuelFormulas.name, `%${escapeLikePattern(search)}%`),
            ilike(fuelFormulas.code, `%${escapeLikePattern(search)}%`),
          );
    const [rows, totals] = await Promise.all([
      db
        .select()
        .from(fuelFormulas)
        .where(where)
        .orderBy(asc(fuelFormulas.name), asc(fuelFormulas.id))
        .limit(page.limit)
        .offset(page.offset),
      db.select({ total: count() }).from(fuelFormulas).where(where),
    ]);
    return { rows, total: totals[0]?.total ?? 0 };
  }

  async findById(db: FleetDb, id: string): Promise<FuelFormula | undefined> {
    const [row] = await db
      .select()
      .from(fuelFormulas)
      .where(eq(fuelFormulas.id, id))
      .limit(1);
    return row;
  }

  async insert(db: FleetDb, formula: NewFuelFormula): Promise<FuelFormula> {
    const [row] = await db.insert(fuelFormulas).values(formula).returning();
    if (row === undefined)
      throw new Error('INSERT … RETURNING returned no row');
    return row;
  }

  /** Applies `changes` (row-locked) and advances `updated_at`; `undefined` when absent. */
  async update(
    db: FleetDb,
    id: string,
    changes: FuelFormulaChanges,
  ): Promise<FuelFormula | undefined> {
    const [row] = await db
      .update(fuelFormulas)
      .set({ ...changes, updatedAt: sql`clock_timestamp()` })
      .where(eq(fuelFormulas.id, id))
      .returning();
    return row;
  }

  async delete(db: FleetDb, id: string): Promise<FuelFormula | undefined> {
    const [row] = await db
      .delete(fuelFormulas)
      .where(eq(fuelFormulas.id, id))
      .returning();
    return row;
  }
}
