import { randomBytes, randomInt } from 'node:crypto';

import { expect } from 'vitest';

import { SAMPLE_DIMENSIONS } from '../fixtures/sample-vessel.js';
import {
  type Actor,
  type InjectResponse,
  SUPER_ADMIN,
  type TestService,
} from './test-service.js';

/** A reference-data code that no other test uses (`<prefix>_<hex>`). */
export function uniqueCode(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString('hex')}`;
}

/** A port code that no other test uses (`[A-Z0-9]{2,16}`). */
export function uniquePortCode(): string {
  return `T${randomBytes(4).toString('hex').toUpperCase()}`;
}

/** A random 9-digit MMSI (collisions between test runs are improbable). */
export function uniqueMmsi(): number {
  return randomInt(200_000_000, 800_000_000);
}

/** A random 7-digit IMO number. */
export function uniqueImo(): string {
  return String(randomInt(1_000_000, 10_000_000));
}

/** The JSON body of a response, checked against the expected status. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names the expected JSON shape, as with light-my-request's json<T>()
export function bodyOf<T = Record<string, unknown>>(
  response: InjectResponse,
  status: number,
): T {
  expect(response.statusCode, response.body).toBe(status);
  return response.json<T>();
}

/** The problem details of an error response (`application/problem+json`). */
export function problemOf(
  response: InjectResponse,
  status: number,
): {
  code: string;
  status: number;
  errors?: { field: string; message: string; code?: string }[];
} {
  expect(response.statusCode, response.body).toBe(status);
  expect(response.headers['content-type']).toContain(
    'application/problem+json',
  );
  return response.json();
}

/** Ids of the reference rows a test vessel points at. */
export interface ReferenceSet {
  readonly typeId: string;
  readonly typeCode: string;
  readonly fuelId: string;
  readonly fuelCode: string;
  readonly mainEngineId: string;
  readonly auxEngineId: string;
  readonly formulaId: string;
  readonly portIds: readonly [string, string];
}

/** Creates a reference row through the API as platform administrator. */
export async function createReference(
  service: TestService,
  path: string,
  body: object,
): Promise<{ id: string } & Record<string, unknown>> {
  return bodyOf(await service.request(SUPER_ADMIN, 'POST', path, body), 201);
}

/**
 * A fresh set of reference data (type, fuel, engines, formula, two ports)
 * with unique codes, shaped like the legacy sample vessel's.
 */
export async function createReferenceSet(
  service: TestService,
): Promise<ReferenceSet> {
  const typeCode = uniqueCode('type');
  const type = await createReference(service, '/api/v2/vessel-types', {
    code: typeCode,
    name: 'Ro-ro passenger ship (test)',
    capacityUnit: 'GT',
    a: 2023,
    c: 0.46,
    d: { d1: 0.76, d2: 0.92, d3: 1.14, d4: 1.3 },
    icon: 'ro-rop',
    source: 'integration test',
  });
  const fuelCode = uniqueCode('fuel');
  const fuel = await createReference(service, '/api/v2/fuels', {
    code: fuelCode,
    name: 'Diesel/Gas oil (test)',
    carbonContent: 0.8744,
    conversionFactor: 3.206,
    density: 0.86,
  });
  const mainEngine = await createReference(service, '/api/v2/engines', {
    kind: 'main',
    name: 'NIIGATA 6M28BET (test)',
    rpm: 390,
    powerKw: 2100,
    sfoc: 179.2,
  });
  const auxEngine = await createReference(service, '/api/v2/engines', {
    kind: 'auxiliary',
    name: 'MAN D2866LE (test)',
    rpm: 1800,
    powerKw: 276,
    sfoc: 207,
  });
  const formula = await createReference(service, '/api/v2/fuel-formulas', {
    name: 'Dharma Ferry VIII (test)',
    mainEngineFormula: '-0.0382 * speedKnot ** 2 + 0.8658 * speedKnot - 0.0197',
    auxiliaryEngineFormula: '1.5103 * Math.exp(-0.064 * speedKnot)',
  });
  const padangBai = await createReference(service, '/api/v2/ports', {
    name: 'Padang Bai (test)',
    code: uniquePortCode(),
    administrativeLocation: '51.07.03.2009',
    location: { type: 'Point', coordinates: [115.5073505, -8.5323949] },
  });
  const lembar = await createReference(service, '/api/v2/ports', {
    name: 'Lembar (test)',
    code: uniquePortCode(),
    location: { type: 'Point', coordinates: [116.049278, -8.7373119] },
  });
  return {
    typeId: type.id,
    typeCode,
    fuelId: fuel.id,
    fuelCode,
    mainEngineId: mainEngine.id,
    auxEngineId: auxEngine.id,
    formulaId: formula.id,
    portIds: [padangBai.id, lembar.id],
  };
}

/** `POST /vessels` body of the legacy sample vessel on the given reference data. */
export function vesselBody(
  references: ReferenceSet,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    mmsi: uniqueMmsi(),
    imo: uniqueImo(),
    name: 'Dharma Ferry VIII',
    flag: 'id',
    builtYear: 1990,
    annualVoyagePercentage: 41.6666666666667,
    typeId: references.typeId,
    fuelId: references.fuelId,
    firstFuelFormulaId: references.formulaId,
    dimensions: { ...SAMPLE_DIMENSIONS },
    engines: [
      { engineId: references.mainEngineId, role: 'main', quantity: 2 },
      { engineId: references.auxEngineId, role: 'auxiliary', quantity: 2 },
    ],
    portIds: [...references.portIds],
    ...overrides,
  };
}

/** Creates a vessel as `actor` and returns its detail view. */
export async function createVessel(
  service: TestService,
  actor: Actor,
  references: ReferenceSet,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; mmsi: number } & Record<string, unknown>> {
  return bodyOf(
    await service.request(
      actor,
      'POST',
      '/api/v2/vessels',
      vesselBody(references, overrides),
    ),
    201,
  );
}
