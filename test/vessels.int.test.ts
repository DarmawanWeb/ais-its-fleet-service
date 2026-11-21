import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SAMPLE_DIMENSIONS } from './fixtures/sample-vessel.js';
import {
  bodyOf,
  createReferenceSet,
  createVessel,
  problemOf,
  type ReferenceSet,
  uniqueMmsi,
  vesselBody,
} from './support/fleet-fixtures.js';
import {
  newOrganization,
  SUPER_ADMIN,
  startTestService,
  type TestService,
} from './support/test-service.js';

/** The identity fields every tenant sees (spec §8.5). */
const SUMMARY_KEYS = [
  'flag',
  'id',
  'imo',
  'mmsi',
  'name',
  'photoUrl',
  'status',
  'type',
  'updatedAt',
  'view',
];

interface VesselJson {
  id: string;
  mmsi: number;
  view: 'summary' | 'detail';
  [key: string]: unknown;
}

describe('vessels: CRUD, validation and tenancy', () => {
  let service: TestService;
  let references: ReferenceSet;
  const orgA = newOrganization();
  const orgB = newOrganization();

  beforeAll(async () => {
    service = await startTestService();
    references = await createReferenceSet(service);
  });

  afterAll(async () => {
    await service.app.close();
  });

  it('creates a vessel in the active organization and returns its detail view', async () => {
    const body = vesselBody(references);
    const created = bodyOf<VesselJson>(
      await service.request(orgA.fleetManager, 'POST', '/api/v2/vessels', body),
      201,
    );

    expect(created).toMatchObject({
      view: 'detail',
      orgId: orgA.id,
      mmsi: body.mmsi,
      imo: body.imo,
      name: 'Dharma Ferry VIII',
      flag: 'ID',
      builtYear: 1990,
      status: 'active',
      annualVoyagePercentage: 41.6666666666667,
      photoUrl: null,
      legacyId: null,
      dimensions: SAMPLE_DIMENSIONS,
      type: {
        id: references.typeId,
        code: references.typeCode,
        capacityUnit: 'GT',
        a: 2023,
        c: 0.46,
        capacityFixed: null,
        d: { d1: 0.76, d2: 0.92, d3: 1.14, d4: 1.3 },
      },
      fuel: { id: references.fuelId, conversionFactor: 3.206, density: 0.86 },
      firstFuelFormula: { id: references.formulaId },
      engines: [
        {
          role: 'main',
          quantity: 2,
          engine: { id: references.mainEngineId, kind: 'main', powerKw: 2100 },
        },
        {
          role: 'auxiliary',
          quantity: 2,
          engine: { id: references.auxEngineId, kind: 'auxiliary' },
        },
      ],
      ports: [{ id: references.portIds[0] }, { id: references.portIds[1] }],
    });

    const byId = bodyOf<VesselJson>(
      await service.request(
        orgA.viewer,
        'GET',
        `/api/v2/vessels/${created.id}`,
      ),
      200,
    );
    expect(byId).toEqual(created);
    const byMmsi = bodyOf<VesselJson>(
      await service.request(
        orgA.viewer,
        'GET',
        `/api/v2/vessels/by-mmsi/${created.mmsi}`,
      ),
      200,
    );
    expect(byMmsi.id).toBe(created.id);
  });

  it('refuses invalid payloads with 400 VALIDATION_FAILED and the offending fields', async () => {
    const invalid = async (
      body: Record<string, unknown>,
    ): Promise<string[]> => {
      const problem = problemOf(
        await service.request(
          orgA.fleetManager,
          'POST',
          '/api/v2/vessels',
          body,
        ),
        400,
      );
      expect(problem.code).toBe('VALIDATION_FAILED');
      return (problem.errors ?? []).map((error) => error.field);
    };

    expect(await invalid(vesselBody(references, { mmsi: 12_345 }))).toEqual([
      'mmsi',
    ]);
    expect(await invalid(vesselBody(references, { imo: 'IMO1' }))).toEqual([
      'imo',
    ]);
    expect(
      await invalid(vesselBody(references, { dimensions: undefined })),
    ).toContain('dimensions');
    expect(
      await invalid(
        vesselBody(references, {
          dimensions: { ...SAMPLE_DIMENSIONS, cb: -1, bulbousBow: 'yes' },
        }),
      ),
    ).toEqual(
      expect.arrayContaining(['dimensions.cb', 'dimensions.bulbousBow']),
    );
    expect(
      await invalid(vesselBody(references, { annualVoyagePercentage: 120 })),
    ).toEqual(['annualVoyagePercentage']);
    expect(await invalid(vesselBody(references, { unexpected: true }))).toEqual(
      ['unexpected'],
    );
    // Unknown references are field errors too, not 404/500.
    expect(
      await invalid(vesselBody(references, { typeId: randomUUID() })),
    ).toEqual(['typeId']);
    expect(
      await invalid(
        vesselBody(references, {
          engines: [
            {
              engineId: references.mainEngineId,
              role: 'auxiliary',
              quantity: 1,
            },
          ],
        }),
      ),
    ).toEqual(['engines.0.role']);
    expect(
      await invalid(
        vesselBody(references, {
          engines: [
            { engineId: references.mainEngineId, role: 'main', quantity: 1 },
            { engineId: references.mainEngineId, role: 'main', quantity: 1 },
          ],
        }),
      ),
    ).toEqual(expect.arrayContaining(['engines.1.engineId', 'engines.role']));
    expect(
      await invalid(
        vesselBody(references, {
          portIds: [references.portIds[0], randomUUID()],
        }),
      ),
    ).toEqual(['portIds.1']);

    // Nothing was written by the refused requests.
    const list = bodyOf<{ meta: { total: number } }>(
      await service.request(
        orgA.viewer,
        'GET',
        `/api/v2/vessels?orgId=${orgA.id}&search=Dharma`,
      ),
      200,
    );
    expect(list.meta.total).toBe(1);
  });

  it('refuses duplicate MMSI and IMO numbers with 409', async () => {
    const existing = await createVessel(service, orgA.admin, references);
    const sameMmsi = problemOf(
      await service.request(
        orgB.admin,
        'POST',
        '/api/v2/vessels',
        vesselBody(references, { mmsi: existing.mmsi }),
      ),
      409,
    );
    expect(sameMmsi.code).toBe('MMSI_ALREADY_EXISTS');
    const sameImo = problemOf(
      await service.request(
        orgB.admin,
        'POST',
        '/api/v2/vessels',
        vesselBody(references, { imo: existing.imo }),
      ),
      409,
    );
    expect(sameImo.code).toBe('IMO_ALREADY_EXISTS');
  });

  it('answers 404 and 400 for unknown or malformed vessel keys', async () => {
    expect(
      problemOf(
        await service.request(
          orgA.viewer,
          'GET',
          `/api/v2/vessels/${randomUUID()}`,
        ),
        404,
      ).code,
    ).toBe('VESSEL_NOT_FOUND');
    expect(
      problemOf(
        await service.request(
          orgA.viewer,
          'GET',
          `/api/v2/vessels/by-mmsi/${uniqueMmsi()}`,
        ),
        404,
      ).code,
    ).toBe('VESSEL_NOT_FOUND');
    expect(
      problemOf(
        await service.request(orgA.viewer, 'GET', '/api/v2/vessels/not-a-uuid'),
        400,
      ).code,
    ).toBe('VALIDATION_FAILED');
    expect(
      problemOf(
        await service.request(
          orgA.viewer,
          'GET',
          '/api/v2/vessels/by-mmsi/abc',
        ),
        400,
      ).code,
    ).toBe('VALIDATION_FAILED');
    expect(
      (await service.request(null, 'GET', '/api/v2/vessels')).statusCode,
    ).toBe(401);
  });

  it('creates vessels only in the active organization unless platform administrator', async () => {
    const foreign = problemOf(
      await service.request(
        orgA.fleetManager,
        'POST',
        '/api/v2/vessels',
        vesselBody(references, { orgId: orgB.id }),
      ),
      403,
    );
    expect(foreign.code).toBe('FORBIDDEN');
    const ownOrgExplicitly = await createVessel(
      service,
      orgA.fleetManager,
      references,
      { orgId: orgA.id },
    );
    expect(ownOrgExplicitly.orgId).toBe(orgA.id);

    const noOrganization = problemOf(
      await service.request(
        { roles: ['fleet_manager'], orgId: null },
        'POST',
        '/api/v2/vessels',
        vesselBody(references),
      ),
      403,
    );
    expect(noOrganization.code).toBe('ORGANIZATION_REQUIRED');

    for (const actor of [orgA.viewer, orgA.authority]) {
      problemOf(
        await service.request(
          actor,
          'POST',
          '/api/v2/vessels',
          vesselBody(references),
        ),
        403,
      );
    }

    const legacy = problemOf(
      await service.request(
        orgA.admin,
        'POST',
        '/api/v2/vessels',
        vesselBody(references, { legacyId: '683ab0e288e28cca4c61173a' }),
      ),
      403,
    );
    expect(legacy.code).toBe('PLATFORM_ADMIN_REQUIRED');

    const forOrgB = await createVessel(service, SUPER_ADMIN, references, {
      orgId: orgB.id,
      legacyId: randomUUID().replaceAll('-', '').slice(0, 24),
    });
    expect(forOrgB.orgId).toBe(orgB.id);
    const platformOwned = await createVessel(service, SUPER_ADMIN, references);
    expect(platformOwned.orgId).toBeNull();
  });

  it('shares identity with every tenant and technical data only with the owner', async () => {
    const vessel = await createVessel(service, orgA.admin, references, {
      name: 'Tenancy Probe',
    });
    const url = `/api/v2/vessels/${vessel.id}`;

    for (const outsider of [orgB.viewer, orgB.authority, orgB.admin]) {
      const summary = bodyOf<VesselJson>(
        await service.request(outsider, 'GET', url),
        200,
      );
      expect(summary.view).toBe('summary');
      expect(Object.keys(summary).sort()).toEqual(SUMMARY_KEYS);
      expect(summary).toMatchObject({
        id: vessel.id,
        mmsi: vessel.mmsi,
        name: 'Tenancy Probe',
        type: { id: references.typeId, code: references.typeCode },
      });
      expect(Object.keys(summary.type as object).sort()).toEqual([
        'code',
        'icon',
        'id',
        'name',
      ]);
    }
    for (const insider of [orgA.viewer, SUPER_ADMIN]) {
      const detail = bodyOf<VesselJson>(
        await service.request(insider, 'GET', url),
        200,
      );
      expect(detail.view).toBe('detail');
      expect(detail).toHaveProperty('dimensions');
      expect(detail).toHaveProperty('engines');
    }

    // Lists apply the same rule per row.
    const listed = bodyOf<{ data: VesselJson[] }>(
      await service.request(
        orgB.viewer,
        'GET',
        `/api/v2/vessels?search=${vessel.mmsi}`,
      ),
      200,
    );
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0]?.view).toBe('summary');
    expect(listed.data[0]).not.toHaveProperty('fuel');

    // Filtering by another tenant would reveal its fleet.
    problemOf(
      await service.request(
        orgB.viewer,
        'GET',
        `/api/v2/vessels?orgId=${orgA.id}`,
      ),
      403,
    );
    const adminView = bodyOf<{ data: VesselJson[] }>(
      await service.request(
        SUPER_ADMIN,
        'GET',
        `/api/v2/vessels?orgId=${orgA.id}&pageSize=100`,
      ),
      200,
    );
    expect(adminView.data.every((row) => row.orgId === orgA.id)).toBe(true);
    expect(adminView.data.map((row) => row.id)).toContain(vessel.id);
  });

  it('changes and deletes only vessels of the own organization', async () => {
    const vessel = await createVessel(service, orgA.admin, references);
    const url = `/api/v2/vessels/${vessel.id}`;

    expect(
      problemOf(
        await service.request(orgB.admin, 'PATCH', url, { name: 'Hijacked' }),
        403,
      ).code,
    ).toBe('FORBIDDEN');
    problemOf(
      await service.request(orgA.viewer, 'PATCH', url, { name: 'Viewer' }),
      403,
    );
    expect(
      problemOf(
        await service.request(orgA.admin, 'PATCH', url, { orgId: orgB.id }),
        403,
      ).code,
    ).toBe('PLATFORM_ADMIN_REQUIRED');

    const updated = bodyOf<VesselJson>(
      await service.request(orgA.fleetManager, 'PATCH', url, {
        name: '  Dharma Ferry IX ',
        status: 'laid_up',
        imo: null,
        firstFuelFormulaId: null,
      }),
      200,
    );
    expect(updated).toMatchObject({
      name: 'Dharma Ferry IX',
      status: 'laid_up',
      imo: null,
      firstFuelFormula: null,
    });
    expect(Date.parse(updated.updatedAt as string)).toBeGreaterThan(
      Date.parse(vessel.updatedAt as string),
    );
    expect(
      problemOf(
        await service.request(orgA.admin, 'PATCH', url, { status: 'sunk' }),
        400,
      ).errors?.map((error) => error.field),
    ).toEqual(['status']);

    const resized = bodyOf<VesselJson>(
      await service.request(orgA.admin, 'PUT', `${url}/dimensions`, {
        ...SAMPLE_DIMENSIONS,
        capacity: 3000,
        bulbousBow: true,
        vs: 13.5,
      }),
      200,
    );
    expect(resized.dimensions).toMatchObject({
      capacity: 3000,
      bulbousBow: true,
      vs: 13.5,
    });

    const refitted = bodyOf<VesselJson>(
      await service.request(orgA.admin, 'PUT', `${url}/engines`, [
        { engineId: references.mainEngineId, role: 'main', quantity: 1 },
      ]),
      200,
    );
    expect(refitted.engines).toEqual([
      expect.objectContaining({ role: 'main', quantity: 1 }),
    ]);
    const badEngines = problemOf(
      await service.request(orgA.admin, 'PUT', `${url}/engines`, [
        { engineId: references.auxEngineId, role: 'main', quantity: 0 },
      ]),
      400,
    );
    expect(badEngines.errors?.map((error) => error.field)).toEqual([
      '0.quantity',
    ]);
    problemOf(
      await service.request(orgA.admin, 'PUT', `${url}/engines`, {
        engineId: references.mainEngineId,
      }),
      400,
    );

    const reordered = bodyOf<VesselJson>(
      await service.request(orgA.admin, 'PUT', `${url}/ports`, [
        references.portIds[1],
        references.portIds[0],
      ]),
      200,
    );
    expect(
      (reordered.ports as { id: string }[]).map((port) => port.id),
    ).toEqual([references.portIds[1], references.portIds[0]]);
    expect(
      problemOf(
        await service.request(orgA.admin, 'PUT', `${url}/ports`, [
          references.portIds[0],
          references.portIds[0],
        ]),
        400,
      ).errors?.map((error) => error.field),
    ).toEqual(['1']);

    problemOf(await service.request(orgB.admin, 'DELETE', url), 403);
    expect(
      (await service.request(orgA.fleetManager, 'DELETE', url)).statusCode,
    ).toBe(204);
    expect(
      problemOf(await service.request(orgA.viewer, 'GET', url), 404).code,
    ).toBe('VESSEL_NOT_FOUND');
    problemOf(await service.request(orgA.admin, 'DELETE', url), 404);
  });

  it('lists with search, filters and page-based pagination', async () => {
    const orgC = newOrganization();
    const names = ['KM Alpha Lestari', 'KM Beta Lestari', 'TB Gamma'];
    const created = [];
    for (const name of names) {
      created.push(
        await createVessel(service, orgC.admin, references, {
          name,
          status: name.startsWith('TB') ? 'inactive' : 'active',
        }),
      );
    }
    const list = async (query: string) =>
      bodyOf<{
        data: VesselJson[];
        meta: { page: number; pageSize: number; total: number };
      }>(
        await service.request(
          orgC.viewer,
          'GET',
          `/api/v2/vessels?orgId=${orgC.id}&${query}`,
        ),
        200,
      );

    const first = await list('pageSize=2&page=1');
    expect(first.meta).toEqual({ page: 1, pageSize: 2, total: 3 });
    expect(first.data).toHaveLength(2);
    const second = await list('pageSize=2&page=2');
    expect(second.data).toHaveLength(1);
    expect(
      new Set([...first.data, ...second.data].map((row) => row.id)),
    ).toEqual(new Set(created.map((row) => row.id)));

    expect((await list('search=lestari')).meta.total).toBe(2);
    expect((await list('status=inactive')).data.map((row) => row.name)).toEqual(
      ['TB Gamma'],
    );
    expect((await list(`typeCode=${references.typeCode}`)).meta.total).toBe(3);
    expect((await list('typeCode=no_such_type')).meta.total).toBe(0);
    const target = created[1];
    expect(
      (await list(`search=${String(target?.mmsi).slice(0, 6)}`)).data.map(
        (row) => row.id,
      ),
    ).toContain(target?.id);
    problemOf(
      await service.request(orgC.viewer, 'GET', '/api/v2/vessels?pageSize=101'),
      400,
    );
  });
});
