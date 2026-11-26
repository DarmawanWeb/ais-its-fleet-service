import type { NewVesselType } from '../modules/vessel-types/vessel-types.repository.js';

/** A seeded ship type (the id is assigned on first insert). */
export type VesselTypeSeed = Omit<NewVesselType, 'id'>;

const SOURCE =
  'IMO MEPC.353(78) (2022 G2 reference lines) Table 1: a, c and the fixed capacity of the size band; ' +
  'IMO MEPC.354(78) (2022 G4 rating) Table 1: d1..d4 = exp(d_i). Verified 2026-11-21 against IMO text ' +
  'extracts cross-checked with the ClassNK CII guide (official PDFs not fetched): re-verify against the ' +
  'official text before regulatory use.';

/** The catalog references of {@link SOURCE} (docs/references/references.json). */
const REFERENCE_IDS = ['imo-mepc-353-78', 'imo-mepc-354-78'] as const;

type Vector = readonly [number, number, number, number];

function type(
  code: string,
  name: string,
  capacityUnit: 'DWT' | 'GT',
  a: number,
  c: number,
  [d1, d2, d3, d4]: Vector,
  icon: string,
  extra: { readonly capacityFixed?: number; readonly note?: string } = {},
): VesselTypeSeed {
  return {
    code,
    name,
    capacityUnit,
    a,
    c,
    capacityFixed: extra.capacityFixed ?? null,
    d1,
    d2,
    d3,
    d4,
    icon,
    source: extra.note === undefined ? SOURCE : `${SOURCE} Note: ${extra.note}`,
    referenceIds: REFERENCE_IDS,
  };
}

const BULK: Vector = [0.86, 0.94, 1.06, 1.18];
const GENERAL_CARGO: Vector = [0.83, 0.94, 1.06, 1.19];
const LNG_SMALL: Vector = [0.78, 0.92, 1.1, 1.37];
const VEHICLE: Vector = [0.86, 0.94, 1.06, 1.16];
const RORO_PASSENGER: Vector = [0.76, 0.92, 1.14, 1.3];

/**
 * Ship types with the CII reference line CII_ref = a · Capacity^(−c)
 * (MEPC.353(78) G2, Table 1) and the rating vector (MEPC.354(78) G4,
 * Table 1, stored as exp(d_i) like the legacy). Size bands whose regulation
 * uses a constant instead of the ship's DWT/GT carry it as `capacityFixed`:
 * the CII calculation (emission service, `ciiCapacity`) uses it when set.
 * `icon` maps the legacy web icons (`fe-legacy/public/ships/<icon>.png`).
 *
 * Legacy parity: the MVP database used the 2021 ro-ro passenger values
 * (a 7540, c 0.587, d 0.72/0.90/1.12/1.41 from MEPC.337(76)/MEPC.339(76));
 * new installs get the 2022 values below, imported legacy types keep theirs.
 *
 * @method cii.reference_line
 * @method cii.rating_grade
 * @see https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/MEPCDocuments/MEPC.353(78).pdf
 * @see https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/MEPCDocuments/MEPC.354(78).pdf
 */
export const VESSEL_TYPE_SEEDS: readonly VesselTypeSeed[] = [
  type(
    'bulk_carrier_279k_plus',
    'Bulk carrier (≥ 279,000 DWT)',
    'DWT',
    4745,
    0.622,
    BULK,
    'bulkca',
    {
      capacityFixed: 279_000,
      note: 'size band >= 279,000 DWT uses the fixed capacity 279,000.',
    },
  ),
  type(
    'bulk_carrier',
    'Bulk carrier (< 279,000 DWT)',
    'DWT',
    4745,
    0.622,
    BULK,
    'bulkca',
  ),
  type(
    'gas_carrier_65k_plus',
    'Gas carrier (≥ 65,000 DWT)',
    'DWT',
    14405e7,
    2.071,
    [0.81, 0.91, 1.12, 1.44],
    'gascar',
  ),
  type(
    'gas_carrier',
    'Gas carrier (< 65,000 DWT)',
    'DWT',
    8104,
    0.639,
    [0.85, 0.95, 1.06, 1.25],
    'gascar',
  ),
  type(
    'tanker',
    'Tanker',
    'DWT',
    5247,
    0.61,
    [0.82, 0.93, 1.08, 1.28],
    'tanker',
  ),
  type(
    'container_ship',
    'Container ship',
    'DWT',
    1984,
    0.489,
    [0.83, 0.94, 1.07, 1.19],
    'contai',
  ),
  type(
    'general_cargo_20k_plus',
    'General cargo ship (≥ 20,000 DWT)',
    'DWT',
    31948,
    0.792,
    GENERAL_CARGO,
    'genera',
  ),
  type(
    'general_cargo',
    'General cargo ship (< 20,000 DWT)',
    'DWT',
    588,
    0.3885,
    GENERAL_CARGO,
    'genera',
  ),
  type(
    'refrigerated_cargo',
    'Refrigerated cargo carrier',
    'DWT',
    4600,
    0.557,
    [0.78, 0.91, 1.07, 1.2],
    'refrig',
  ),
  type(
    'combination_carrier',
    'Combination carrier',
    'DWT',
    5119,
    0.622,
    [0.87, 0.96, 1.06, 1.14],
    'combin',
  ),
  type(
    'lng_carrier_100k_plus',
    'LNG carrier (≥ 100,000 DWT)',
    'DWT',
    9.827,
    0,
    [0.89, 0.98, 1.06, 1.13],
    'lngcar',
    {
      note: 'c = 0: the reference value does not depend on capacity.',
    },
  ),
  type(
    'lng_carrier_65k_100k',
    'LNG carrier (65,000–100,000 DWT)',
    'DWT',
    14479e10,
    2.673,
    LNG_SMALL,
    'lngcar',
  ),
  type(
    'lng_carrier_below_65k',
    'LNG carrier (< 65,000 DWT)',
    'DWT',
    14779e10,
    2.673,
    LNG_SMALL,
    'lngcar',
    {
      capacityFixed: 65_000,
      note:
        'size band < 65,000 DWT uses the fixed capacity 65,000; a = 14779E10 as printed in MEPC.353(78) ' +
        'Table 1 (differs from the 65,000-100,000 band 14479E10) — kept as printed.',
    },
  ),
  type(
    'roro_vehicle_57700_plus',
    'Ro-ro cargo ship, vehicle carrier (≥ 57,700 GT)',
    'GT',
    3627,
    0.59,
    VEHICLE,
    'ro-rov',
    {
      capacityFixed: 57_700,
      note: 'size band >= 57,700 GT uses the fixed capacity 57,700.',
    },
  ),
  type(
    'roro_vehicle_30k_57700',
    'Ro-ro cargo ship, vehicle carrier (30,000–57,700 GT)',
    'GT',
    3627,
    0.59,
    VEHICLE,
    'ro-rov',
  ),
  type(
    'roro_vehicle_below_30k',
    'Ro-ro cargo ship, vehicle carrier (< 30,000 GT)',
    'GT',
    330,
    0.329,
    VEHICLE,
    'ro-rov',
  ),
  type(
    'roro_cargo',
    'Ro-ro cargo ship',
    'GT',
    1967,
    0.485,
    [0.76, 0.89, 1.08, 1.27],
    'ro-roc',
    {
      note: 'capacity basis GT per G1/G2/G4.',
    },
  ),
  type(
    'roro_passenger',
    'Ro-ro passenger ship',
    'GT',
    2023,
    0.46,
    RORO_PASSENGER,
    'ro-rop',
    {
      note: 'the legacy database used the revoked 2021 values (a 7540, c 0.587, d 0.72/0.90/1.12/1.41).',
    },
  ),
  type(
    'high_speed_craft',
    'High-speed craft (SOLAS ch. X)',
    'GT',
    4196,
    0.46,
    RORO_PASSENGER,
    'ro-rop',
    {
      note: 'ASSUMPTION: G4 has no separate high-speed craft row; the ro-ro passenger rating vector is borrowed.',
    },
  ),
  type(
    'cruise_passenger',
    'Cruise passenger ship',
    'GT',
    930,
    0.383,
    [0.87, 0.95, 1.06, 1.16],
    'cruise',
  ),
];
