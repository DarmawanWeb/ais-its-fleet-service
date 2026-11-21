import { EVENT_TYPES } from '@darmawanweb/ais-its-contracts/events';
import { PG_POOL, type Pool } from '@darmawanweb/ais-its-nest/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { inTransaction } from '../src/db/database.js';
import { SnapshotOutbox } from '../src/modules/snapshots/snapshot-outbox.js';
import { FUEL_SEEDS } from '../src/seeds/fuels.seed.js';
import {
  type SeedReport,
  ReferenceSeeder,
} from '../src/seeds/reference-seeder.js';
import {
  ENGINE_SEEDS,
  FUEL_FORMULA_SEEDS,
  PORT_SEEDS,
} from '../src/seeds/samples.seed.js';
import { VESSEL_TYPE_SEEDS } from '../src/seeds/vessel-types.seed.js';
import {
  bodyOf,
  createReferenceSet,
  createVessel,
} from './support/fleet-fixtures.js';
import { FleetStreamProbe } from './support/fleet-stream.js';
import {
  newOrganization,
  SUPER_ADMIN,
  startTestService,
  type TestService,
} from './support/test-service.js';

interface Page<T> {
  data: T[];
  meta: { total: number };
}

interface Row {
  id: string;
  code: string;
  [key: string]: unknown;
}

describe('pnpm seed: idempotent reference data', () => {
  let service: TestService;
  let pool: Pool;
  let probe: FleetStreamProbe;
  const org = newOrganization();

  const seed = (): Promise<SeedReport> =>
    inTransaction(pool, (transaction) =>
      new ReferenceSeeder(service.app.get(SnapshotOutbox)).run(transaction),
    );

  /** The seeded row with `code` from a reference list. */
  const seeded = async (path: string, code: string): Promise<Row> => {
    const page = bodyOf<Page<Row>>(
      await service.request(
        SUPER_ADMIN,
        'GET',
        `/api/v2/${path}?search=${code}&pageSize=100`,
      ),
      200,
    );
    const row = page.data.find((candidate) => candidate.code === code);
    if (row === undefined) throw new Error(`${path} ${code} not seeded`);
    return row;
  };

  beforeAll(async () => {
    service = await startTestService();
    pool = service.app.get<unknown, Pool>(PG_POOL);
    probe = await FleetStreamProbe.start(service.app);
  });

  afterAll(async () => {
    await probe.stop();
    await service.app.close();
  });

  it('upserts every seed row by code and changes nothing on a second run', async () => {
    const first = await seed();
    const totals = {
      vesselTypes: VESSEL_TYPE_SEEDS.length,
      fuels: FUEL_SEEDS.length,
      engines: ENGINE_SEEDS.length,
      fuelFormulas: FUEL_FORMULA_SEEDS.length,
      ports: PORT_SEEDS.length,
    };
    for (const [table, total] of Object.entries(totals)) {
      const counts = first[table as keyof typeof totals];
      expect(counts.inserted + counts.updated + counts.unchanged, table).toBe(
        total,
      );
    }

    const second = await seed();
    expect(second).toEqual({
      vesselTypes: { inserted: 0, updated: 0, unchanged: totals.vesselTypes },
      fuels: { inserted: 0, updated: 0, unchanged: totals.fuels },
      engines: { inserted: 0, updated: 0, unchanged: totals.engines },
      fuelFormulas: { inserted: 0, updated: 0, unchanged: totals.fuelFormulas },
      ports: { inserted: 0, updated: 0, unchanged: totals.ports },
      republished: 0,
    });
    const { rows } = await pool.query<{ code: string; count: number }>(
      'SELECT code, count(*)::int AS count FROM vessel_types GROUP BY code HAVING count(*) > 1',
    );
    expect(rows).toEqual([]);
  });

  it('seeds the IMO values with their sources', async () => {
    const bulk = await seeded('vessel-types', 'bulk_carrier_279k_plus');
    expect(bulk).toMatchObject({
      capacityUnit: 'DWT',
      a: 4745,
      c: 0.622,
      capacityFixed: 279_000,
      d: { d1: 0.86, d2: 0.94, d3: 1.06, d4: 1.18 },
      icon: 'bulkca',
    });
    expect(bulk.source).toMatch(/MEPC\.353\(78\).*MEPC\.354\(78\)/s);
    expect(await seeded('vessel-types', 'lng_carrier_below_65k')).toMatchObject(
      { a: 14779e10, c: 2.673, capacityFixed: 65_000 },
    );
    expect(await seeded('vessel-types', 'roro_passenger')).toMatchObject({
      capacityUnit: 'GT',
      a: 2023,
      c: 0.46,
      capacityFixed: null,
    });

    const diesel = await seeded('fuels', 'diesel_gas_oil');
    expect(diesel).toMatchObject({
      carbonContent: 0.8744,
      conversionFactor: 3.206,
      density: 0.86,
    });
    expect(diesel.source).toMatch(/MEPC\.364\(79\)/);
    expect(await seeded('fuels', 'lng')).toMatchObject({
      conversionFactor: 2.75,
      carbonContent: 0.75,
    });
    expect(await seeded('engines', 'niigata_6m28bet')).toMatchObject({
      kind: 'main',
      powerKw: 2100,
      sfoc: 179.2,
    });
  });

  it('restores edited seed rows and republishes the vessels that embed them', async () => {
    const diesel = await seeded('fuels', 'diesel_gas_oil');
    const references = await createReferenceSet(service);
    const vessel = await createVessel(service, org.admin, references, {
      fuelId: diesel.id,
    });
    await probe.next(
      vessel.id,
      (event) => event.envelope.type === EVENT_TYPES.FLEET_VESSEL_UPSERTED,
    );

    bodyOf(
      await service.request(
        SUPER_ADMIN,
        'PATCH',
        `/api/v2/fuels/${diesel.id}`,
        {
          density: 0.9,
        },
      ),
      200,
    );
    await probe.next(
      vessel.id,
      (event) =>
        (event.envelope.data as { fuel?: { density: number } }).fuel
          ?.density === 0.9,
    );

    const report = await seed();
    expect(report.fuels).toEqual({
      inserted: 0,
      updated: 1,
      unchanged: FUEL_SEEDS.length - 1,
    });
    expect(report.republished).toBe(1);
    // The relay publishes the restored value (enqueued in the seed transaction).
    await probe.next(
      vessel.id,
      (event) =>
        (event.envelope.data as { fuel?: { density: number } }).fuel
          ?.density === 0.86,
    );
    expect(await seeded('fuels', 'diesel_gas_oil')).toMatchObject({
      id: diesel.id,
      density: 0.86,
    });
  });
});
