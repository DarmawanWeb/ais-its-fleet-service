import { PG_POOL, type Pool } from '@darmawanweb/ais-its-nest/db';
import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '../src/db/schema.js';
import { SERVICE } from '../src/service.js';
import { startTestService, type TestService } from './support/test-service.js';

/** Tables the kit creates in the service schema (not part of `schema.ts`). */
const KIT_TABLES = new Set(['schema_migrations']);

/** The drizzle definitions of `src/db/schema.ts`. */
const declaredTables = Object.values<unknown>(schema).flatMap((value) =>
  is(value, PgTable) ? [getTableConfig(value)] : [],
);

/**
 * Spec §6: the drizzle definitions MUST mirror the SQL of `migrations/`. The
 * migrated database is the reference; every column (with its nullability),
 * constraint and index must be declared under the name PostgreSQL gave it.
 */
describe('src/db/schema.ts mirrors the migrated schema', () => {
  let service: TestService;
  let pool: Pool;

  beforeAll(async () => {
    service = await startTestService();
    pool = service.app.get<unknown, Pool>(PG_POOL);
  });

  afterAll(async () => {
    await service.app.close();
  });

  const rowsOf = async <Row extends object>(text: string): Promise<Row[]> =>
    (await pool.query<Row & object>(text, [SERVICE.schema])).rows.filter(
      (row) => !KIT_TABLES.has((row as { table: string }).table),
    );

  it('declares every table and column with its nullability', async () => {
    const actual = await rowsOf<{
      table: string;
      column: string;
      nullable: boolean;
    }>(
      `SELECT table_name AS table, column_name AS column, is_nullable = 'YES' AS nullable
         FROM information_schema.columns WHERE table_schema = $1`,
    );
    const describe = (table: string, column: string, nullable: boolean) =>
      `${table}.${column}${nullable ? '' : ' NOT NULL'}`;
    expect(
      declaredTables
        .flatMap((table) =>
          table.columns.map((column) =>
            describe(table.name, column.name, !column.notNull),
          ),
        )
        .sort(),
    ).toEqual(
      actual.map((row) => describe(row.table, row.column, row.nullable)).sort(),
    );
  });

  it('declares every primary key, foreign key, unique and CHECK constraint under its name', async () => {
    const actual = await rowsOf<{ table: string; name: string; type: string }>(
      `SELECT rel.relname AS table, con.conname AS name, con.contype AS type
         FROM pg_constraint con
         JOIN pg_class rel ON rel.oid = con.conrelid
         JOIN pg_namespace ns ON ns.oid = rel.relnamespace
        WHERE ns.nspname = $1 AND con.contype IN ('p', 'f', 'u', 'c')`,
    );
    const declared = declaredTables.flatMap((table) => [
      ...table.primaryKeys.map((key) => `${table.name} p ${key.getName()}`),
      // A one-column primary key is declared on its column; PostgreSQL names it <table>_pkey.
      ...(table.columns.some((column) => column.primary)
        ? [`${table.name} p ${table.name}_pkey`]
        : []),
      ...table.foreignKeys.map((key) => `${table.name} f ${key.getName()}`),
      ...table.uniqueConstraints.map(
        (unique) => `${table.name} u ${unique.getName()}`,
      ),
      ...table.checks.map((check) => `${table.name} c ${check.name}`),
    ]);
    expect(declared.sort()).toEqual(
      actual.map((row) => `${row.table} ${row.type} ${row.name}`).sort(),
    );
  });

  it('declares every index with its method, uniqueness and predicate', async () => {
    const actual = await rowsOf<{
      table: string;
      name: string;
      method: string;
      unique: boolean;
      partial: boolean;
    }>(
      `SELECT t.relname AS table, i.relname AS name, am.amname AS method,
              x.indisunique AS unique, x.indpred IS NOT NULL AS partial
         FROM pg_index x
         JOIN pg_class i ON i.oid = x.indexrelid
         JOIN pg_class t ON t.oid = x.indrelid
         JOIN pg_am am ON am.oid = i.relam
         JOIN pg_namespace ns ON ns.oid = t.relnamespace
        WHERE ns.nspname = $1
          -- Indexes of primary keys and unique constraints are declared as constraints.
          AND NOT EXISTS (SELECT 1 FROM pg_constraint c
                           WHERE c.conindid = x.indexrelid AND c.contype IN ('p', 'u', 'x'))`,
    );
    const describe = (index: {
      table: string;
      name: string | undefined;
      method: string;
      unique: boolean;
      partial: boolean;
    }) =>
      `${index.table} ${index.name ?? '?'} ${index.method}${index.unique ? ' unique' : ''}${index.partial ? ' partial' : ''}`;
    expect(
      declaredTables
        .flatMap((table) =>
          table.indexes.map((index) =>
            describe({
              table: table.name,
              name: index.config.name,
              method: index.config.method ?? 'btree',
              unique: index.config.unique,
              partial: index.config.where !== undefined,
            }),
          ),
        )
        .sort(),
    ).toEqual(actual.map(describe).sort());
  });
});
