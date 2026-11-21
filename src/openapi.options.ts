import type { OpenApiOptions } from '@darmawanweb/ais-its-nest';

import { SERVICE } from './service.js';

/** OpenAPI document of the service (`/docs`, `/openapi.json`, `pnpm openapi`). */
export const OPENAPI: OpenApiOptions = {
  title: `AIS Maritime Intelligence — ${SERVICE.title}`,
  version: SERVICE.version,
  description: SERVICE.description,
  tags: [
    {
      name: 'methodology',
      description: 'Methods of the methodology catalog implemented here',
    },
    {
      name: 'vessels',
      description:
        'Vessels: identity for every tenant, technical data for the owning organization (spec §8.5)',
    },
    {
      name: 'vessel-types',
      description:
        'Ship types with CII reference lines (MEPC.353(78)) and rating vectors (MEPC.354(78))',
    },
    {
      name: 'fuels',
      description:
        'Fuels with CO2 conversion factors Cf (MEPC.364(79)) and densities',
    },
    { name: 'engines', description: 'Main and auxiliary engine catalogue' },
    {
      name: 'fuel-formulas',
      description: 'First fuel formulas (safe expressions of speedKnot)',
    },
    { name: 'ports', description: 'Ports of call (GeoJSON points)' },
    {
      name: 'registry',
      description: 'Registry particulars of ships (legacy secondary ship data)',
    },
  ],
};
