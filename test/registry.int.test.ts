import { PG_POOL, type Pool } from '@darmawanweb/ais-its-nest/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { inTransaction } from '../src/db/database.js';
import { importLegacyRegistry } from '../src/modules/registry/registry-importer.js';
import { RegistryRepository } from '../src/modules/registry/registry.repository.js';
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
  });
});
