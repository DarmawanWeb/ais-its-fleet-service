/**
 * Ids of the methodology catalog methods this service implements
 * (docs/references/methods.json, docs/PLATFORM_SPEC.md §17). Keep it in sync
 * with the `@method` TSDoc tags of the implementing functions and with the
 * README section "Methodology & references".
 */
export const IMPLEMENTED_METHOD_IDS: readonly string[] = [
  // Safe grammar of the first-fuel-formula strings (validated on write).
  'fuel.first_formula',
  // Seeded reference data: reference lines, fixed capacities, rating vectors.
  'cii.reference_line',
  'cii.rating_grade',
  // Seeded fuels: Cf and carbon content, densities.
  'emission.co2_conversion',
  'fuel.density_conversion',
  // Seeded sample formula and engines of the case-study vessel.
  'fuel.me_regression_sample',
  'fuel.ae_regression',
  'data.sample_vessel_reference',
];
