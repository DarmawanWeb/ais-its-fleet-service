import {
  VesselDeletedV1Schema,
  VesselSnapshotV1Schema,
} from '@darmawanweb/ais-its-contracts/events';
import { describe, expect, it } from 'vitest';

import {
  AUX_ENGINE,
  MAIN_ENGINE,
  PORT_IDS,
  SAMPLE_DIMENSIONS,
  sampleAggregate,
  UPDATED_AT,
} from '../../test/fixtures/sample-vessel.js';
import { toVesselDeleted, toVesselSnapshot } from './vessel-snapshot.js';

describe('toVesselSnapshot', () => {
  it('maps the legacy sample vessel to a valid VesselSnapshotV1', () => {
    const snapshot = toVesselSnapshot(sampleAggregate());

    expect(VesselSnapshotV1Schema.safeParse(snapshot).success).toBe(true);
    expect(snapshot).toEqual({
      id: '01980000-0000-7000-8000-000000000001',
      orgId: '01980000-0000-7000-8000-0000000000a1',
      mmsi: 525005223,
      imo: '9037941',
      name: 'Dharma Ferry VIII',
      flag: 'ID',
      builtYear: null,
      status: 'active',
      annualVoyagePercentage: 41.6666666666667,
      dimensions: SAMPLE_DIMENSIONS,
      type: {
        id: '01980000-0000-7000-8000-000000000301',
        code: 'roro_passenger',
        name: 'Ro-ro passenger ship',
        capacityUnit: 'GT',
        a: 2023,
        c: 0.46,
        capacityFixed: null,
        d: { d1: 0.76, d2: 0.92, d3: 1.14, d4: 1.3 },
      },
      fuel: {
        id: '01980000-0000-7000-8000-000000000401',
        code: 'diesel_gas_oil',
        name: 'Diesel/Gas oil',
        carbonContent: 0.8744,
        conversionFactor: 3.206,
        density: 0.86,
      },
      mainEngine: {
        id: MAIN_ENGINE.id,
        name: 'NIIGATA 6M28BET',
        rpm: 390,
        powerKw: 2100,
        sfoc: 179.2,
        quantity: 2,
      },
      // Legacy shape: one entry per physical auxiliary engine.
      auxEngines: [
        {
          id: AUX_ENGINE.id,
          name: 'MAN D2866LE',
          rpm: 1800,
          powerKw: 276,
          sfoc: 207,
        },
        {
          id: AUX_ENGINE.id,
          name: 'MAN D2866LE',
          rpm: 1800,
          powerKw: 276,
          sfoc: 207,
        },
      ],
      auxEngineQuantity: 2,
      firstFuelFormula: {
        id: '01980000-0000-7000-8000-000000000501',
        mainEngineFormula:
          '-0.0382 * speedKnot ** 2 + 0.8658 * speedKnot - 0.0197',
        auxiliaryEngineFormula: '1.5103 * Math.exp(-0.064 * speedKnot)',
      },
      portIds: [...PORT_IDS],
      updatedAt: UPDATED_AT.toISOString(),
    });
  });

  it('carries the fixed capacity of a size band', () => {
    const aggregate = sampleAggregate();
    const snapshot = toVesselSnapshot({
      ...aggregate,
      type: {
        ...aggregate.type,
        code: 'bulk_carrier_279k_plus',
        capacityUnit: 'DWT',
        capacityFixed: 279_000,
      },
    });
    expect(snapshot.type).toMatchObject({
      capacityFixed: 279_000,
      capacityUnit: 'DWT',
    });
  });

  it('expands mixed auxiliary rows and allows a vessel without engines or formula', () => {
    const other = {
      ...AUX_ENGINE,
      id: '01980000-0000-7000-8000-000000000103',
      name: 'Emergency set',
    };
    const mixed = toVesselSnapshot(
      sampleAggregate({
        engines: [
          { role: 'auxiliary', quantity: 2, engine: AUX_ENGINE },
          { role: 'auxiliary', quantity: 1, engine: other },
        ],
      }),
    );
    expect(mixed.mainEngine).toBeNull();
    expect(mixed.auxEngines.map((engine) => engine.name)).toEqual([
      'MAN D2866LE',
      'MAN D2866LE',
      'Emergency set',
    ]);
    expect(mixed.auxEngineQuantity).toBe(3);

    const bare = toVesselSnapshot(
      sampleAggregate({ engines: [], firstFuelFormula: null, portIds: [] }),
    );
    expect(bare).toMatchObject({
      mainEngine: null,
      auxEngines: [],
      auxEngineQuantity: 0,
      firstFuelFormula: null,
      portIds: [],
    });
    expect(VesselSnapshotV1Schema.safeParse(bare).success).toBe(true);
  });

  it('keeps a platform-owned vessel (orgId null)', () => {
    const aggregate = sampleAggregate();
    const snapshot = toVesselSnapshot({
      ...aggregate,
      vessel: { ...aggregate.vessel, orgId: null },
    });
    expect(snapshot.orgId).toBeNull();
    expect(VesselSnapshotV1Schema.safeParse(snapshot).success).toBe(true);
  });
});

describe('toVesselDeleted', () => {
  it('builds the tombstone payload', () => {
    const tombstone = toVesselDeleted(sampleAggregate().vessel);
    expect(tombstone).toEqual({
      id: '01980000-0000-7000-8000-000000000001',
      mmsi: 525005223,
      orgId: '01980000-0000-7000-8000-0000000000a1',
    });
    expect(VesselDeletedV1Schema.safeParse(tombstone).success).toBe(true);
  });
});
