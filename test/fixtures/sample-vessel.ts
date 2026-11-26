import type {
  Engine,
  VesselAggregate,
  VesselDimensions,
} from '../../src/domain/vessel.js';

/** Fixed times of the fixture. */
export const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');
export const UPDATED_AT = new Date('2026-03-01T12:00:00.000Z');

/**
 * Dimensions of the thesis case-study vessel Dharma Ferry VIII exactly as in
 * the legacy Postman sample `3.2 Ships - Size` (`bulbosbow` → `bulbousBow`).
 */
export const SAMPLE_DIMENSIONS: VesselDimensions = {
  capacity: 2877,
  dwt: null,
  gt: 2877,
  cb: 0.644818,
  lwl: 69.72,
  b: 16.3,
  t: 4.1,
  cwp: 0.753,
  loa: 73.3,
  lpp: 66.4,
  cp: 0.673,
  cm: 0.9806,
  cbnsp: 0.661,
  bulbousBow: false,
  cstern: 8,
  c1: 1,
  c2: 1,
  c3: 1,
  c5: 1.5,
  vs: 12,
};

export const MAIN_ENGINE: Engine = {
  id: '01980000-0000-7000-8000-000000000101',
  code: 'niigata_6m28bet',
  kind: 'main',
  name: 'NIIGATA 6M28BET',
  rpm: 390,
  powerKw: 2100,
  sfoc: 179.2,
  source: null,
  referenceIds: [],
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

export const AUX_ENGINE: Engine = {
  id: '01980000-0000-7000-8000-000000000102',
  code: 'man_d2866le',
  kind: 'auxiliary',
  name: 'MAN D2866LE',
  rpm: 1800,
  powerKw: 276,
  sfoc: 207,
  source: null,
  referenceIds: [],
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

export const PORT_IDS = [
  '01980000-0000-7000-8000-000000000201',
  '01980000-0000-7000-8000-000000000202',
] as const;

/** The legacy Postman sample vessel (`3.8 Ships`) as a v2 aggregate. */
export function sampleAggregate(
  overrides: Partial<VesselAggregate> = {},
): VesselAggregate {
  return {
    vessel: {
      id: '01980000-0000-7000-8000-000000000001',
      orgId: '01980000-0000-7000-8000-0000000000a1',
      mmsi: 525005223,
      imo: '9037941',
      name: 'Dharma Ferry VIII',
      flag: 'ID',
      builtYear: null,
      status: 'active',
      annualVoyagePercentage: 41.6666666666667,
      photoKey: null,
      typeId: '01980000-0000-7000-8000-000000000301',
      fuelId: '01980000-0000-7000-8000-000000000401',
      firstFuelFormulaId: '01980000-0000-7000-8000-000000000501',
      legacyId: '683ab0e288e28cca4c61173a',
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    },
    dimensions: SAMPLE_DIMENSIONS,
    type: {
      id: '01980000-0000-7000-8000-000000000301',
      code: 'roro_passenger',
      name: 'Ro-ro passenger ship',
      capacityUnit: 'GT',
      a: 2023,
      c: 0.46,
      capacityFixed: null,
      d1: 0.76,
      d2: 0.92,
      d3: 1.14,
      d4: 1.3,
      icon: 'ro-rop',
      source: null,
      referenceIds: [],
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    },
    fuel: {
      id: '01980000-0000-7000-8000-000000000401',
      code: 'diesel_gas_oil',
      name: 'Diesel/Gas oil',
      carbonContent: 0.8744,
      conversionFactor: 3.206,
      density: 0.86,
      source: null,
      referenceIds: [],
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    },
    firstFuelFormula: {
      id: '01980000-0000-7000-8000-000000000501',
      code: 'dharma_ferry_viii',
      name: 'Dharma Ferry VIII first formula',
      mainEngineFormula:
        '-0.0382 * speedKnot ** 2 + 0.8658 * speedKnot - 0.0197',
      auxiliaryEngineFormula: '1.5103 * Math.exp(-0.064 * speedKnot)',
      source: null,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    },
    engines: [
      { role: 'main', quantity: 2, engine: MAIN_ENGINE },
      { role: 'auxiliary', quantity: 2, engine: AUX_ENGINE },
    ],
    portIds: [...PORT_IDS],
    ...overrides,
  };
}
