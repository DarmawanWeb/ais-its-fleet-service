import {
  FuelSnapshotSchema,
  VesselTypeSnapshotSchema,
} from '@darmawanweb/ais-its-contracts/events';
import { describe, expect, it } from 'vitest';

import { checkFuelFormula } from '../domain/fuel-formula.js';
import { VESSEL_TYPE_ICONS } from '../modules/vessel-types/dto/vessel-type.dto.js';
import { FUEL_SEEDS } from './fuels.seed.js';
import {
  ENGINE_SEEDS,
  FUEL_FORMULA_SEEDS,
  PORT_SEEDS,
} from './samples.seed.js';
import { VESSEL_TYPE_SEEDS } from './vessel-types.seed.js';

const ID = '01980000-0000-7000-8000-000000000001';

describe('vessel type seeds (MEPC.353(78) / MEPC.354(78))', () => {
  it('has unique codes, increasing rating vectors and a source on every row', () => {
    expect(new Set(VESSEL_TYPE_SEEDS.map((seed) => seed.code)).size).toBe(
      VESSEL_TYPE_SEEDS.length,
    );
    for (const seed of VESSEL_TYPE_SEEDS) {
      expect(
        seed.d1 < seed.d2 && seed.d2 < seed.d3 && seed.d3 < seed.d4,
        seed.code,
      ).toBe(true);
      expect(seed.source, seed.code).toContain('MEPC.353(78)');
      expect(VESSEL_TYPE_ICONS, seed.code).toContain(seed.icon);
      const snapshot = VesselTypeSnapshotSchema.safeParse({
        id: ID,
        code: seed.code,
        name: seed.name,
        capacityUnit: seed.capacityUnit,
        a: seed.a,
        c: seed.c,
        capacityFixed: seed.capacityFixed,
        d: { d1: seed.d1, d2: seed.d2, d3: seed.d3, d4: seed.d4 },
      });
      expect(snapshot.success, seed.code).toBe(true);
    }
  });

  it('carries the regulation-fixed capacities of the three fixed bands', () => {
    const fixed = Object.fromEntries(
      VESSEL_TYPE_SEEDS.filter((seed) => seed.capacityFixed !== null).map(
        (seed) => [seed.code, seed.capacityFixed],
      ),
    );
    expect(fixed).toEqual({
      bulk_carrier_279k_plus: 279_000,
      lng_carrier_below_65k: 65_000,
      roro_vehicle_57700_plus: 57_700,
    });
  });

  it('keeps the golden values of the verified table', () => {
    const byCode = new Map(VESSEL_TYPE_SEEDS.map((seed) => [seed.code, seed]));
    expect(byCode.get('roro_passenger')).toMatchObject({
      capacityUnit: 'GT',
      a: 2023,
      c: 0.46,
      d1: 0.76,
      d2: 0.92,
      d3: 1.14,
      d4: 1.3,
      icon: 'ro-rop',
    });
    expect(byCode.get('gas_carrier_65k_plus')).toMatchObject({
      a: 1.4405e11,
      c: 2.071,
    });
    expect(byCode.get('lng_carrier_below_65k')).toMatchObject({
      a: 1.4779e14,
      c: 2.673,
    });
    expect(byCode.get('lng_carrier_100k_plus')).toMatchObject({
      a: 9.827,
      c: 0,
    });
    expect(byCode.get('general_cargo')).toMatchObject({ a: 588, c: 0.3885 });
    expect(byCode.get('high_speed_craft')?.source).toContain('ASSUMPTION');
    // The 2022 reference line of the sample ro-pax (2,877 GT): 2023 · 2877^-0.46 ≈ 51.87.
    expect(2023 * 2877 ** -0.46).toBeCloseTo(51.866, 2);
  });
});

describe('fuel seeds (MEPC.364(79))', () => {
  it('are valid snapshots with Cf ≈ 44/12 · carbon content and a documented density', () => {
    expect(new Set(FUEL_SEEDS.map((seed) => seed.code)).size).toBe(
      FUEL_SEEDS.length,
    );
    for (const seed of FUEL_SEEDS) {
      expect(
        FuelSnapshotSchema.safeParse({ id: ID, ...seed }).success,
        seed.code,
      ).toBe(true);
      expect(seed.conversionFactor, seed.code).toBeCloseTo(
        (44.01 / 12.011) * seed.carbonContent,
        2,
      );
      expect(seed.source, seed.code).toMatch(/MEPC\.364\(79\).*Density/);
    }
  });

  it('keeps the legacy Diesel/Gas oil sample (Cf 3.206, Cc 0.8744, density 0.86)', () => {
    expect(
      FUEL_SEEDS.find((seed) => seed.code === 'diesel_gas_oil'),
    ).toMatchObject({
      conversionFactor: 3.206,
      carbonContent: 0.8744,
      density: 0.86,
    });
  });
});

describe('sample seeds', () => {
  it('are in the safe formula grammar, keyed by code and documented', () => {
    for (const seed of FUEL_FORMULA_SEEDS) {
      expect(checkFuelFormula(seed.mainEngineFormula).valid).toBe(true);
      expect(checkFuelFormula(seed.auxiliaryEngineFormula).valid).toBe(true);
    }
    for (const seed of [
      ...ENGINE_SEEDS,
      ...FUEL_FORMULA_SEEDS,
      ...PORT_SEEDS,
    ]) {
      expect(seed.source).toContain('needs citation');
    }
    expect(ENGINE_SEEDS.map((seed) => seed.kind)).toEqual([
      'main',
      'auxiliary',
    ]);
    expect(PORT_SEEDS.map((seed) => seed.code)).toEqual(['PBI', 'LMR']);
  });
});
