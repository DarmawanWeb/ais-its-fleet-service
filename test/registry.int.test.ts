import { DRIZZLE_DB, PG_POOL, type Pool } from '@darmawanweb/ais-its-nest/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type FleetDb, inTransaction } from '../src/db/database.js';
import { planRegistrySearch } from '../src/domain/registry.js';
import { importLegacyRegistry } from '../src/modules/registry/registry-importer.js';
import {
  RegistryRepository,
  registrySearchSql,
} from '../src/modules/registry/registry.repository.js';
import {
  bodyOf,
  problemOf,
  uniqueImo,
  uniqueMmsi,
} from './support/fleet-fixtures.js';
import {
  newOrganization,
  startTestService,
  type TestService,
} from './support/test-service.js';

interface Particulars {
  id: string;
  imo: string | null;
  mmsi: number;
  name: string;
  built: number | null;
  gt: number | null;
  [key: string]: unknown;
}

describe('registry particulars (legacy SecondaryShip)', () => {
  let service: TestService;
  let pool: Pool;
  const viewer = newOrganization().viewer;
  const ferry = { mmsi: uniqueMmsi(), imo: uniqueImo() };
  const tanker = { mmsi: uniqueMmsi(), imo: uniqueImo() };
  /** A unique word in the names, so searches only see this file's rows. */
  const marker = `Q${Date.now().toString(36)}`;

  /** Legacy documents as mongoexport writes them: every field a string. */
  const documents = [
    {
      _id: { $oid: '64a0c0ffee0000000000aa01' },
      IMO: `IMO ${ferry.imo}`,
      MMSI: String(ferry.mmsi),
      NAME: `DHARMA FERRY ${marker}`,
      BUILT: '1990',
      FLAG: 'ID',
      FLAGNAME: 'Indonesia',
      TYPE: 'PAS',
      TYPENAME: 'Ro-Ro/Passenger Ship',
      GT: '2877',
      DWT: '',
      LOA: '73.3',
      BEAM: '16,3',
      DRAUGHT: '4.1',
      CLASS: 'Biro Klasifikasi Indonesia',
      CLASSCODE: 'BKI',
    },
    {
      IMO: tanker.imo,
      MMSI: String(tanker.mmsi),
      NAME: `SINAR ${marker} TANKER`,
      BUILT: '2008-05',
      GT: 'n/a',
      DWT: '45000',
    },
    { IMO: '1234567', MMSI: '12345', NAME: 'NO VALID MMSI' },
    { IMO: '7654321', MMSI: String(uniqueMmsi()), NAME: '   ' },
  ];

  beforeAll(async () => {
    service = await startTestService();
    pool = service.app.get<unknown, Pool>(PG_POOL);
  });

  afterAll(async () => {
    await service.app.close();
  });

  const importAll = () =>
    inTransaction(pool, (transaction) =>
      importLegacyRegistry(transaction.db, new RegistryRepository(), documents),
    );

  it('imports legacy documents idempotently and reports the refused ones', async () => {
    const first = await importAll();
    expect(first).toMatchObject({
      read: 4,
      inserted: 2,
      updated: 0,
      rejected: 2,
    });
    expect(first.rejections.map((rejection) => rejection.index)).toEqual([
      2, 3,
    ]);
    const again = await importAll();
    expect(again).toMatchObject({ inserted: 0, updated: 2, rejected: 2 });
  });

  it('returns the particulars by MMSI or IMO number', async () => {
    const byMmsi = bodyOf<Particulars>(
      await service.request(viewer, 'GET', `/api/v2/registry/${ferry.mmsi}`),
      200,
    );
    expect(byMmsi).toMatchObject({
      imo: ferry.imo,
      mmsi: ferry.mmsi,
      name: `DHARMA FERRY ${marker}`,
      built: 1990,
      flag: 'ID',
      flagName: 'Indonesia',
      type: 'PAS',
      typeName: 'Ro-Ro/Passenger Ship',
      gt: 2877,
      dwt: null,
      loaM: 73.3,
      beamM: 16.3,
      draughtM: 4.1,
      class: 'Biro Klasifikasi Indonesia',
      classCode: 'BKI',
    });
    for (const key of [ferry.imo, `IMO${ferry.imo}`, `imo ${ferry.imo}`]) {
      const byImo = bodyOf<Particulars>(
        await service.request(
          viewer,
          'GET',
          `/api/v2/registry/${encodeURIComponent(key)}`,
        ),
        200,
      );
      expect(byImo.id, key).toBe(byMmsi.id);
    }
    const tankerRow = bodyOf<Particulars>(
      await service.request(viewer, 'GET', `/api/v2/registry/${tanker.mmsi}`),
      200,
    );
    expect(tankerRow).toMatchObject({ built: 2008, gt: null, dwt: 45_000 });

    expect(
      problemOf(
        await service.request(
          viewer,
          'GET',
          `/api/v2/registry/${uniqueMmsi()}`,
        ),
        404,
      ).code,
    ).toBe('REGISTRY_ENTRY_NOT_FOUND');
    expect(
      problemOf(
        await service.request(viewer, 'GET', '/api/v2/registry/12ab'),
        400,
      ).code,
    ).toBe('VALIDATION_FAILED');
    expect(
      (await service.request(null, 'GET', `/api/v2/registry/${ferry.mmsi}`))
        .statusCode,
    ).toBe(401);
  });

  it('searches names (prefix and substring), IMO and MMSI prefixes', async () => {
    const search = async (q: string): Promise<number[]> =>
      bodyOf<{ data: Particulars[] }>(
        await service.request(
          viewer,
          'GET',
          `/api/v2/registry/search?q=${encodeURIComponent(q)}&pageSize=100`,
        ),
        200,
      ).data.map((row) => row.mmsi);

    expect(await search(`dharma ferry ${marker}`)).toEqual([ferry.mmsi]);
    // Substring, case-insensitive.
    expect((await search(marker.toLowerCase())).sort()).toEqual(
      [ferry.mmsi, tanker.mmsi].sort(),
    );
    expect(await search(`${marker} tanker`)).toEqual([tanker.mmsi]);
    expect(await search(ferry.imo)).toContain(ferry.mmsi);
    expect(await search(`IMO ${tanker.imo}`)).toContain(tanker.mmsi);
    expect(await search(String(ferry.mmsi))).toEqual([ferry.mmsi]);
    expect(await search(String(ferry.mmsi).slice(0, 6))).toContain(ferry.mmsi);

    const paged = bodyOf<{ data: Particulars[]; meta: { total: number } }>(
      await service.request(
        viewer,
        'GET',
        `/api/v2/registry/search?q=${marker}&pageSize=1`,
      ),
      200,
    );
    expect(paged.data).toHaveLength(1);
    expect(paged.meta.total).toBe(2);

    problemOf(
      await service.request(viewer, 'GET', '/api/v2/registry/search'),
      400,
    );
    problemOf(
      await service.request(viewer, 'GET', '/api/v2/registry/search?q='),
      400,
    );
    problemOf(
      await service.request(
        viewer,
        'GET',
        `/api/v2/registry/search?q=${marker}&match=fuzzy`,
      ),
      400,
    );
  });

  it('ranks exact, prefix and substring matches and scans only as the match mode allows', async () => {
    const word = `R${Date.now().toString(36)}`;
    const rows = [
      { MMSI: String(uniqueMmsi()), NAME: `KM ${word}` }, // substring
      { MMSI: String(uniqueMmsi()), NAME: `${word} BARU` }, // prefix
      { MMSI: String(uniqueMmsi()), NAME: word }, // exact
      { MMSI: String(uniqueMmsi()), NAME: `${word} ALPHA` }, // prefix
    ];
    await inTransaction(pool, (transaction) =>
      importLegacyRegistry(transaction.db, new RegistryRepository(), rows),
    );
    const search = async (query: string) =>
      bodyOf<{ data: Particulars[]; meta: { total: number } }>(
        await service.request(
          viewer,
          'GET',
          `/api/v2/registry/search?${query}`,
        ),
        200,
      );
    const names = (page: { data: Particulars[] }) =>
      page.data.map((row) => row.name);

    // contains: exact first, then prefix (by name), then substring.
    const all = await search(`q=${word}&match=contains`);
    expect(names(all)).toEqual([
      word,
      `${word} ALPHA`,
      `${word} BARU`,
      `KM ${word}`,
    ]);
    expect(all.meta.total).toBe(4);
    // prefix: the indexed arms only.
    const prefix = await search(`q=${word}&match=prefix`);
    expect(names(prefix)).toEqual([word, `${word} ALPHA`, `${word} BARU`]);
    expect(prefix.meta.total).toBe(3);
    // auto: the indexed arms fill a page of 3, so no substring scan, on every page.
    for (const page of [1, 2]) {
      expect(
        (await search(`q=${word}&pageSize=3&page=${page}`)).meta.total,
      ).toBe(3);
    }
    // auto: a page of 4 is not filled by the 3 prefix matches → substring matches join.
    const sparse = await search(`q=${word}&pageSize=4`);
    expect(sparse.meta.total).toBe(4);
    expect(names(sparse).at(-1)).toBe(`KM ${word}`);
    expect((await search(`q=${word}&pageSize=4&page=2`)).meta.total).toBe(4);

    // Digit queries are identity lookups: no substring arm, even when asked.
    const digits = uniqueImo();
    await inTransaction(pool, (transaction) =>
      importLegacyRegistry(transaction.db, new RegistryRepository(), [
        { MMSI: String(uniqueMmsi()), NAME: `SHIP ${digits}` },
      ]),
    );
    expect(
      (await search(`q=${digits}&match=contains`)).data.map((row) => row.name),
    ).not.toContain(`SHIP ${digits}`);
  });

  it('answers numeric and dense prefix searches from the indexes on a large registry', async () => {
    const prefix = `PLAN${Date.now().toString(36).toUpperCase()}`;
    const rows = 20_000;
    // Committed (other searches never match these names or the 9000xxxxx MMSIs).
    await pool.query(
      `INSERT INTO registry_particulars (id, imo, mmsi, name)
       SELECT gen_random_uuid(), (5000000 + i)::text, 900000000 + i, $1 || ' ' || i
         FROM generate_series(1, $2::int) AS i`,
      [prefix, rows],
    );
    await pool.query('ANALYZE registry_particulars');
    const db = service.app.get<unknown, FleetDb>(DRIZZLE_DB);

    /** Node types, relations and indexes of the plan of one search. */
    const planOf = async (query: string, substring: boolean) => {
      const plan = planRegistrySearch(query);
      const { rows: explained } = await db.execute<{
        'QUERY PLAN': unknown;
      }>(
        sql`EXPLAIN (FORMAT JSON) ${registrySearchSql(plan, { substring }, { offset: 0, limit: 20 })}`,
      );
      const nodes: { type: string; relation?: string; index?: string }[] = [];
      const walk = (node: Record<string, unknown>): void => {
        nodes.push({
          type: String(node['Node Type']),
          ...(typeof node['Relation Name'] === 'string'
            ? { relation: node['Relation Name'] }
            : {}),
          ...(typeof node['Index Name'] === 'string'
            ? { index: node['Index Name'] }
            : {}),
        });
        for (const child of (node.Plans as
          Record<string, unknown>[] | undefined) ?? []) {
          walk(child);
        }
      };
      const document = explained[0]?.['QUERY PLAN'] as
        { Plan: Record<string, unknown> }[] | undefined;
      const root = document?.[0]?.Plan;
      if (root === undefined) throw new Error('EXPLAIN returned no plan');
      walk(root);
      return nodes;
    };
    const seqScans = (nodes: { type: string; relation?: string }[]) =>
      nodes.filter(
        (node) =>
          node.type === 'Seq Scan' && node.relation === 'registry_particulars',
      );
    const indexes = (nodes: { index?: string }[]) =>
      new Set(
        nodes.flatMap((node) => (node.index === undefined ? [] : [node.index])),
      );

    // Exact IMO number (7 digits): IMO prefix + MMSI range + name prefix arms.
    const imo = await planOf('5012345', false);
    expect(seqScans(imo)).toEqual([]);
    expect(indexes(imo)).toEqual(
      new Set([
        'registry_particulars_imo_idx',
        'registry_particulars_mmsi_key',
        'registry_particulars_name_idx',
      ]),
    );
    // Exact MMSI (9 digits).
    const mmsi = await planOf('900012345', false);
    expect(seqScans(mmsi)).toEqual([]);
    expect(indexes(mmsi)).toContain('registry_particulars_mmsi_key');
    // A text prefix.
    const name = await planOf(`${prefix} 1234`, false);
    expect(seqScans(name)).toEqual([]);
    expect(indexes(name)).toContain('registry_particulars_name_idx');
    // Only the substring arm scans the table — and only when it runs.
    expect(seqScans(await planOf(`${prefix} 1234`, true))).toHaveLength(1);

    // The API answers from the same arms: a dense prefix fills the page
    // without the substring arm, exact matches first.
    const page = bodyOf<{ data: Particulars[]; meta: { total: number } }>(
      await service.request(
        viewer,
        'GET',
        `/api/v2/registry/search?q=${encodeURIComponent(`${prefix} 1234`)}`,
      ),
      200,
    );
    expect(page.meta.total).toBe(11); // 1234 and 12340–12349
    expect(page.data[0]?.name).toBe(`${prefix} 1234`);
    const byImo = bodyOf<{ data: Particulars[] }>(
      await service.request(viewer, 'GET', '/api/v2/registry/search?q=5012345'),
      200,
    );
    expect(byImo.data[0]).toMatchObject({ imo: '5012345', mmsi: 900_012_345 });
  });
});
