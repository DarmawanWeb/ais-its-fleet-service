import type { EngineKind } from '@darmawanweb/ais-its-contracts/domain';
import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, ilike, or, sql } from 'drizzle-orm';

import type { FleetDb } from '../../db/database.js';
import { engines } from '../../db/schema.js';
import type { Engine } from '../../domain/vessel.js';
import { escapeLikePattern } from '../common/validation.js';

/** Columns of a new engine (timestamps by the database). */
export type NewEngine = Omit<Engine, 'createdAt' | 'updatedAt'>;

/** Changeable columns of an engine. */
export type EngineChanges = Partial<Omit<NewEngine, 'id'>>;

/** Name of the unique constraint on `code`. */
export const ENGINE_CODE_CONSTRAINT = 'engines_code_key';

/** Drizzle access to `engines`. */
@Injectable()
export class EnginesRepository {
  async list(
    db: FleetDb,
    filter: {
      readonly search?: string | undefined;
      readonly kind?: EngineKind | undefined;
    },
    page: { readonly offset: number; readonly limit: number },
  ): Promise<{ rows: Engine[]; total: number }> {
    const where = and(
      filter.kind === undefined ? undefined : eq(engines.kind, filter.kind),
      filter.search === undefined
        ? undefined
        : or(
            ilike(engines.name, `%${escapeLikePattern(filter.search)}%`),
            ilike(engines.code, `%${escapeLikePattern(filter.search)}%`),
          ),
    );
    const [rows, totals] = await Promise.all([
      db
        .select()
        .from(engines)
        .where(where)
        .orderBy(asc(engines.kind), asc(engines.name), asc(engines.id))
        .limit(page.limit)
        .offset(page.offset),
      db.select({ total: count() }).from(engines).where(where),
    ]);
    return { rows, total: totals[0]?.total ?? 0 };
  }

  async findById(db: FleetDb, id: string): Promise<Engine | undefined> {
    const [row] = await db
      .select()
      .from(engines)
      .where(eq(engines.id, id))
      .limit(1);
    return row;
  }

  async insert(db: FleetDb, engine: NewEngine): Promise<Engine> {
    const [row] = await db.insert(engines).values(engine).returning();
    if (row === undefined)
      throw new Error('INSERT … RETURNING returned no row');
    return row;
  }

  /** Applies `changes` (row-locked) and advances `updated_at`; `undefined` when absent. */
  async update(
    db: FleetDb,
    id: string,
    changes: EngineChanges,
  ): Promise<Engine | undefined> {
    const [row] = await db
      .update(engines)
      .set({ ...changes, updatedAt: sql`clock_timestamp()` })
      .where(eq(engines.id, id))
      .returning();
    return row;
  }

  async delete(db: FleetDb, id: string): Promise<Engine | undefined> {
    const [row] = await db
      .delete(engines)
      .where(eq(engines.id, id))
      .returning();
    return row;
  }
}
