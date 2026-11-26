import type { NewFuel } from '../modules/fuels/fuels.repository.js';

/** A seeded fuel (the id is assigned on first insert). */
export type FuelSeed = Omit<NewFuel, 'id'>;

const CF_SOURCE =
  'Cf (t CO2/t fuel) and carbon content: IMO MEPC.364(79) (2022 EEDI calculation guidelines), table of ' +
  'conversion factors (verified 2026-11-21 against IMO text extracts).';

/** The catalog reference of the Cf values (docs/references/references.json). */
const REFERENCE_IDS = ['imo-mepc-364-79'] as const;

function fuel(
  code: string,
  name: string,
  carbonContent: number,
  conversionFactor: number,
  density: number,
  densityNote: string,
): FuelSeed {
  return {
    code,
    name,
    carbonContent,
    conversionFactor,
    density,
    source: `${CF_SOURCE} Density (t/m3 = kg/L): ${densityNote} TODO: verify against the bunker delivery note of the vessel.`,
    referenceIds: REFERENCE_IDS,
  };
}

/**
 * Fuels with the CO2 conversion factor Cf and carbon content of MEPC.364(79)
 * and a typical density (t/m³ = kg/L, at 15 °C unless stated): the density
 * converts first-formula litres to tonnes (m [t] = V [L] · ρ / 1000). The
 * densities are not regulated values — ISO 8217 only sets maxima — and are
 * documented per row.
 *
 * @method emission.co2_conversion
 * @method fuel.density_conversion
 * @see https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/MEPCDocuments/MEPC.364(79).pdf
 * @see https://www.iso.org/standard/80579.html — ISO 8217:2024 (density limits of marine fuels)
 */
export const FUEL_SEEDS: readonly FuelSeed[] = [
  // SOURCE: thesis — needs citation (density 0.86 of the legacy Postman sample).
  fuel(
    'diesel_gas_oil',
    'Diesel/Gas oil (ISO 8217 DMX–DMB)',
    0.8744,
    3.206,
    0.86,
    'legacy MVP sample value 0.86 (typical MGO/MDO 0.83-0.89; ISO 8217 DMA max 0.890).',
  ),
  fuel(
    'light_fuel_oil',
    'Light fuel oil (ISO 8217 RMA–RMD)',
    0.8594,
    3.151,
    0.94,
    'typical 0.94 (ISO 8217 RMA 10 max 0.920, RMD 80 max 0.975).',
  ),
  fuel(
    'heavy_fuel_oil',
    'Heavy fuel oil (ISO 8217 RME–RMK)',
    0.8493,
    3.114,
    0.98,
    'typical 0.98 (ISO 8217 RMG 380 max 0.991, RMK max 1.010).',
  ),
  fuel(
    'lpg_propane',
    'LPG (propane)',
    0.8182,
    3.0,
    0.51,
    'liquid propane about 0.507 at 15 °C under pressure.',
  ),
  fuel(
    'lpg_butane',
    'LPG (butane)',
    0.8264,
    3.03,
    0.58,
    'liquid n-butane about 0.584 at 15 °C under pressure.',
  ),
  fuel(
    'ethane',
    'Ethane',
    0.7989,
    2.927,
    0.55,
    'liquid ethane about 0.545 at its boiling point (-89 °C).',
  ),
  fuel(
    'lng',
    'Liquefied natural gas (LNG)',
    0.75,
    2.75,
    0.45,
    'typical 0.45 at -162 °C (0.43-0.47 by composition).',
  ),
  fuel(
    'methanol',
    'Methanol',
    0.375,
    1.375,
    0.796,
    'about 0.796 at 15 °C (0.791 at 20 °C).',
  ),
  fuel(
    'ethanol',
    'Ethanol',
    0.5217,
    1.913,
    0.794,
    'about 0.794 at 15 °C (0.789 at 20 °C).',
  ),
];
