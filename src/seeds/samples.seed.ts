import type { NewEngine } from '../modules/engines/engines.repository.js';
import type { NewFuelFormula } from '../modules/fuel-formulas/fuel-formulas.repository.js';
import type { NewPort } from '../modules/ports/port.js';

/** Seeded rows are keyed by `code`; the id is assigned on first insert. */
export type EngineSeed = Omit<NewEngine, 'id'> & { readonly code: string };
export type FuelFormulaSeed = Omit<NewFuelFormula, 'id'> & {
  readonly code: string;
};
export type PortSeed = Omit<NewPort, 'id'>;

const SAMPLE_SOURCE =
  'Legacy MVP Postman samples (be-legacy/docs/postman, %s) of the thesis case-study vessel ' +
  'Dharma Ferry VIII (MMSI 525005223, IMO 9037941). SOURCE: thesis — needs citation.';

function sampleSource(collection: string): string {
  return SAMPLE_SOURCE.replace('%s', collection);
}

/**
 * Example engines of the case-study vessel: main engine NIIGATA 6M28BET
 * (2 × 2100 at 390 rpm, SFOC 179.2 g/kWh) and auxiliary generator MAN
 * D2866LE (2 × 276 kW at 1800 rpm, SFOC 207 g/kWh).
 *
 * @method data.sample_vessel_reference
 * @see docs/METHODOLOGY.md — `data.sample_vessel_reference` (the unit of the
 *   2100 rating, kW or PS, is unconfirmed)
 */
export const ENGINE_SEEDS: readonly EngineSeed[] = [
  // SOURCE: thesis — needs citation (engine data sheet of the case-study vessel).
  {
    code: 'niigata_6m28bet',
    kind: 'main',
    name: 'NIIGATA 6M28BET',
    rpm: 390,
    powerKw: 2100,
    sfoc: 179.2,
    source: `${sampleSource('3.5 Ships - Main Engine')} Rating unit (kW or PS) unconfirmed.`,
  },
  // SOURCE: thesis — needs citation (generator data sheet of the case-study vessel).
  {
    code: 'man_d2866le',
    kind: 'auxiliary',
    name: 'MAN D2866LE',
    rpm: 1800,
    powerKw: 276,
    sfoc: 207,
    source: sampleSource('3.6 Ships - Auxiliary Engine'),
  },
];

/**
 * The first fuel formula of the case-study vessel: main engine
 * −0.0382·V² + 0.8658·V − 0.0197 L/min (4.87 L/min at 12 kn) and auxiliary
 * engines 1.5103·e^(−0.064·V) L/min, V = `speedKnot`.
 *
 * @method fuel.me_regression_sample
 * @method fuel.ae_regression
 * @see docs/METHODOLOGY.md §7.2.2 and §7.2.3
 */
export const FUEL_FORMULA_SEEDS: readonly FuelFormulaSeed[] = [
  // SOURCE: thesis — needs citation (regressions fitted to the case-study ferry; valid speed range unknown).
  {
    code: 'dharma_ferry_viii',
    name: 'Dharma Ferry VIII first formula (thesis regression)',
    mainEngineFormula: '-0.0382 * speedKnot ** 2 + 0.8658 * speedKnot - 0.0197',
    auxiliaryEngineFormula: '1.5103 * Math.exp(-0.064 * speedKnot)',
    source: sampleSource('3.7 Ships - First Fuel Formula'),
  },
];

/**
 * Ports of the case-study route Lembar – Padang Bai (positions and
 * Kemendagri area codes of the legacy samples).
 *
 * @method data.sample_vessel_reference
 */
export const PORT_SEEDS: readonly PortSeed[] = [
  {
    name: 'Padang Bai',
    code: 'PBI',
    administrativeLocation: '51.07.03.2009',
    lon: 115.5073505,
    lat: -8.5323949,
    radiusM: null,
    source: sampleSource('4 Port'),
  },
  {
    name: 'Lembar',
    code: 'LMR',
    administrativeLocation: '52.01.13.2001',
    lon: 116.049278,
    lat: -8.7373119,
    radiusM: null,
    source: sampleSource('4 Port'),
  },
];
