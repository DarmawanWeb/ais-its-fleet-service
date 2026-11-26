import { randomUUID } from 'node:crypto';

import { PG_POOL, type Pool } from '@darmawanweb/ais-its-nest/db';
import { waitFor } from '@darmawanweb/ais-its-nest/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  bodyOf,
  createReference,
  createReferenceSet,
  createVessel,
  fieldsOf,
  problemOf,
  uniqueCode,
  uniquePortCode,
} from './support/fleet-fixtures.js';
import {
  newOrganization,
  SUPER_ADMIN,
  startTestService,
  type TestService,
} from './support/test-service.js';

interface Page<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}

describe('reference data: vessel types, fuels, engines, fuel formulas, ports', () => {
  let service: TestService;
  let pool: Pool;
  const org = newOrganization();

  beforeAll(async () => {
    service = await startTestService();
    pool = service.app.get<unknown, Pool>(PG_POOL);
  });

  afterAll(async () => {
    await service.app.close();
  });

  it('reads reference data with vessel:read and writes it with reference:write only', async () => {
    for (const path of [
      '/api/v2/vessel-types',
      '/api/v2/fuels',
      '/api/v2/engines',
      '/api/v2/fuel-formulas',
      '/api/v2/ports',
    ]) {
      bodyOf(await service.request(org.viewer, 'GET', path), 200);
      expect((await service.request(null, 'GET', path)).statusCode).toBe(401);
      // reference:write is a platform permission (spec §8.4).
      for (const actor of [org.admin, org.fleetManager, org.authority]) {
        problemOf(await service.request(actor, 'POST', path, {}), 403);
      }
    }
  });

  it('manages vessel types with CII parameters and a regulation-fixed capacity', async () => {
    const code = uniqueCode('bulk_279k');
    const created = await createReference(service, '/api/v2/vessel-types', {
      code,
      name: 'Bulk carrier (≥ 279,000 DWT)',
      capacityUnit: 'DWT',
      a: 4745,
      c: 0.622,
      capacityFixed: 279_000,
      d: { d1: 0.86, d2: 0.94, d3: 1.06, d4: 1.18 },
      icon: 'bulkca',
      source: 'MEPC.353(78) Table 1',
    });
    expect(created).toMatchObject({
      code,
      capacityUnit: 'DWT',
      a: 4745,
      c: 0.622,
      capacityFixed: 279_000,
      d: { d1: 0.86, d2: 0.94, d3: 1.06, d4: 1.18 },
      icon: 'bulkca',
    });

    const fetched = bodyOf(
      await service.request(
        org.viewer,
        'GET',
        `/api/v2/vessel-types/${created.id}`,
      ),
      200,
    );
    expect(fetched).toEqual(created);
    const searched = bodyOf<Page<{ id: string }>>(
      await service.request(
        org.viewer,
        'GET',
        `/api/v2/vessel-types?search=${code}`,
      ),
      200,
    );
    expect(searched.data.map((row) => row.id)).toEqual([created.id]);

    const cleared = bodyOf(
      await service.request(
        SUPER_ADMIN,
        'PATCH',
        `/api/v2/vessel-types/${created.id}`,
        { capacityFixed: null, name: 'Bulk carrier' },
      ),
      200,
    );
    expect(cleared).toMatchObject({
      capacityFixed: null,
      name: 'Bulk carrier',
    });

    const invalid = problemOf(
      await service.request(SUPER_ADMIN, 'POST', '/api/v2/vessel-types', {
        code: 'Not A Code',
        name: '',
        capacityUnit: 'TEU',
        a: -1,
        c: 0.5,
        capacityFixed: 0,
        d: { d1: 1.2, d2: 1.1, d3: 1.0, d4: 0.9 },
        icon: 'rocket',
      }),
      400,
    );
    expect(invalid.code).toBe('VALIDATION_FAILED');
    expect(invalid.errors?.map((error) => error.field)).toEqual(
      expect.arrayContaining([
        'code',
        'name',
        'capacityUnit',
        'a',
        'capacityFixed',
        'icon',
      ]),
    );
    expect(invalid.errors?.some((error) => error.field.startsWith('d'))).toBe(
      true,
    );

    expect(
      problemOf(
        await service.request(SUPER_ADMIN, 'POST', '/api/v2/vessel-types', {
          code,
          name: 'Duplicate',
          capacityUnit: 'DWT',
          a: 1,
          c: 0,
          d: { d1: 0.8, d2: 0.9, d3: 1.1, d4: 1.2 },
        }),
        409,
      ).code,
    ).toBe('CODE_ALREADY_EXISTS');
    expect(
      problemOf(
        await service.request(
          org.viewer,
          'GET',
          `/api/v2/vessel-types/${randomUUID()}`,
        ),
        404,
      ).code,
    ).toBe('VESSEL_TYPE_NOT_FOUND');
    expect(
      (
        await service.request(
          SUPER_ADMIN,
          'DELETE',
          `/api/v2/vessel-types/${created.id}`,
        )
      ).statusCode,
    ).toBe(204);
  });

  it('manages fuels with Cf, carbon content and density', async () => {
    const code = uniqueCode('methanol');
    const fuel = await createReference(service, '/api/v2/fuels', {
      code,
      name: 'Methanol',
      carbonContent: 0.375,
      conversionFactor: 1.375,
      density: 0.796,
      source: 'MEPC.364(79)',
    });
    expect(fuel).toMatchObject({
      code,
      carbonContent: 0.375,
      conversionFactor: 1.375,
      density: 0.796,
      source: 'MEPC.364(79)',
    });
    const invalid = problemOf(
      await service.request(SUPER_ADMIN, 'POST', '/api/v2/fuels', {
        code: uniqueCode('bad'),
        name: 'Bad',
        carbonContent: 1.5,
        conversionFactor: 0,
        density: -1,
      }),
      400,
    );
    expect(invalid.errors?.map((error) => error.field).sort()).toEqual([
      'carbonContent',
      'conversionFactor',
      'density',
    ]);
    const renamed = bodyOf(
      await service.request(SUPER_ADMIN, 'PATCH', `/api/v2/fuels/${fuel.id}`, {
        name: 'Methanol (MeOH)',
      }),
      200,
    );
    expect(renamed).toMatchObject({ name: 'Methanol (MeOH)', density: 0.796 });
    expect(
      (await service.request(SUPER_ADMIN, 'DELETE', `/api/v2/fuels/${fuel.id}`))
        .statusCode,
    ).toBe(204);
    expect(
      problemOf(
        await service.request(
          SUPER_ADMIN,
          'DELETE',
          `/api/v2/fuels/${fuel.id}`,
        ),
        404,
      ).code,
    ).toBe('FUEL_NOT_FOUND');
  });

  it('lists engines by kind', async () => {
    const name = `Engine ${randomUUID().slice(0, 8)}`;
    const main = await createReference(service, '/api/v2/engines', {
      code: uniqueCode('main'),
      kind: 'main',
      name: `${name} main`,
      rpm: 750,
      powerKw: 3000,
      sfoc: 185,
    });
    const auxiliary = await createReference(service, '/api/v2/engines', {
      kind: 'auxiliary',
      name: `${name} aux`,
      rpm: 1500,
      powerKw: 400,
      sfoc: 210,
    });
    expect(auxiliary.code).toBeNull();

    const ofKind = async (kind: string) =>
      bodyOf<Page<{ id: string; kind: string }>>(
        await service.request(
          org.viewer,
          'GET',
          `/api/v2/engines?kind=${kind}&search=${encodeURIComponent(name)}`,
        ),
        200,
      ).data;
    expect((await ofKind('main')).map((row) => row.id)).toEqual([main.id]);
    expect((await ofKind('auxiliary')).map((row) => row.id)).toEqual([
      auxiliary.id,
    ]);
    problemOf(
      await service.request(org.viewer, 'GET', '/api/v2/engines?kind=turbine'),
      400,
    );
    problemOf(
      await service.request(SUPER_ADMIN, 'POST', '/api/v2/engines', {
        kind: 'main',
        name: 'Negative',
        rpm: -1,
        powerKw: 100,
        sfoc: 180,
      }),
      400,
    );
  });

  it('validates first fuel formulas with the safe grammar', async () => {
    const created = await createReference(service, '/api/v2/fuel-formulas', {
      code: uniqueCode('formula'),
      name: 'Every construct of the grammar',
      mainEngineFormula:
        '0.5 * speedKnot ^ 2 + Math.sqrt(abs(speedKnot)) - ln(2) + pow(speedKnot, 1.5)',
      auxiliaryEngineFormula:
        'max(0.5, min(3, 1.5103 * exp(-0.064 * speedKnot))) / (1 + 1e-3)',
    });
    expect(created.mainEngineFormula).toContain('speedKnot ^ 2');

    const refused = async (body: Record<string, unknown>) =>
      problemOf(
        await service.request(SUPER_ADMIN, 'POST', '/api/v2/fuel-formulas', {
          name: 'Refused',
          mainEngineFormula: '1',
          auxiliaryEngineFormula: '1',
          ...body,
        }),
        400,
      );
    for (const formula of [
      'process.exit(1)',
      'speedKnot; while(true){}',
      'constructor.constructor("return this")()',
      'Math.random()',
      'speedKnot +',
      'pow(speedKnot)',
      'speed * 2',
    ]) {
      const problem = await refused({ mainEngineFormula: formula });
      expect(problem.code, formula).toBe('VALIDATION_FAILED');
      expect(fieldsOf(problem), formula).toEqual(['mainEngineFormula']);
    }
    const both = await refused({
      mainEngineFormula: 'eval("1")',
      auxiliaryEngineFormula: 'require("fs")',
    });
    expect(both.errors?.map((error) => error.field).sort()).toEqual([
      'auxiliaryEngineFormula',
      'mainEngineFormula',
    ]);
    expect(both.errors?.[0]?.message).toMatch(/position \d+/);

    // PATCH validates too.
    expect(
      problemOf(
        await service.request(
          SUPER_ADMIN,
          'PATCH',
          `/api/v2/fuel-formulas/${created.id}`,
          { auxiliaryEngineFormula: 'globalThis' },
        ),
        400,
      ).errors?.map((error) => error.field),
    ).toEqual(['auxiliaryEngineFormula']);
  });

  it('stores ports as GeoJSON points and filters them by bbox', async () => {
    const code = uniquePortCode();
    const port = await createReference(service, '/api/v2/ports', {
      name: 'Pelabuhan Benoa',
      code: code.toLowerCase(),
      administrativeLocation: '51.71.01.1001',
      location: { type: 'Point', coordinates: [115.2101, -8.7448] },
      radiusM: 1500,
    });
    expect(port).toMatchObject({
      name: 'Pelabuhan Benoa',
      code,
      administrativeLocation: '51.71.01.1001',
      location: { type: 'Point', coordinates: [115.2101, -8.7448] },
      radiusM: 1500,
    });
    const far = await createReference(service, '/api/v2/ports', {
      name: 'Pelabuhan Tanjung Priok',
      code: uniquePortCode(),
      location: { type: 'Point', coordinates: [106.8805, -6.1045] },
    });

    const inBbox = bodyOf<Page<{ id: string }>>(
      await service.request(
        org.viewer,
        'GET',
        '/api/v2/ports?bbox=115.1,-8.9,115.3,-8.6&pageSize=100',
      ),
      200,
    );
    const ids = inBbox.data.map((row) => row.id);
    expect(ids).toContain(port.id);
    expect(ids).not.toContain(far.id);
    const searched = bodyOf<Page<{ id: string }>>(
      await service.request(org.viewer, 'GET', '/api/v2/ports?search=benoa'),
      200,
    );
    expect(searched.data.map((row) => row.id)).toContain(port.id);

    const moved = bodyOf(
      await service.request(SUPER_ADMIN, 'PATCH', `/api/v2/ports/${port.id}`, {
        location: { type: 'Point', coordinates: [115.21, -8.75] },
        radiusM: null,
      }),
      200,
    );
    expect(moved).toMatchObject({
      location: { type: 'Point', coordinates: [115.21, -8.75] },
      radiusM: null,
    });

    for (const location of [
      { type: 'Point', coordinates: [181, 0] },
      { type: 'Point', coordinates: [0, -91] },
      { type: 'Point', coordinates: [0] },
      { type: 'Polygon', coordinates: [0, 0] },
      'POINT(115 -8)',
    ]) {
      const problem = problemOf(
        await service.request(SUPER_ADMIN, 'POST', '/api/v2/ports', {
          name: 'Invalid',
          code: uniquePortCode(),
          location,
        }),
        400,
      );
      expect(
        problem.errors?.every((error) => error.field.startsWith('location')),
        JSON.stringify(location),
      ).toBe(true);
    }
    problemOf(
      await service.request(org.viewer, 'GET', '/api/v2/ports?bbox=1,2,3'),
      400,
    );
    expect(
      problemOf(
        await service.request(SUPER_ADMIN, 'POST', '/api/v2/ports', {
          name: 'Duplicate',
          code,
          location: { type: 'Point', coordinates: [115, -8] },
        }),
        409,
      ).code,
    ).toBe('CODE_ALREADY_EXISTS');
  });

  it('refuses null for required members of every PATCH and lets it clear nullable ones', async () => {
    const references = await createReferenceSet(service);
    const cases = [
      [
        'vessel-types',
        references.typeId,
        ['name', 'code', 'a', 'd', 'capacityUnit'],
      ],
      ['fuels', references.fuelId, ['name', 'density', 'conversionFactor']],
      ['engines', references.mainEngineId, ['name', 'rpm', 'kind']],
      [
        'fuel-formulas',
        references.formulaId,
        ['name', 'mainEngineFormula', 'auxiliaryEngineFormula'],
      ],
      ['ports', references.portIds[0], ['location', 'name', 'code']],
    ] as const;
    // Regression: each of these answered 500 (NOT NULL violation or a
    // TypeError on a null nested object).
    for (const [path, id, fields] of cases) {
      for (const field of fields) {
        const problem = problemOf(
          await service.request(SUPER_ADMIN, 'PATCH', `/api/v2/${path}/${id}`, {
            [field]: null,
          }),
          400,
        );
        expect(problem.code, `${path} ${field}`).toBe('VALIDATION_FAILED');
        expect(fieldsOf(problem), `${path} ${field}`).toEqual([field]);
      }
    }
    const type = bodyOf(
      await service.request(
        SUPER_ADMIN,
        'PATCH',
        `/api/v2/vessel-types/${references.typeId}`,
        { capacityFixed: null, icon: null, source: null },
      ),
      200,
    );
    expect(type).toMatchObject({
      capacityFixed: null,
      icon: null,
      source: null,
    });
    const port = bodyOf(
      await service.request(
        SUPER_ADMIN,
        'PATCH',
        `/api/v2/ports/${references.portIds[0]}`,
        { administrativeLocation: null, radiusM: null, source: null },
      ),
      200,
    );
    expect(port).toMatchObject({
      administrativeLocation: null,
      radiusM: null,
      source: null,
    });
  });

  it('never lets a kind change race a vessel fitting the engine in its old role', async () => {
    const references = await createReferenceSet(service);
    // A vessel without engines, so the open transaction below can fit the main engine.
    const vessel = await createVessel(service, org.admin, references, {
      engines: [],
    });
    const engineUrl = `/api/v2/engines/${references.mainEngineId}`;

    // A vessel write in flight (as VesselsService.fitEngines does it): the
    // engine is share-locked, its kind checked and the engine fitted as main.
    const fitting = await pool.connect();
    let open = false;
    try {
      await fitting.query('BEGIN');
      open = true;
      const { rows } = await fitting.query<{ kind: string }>(
        'SELECT kind FROM engines WHERE id = $1 FOR SHARE',
        [references.mainEngineId],
      );
      expect(rows[0]?.kind).toBe('main');
      await fitting.query(
        `INSERT INTO vessel_engines (vessel_id, engine_id, role, quantity, position)
         VALUES ($1, $2, 'main', 1, 0)`,
        [vessel.id, references.mainEngineId],
      );

      // The kind change starts while the fit is uncommitted …
      const change = service.request(SUPER_ADMIN, 'PATCH', engineUrl, {
        kind: 'auxiliary',
      });
      // … and waits for the engine row lock (regression: it counted 0 users
      // before the fit committed and then changed the kind).
      await waitFor(
        async () => {
          const waiting = await pool.query<{ count: number }>(
            `SELECT count(*)::int AS count FROM pg_stat_activity
              WHERE wait_event_type = 'Lock' AND usename = current_user
                AND query ILIKE '%"engines"%' AND query ILIKE '%for update%'`,
          );
          return (waiting.rows[0]?.count ?? 0) > 0;
        },
        { message: 'the kind change never waited for the engine lock' },
      );
      await fitting.query('COMMIT');
      open = false;

      const problem = problemOf(await change, 409);
      expect(problem.code).toBe('REFERENCE_IN_USE');
    } finally {
      if (open) await fitting.query('ROLLBACK');
      fitting.release();
    }

    const { rows } = await pool.query<{ role: string; kind: string }>(
      `SELECT ve.role, e.kind FROM vessel_engines ve JOIN engines e ON e.id = ve.engine_id
        WHERE ve.vessel_id = $1`,
      [vessel.id],
    );
    expect(rows).toEqual([{ role: 'main', kind: 'main' }]);
  });

  it('refuses to delete reference rows that vessels still use', async () => {
    const references = await createReferenceSet(service);
    const vessel = await createVessel(service, org.admin, references);

    for (const [path, id] of [
      ['vessel-types', references.typeId],
      ['fuels', references.fuelId],
      ['engines', references.mainEngineId],
      ['fuel-formulas', references.formulaId],
      ['ports', references.portIds[0]],
    ] as const) {
      const problem = problemOf(
        await service.request(SUPER_ADMIN, 'DELETE', `/api/v2/${path}/${id}`),
        409,
      );
      expect(problem.code, path).toBe('REFERENCE_IN_USE');
    }

    // Once the vessel is gone, the rows can be deleted.
    expect(
      (
        await service.request(
          org.admin,
          'DELETE',
          `/api/v2/vessels/${vessel.id}`,
        )
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await service.request(
          SUPER_ADMIN,
          'DELETE',
          `/api/v2/ports/${references.portIds[0]}`,
        )
      ).statusCode,
    ).toBe(204);
  });
  it('shows how many vessels use each reference row to platform administrators only', async () => {
    const references = await createReferenceSet(service);
    const rows = [
      ['vessel-types', references.typeId],
      ['fuels', references.fuelId],
      ['engines', references.mainEngineId],
      ['engines', references.auxEngineId],
      ['fuel-formulas', references.formulaId],
      ['ports', references.portIds[0]],
    ] as const;
    const countOf = async (path: string, id: string) =>
      bodyOf<{ vesselCount?: number }>(
        await service.request(SUPER_ADMIN, 'GET', `/api/v2/${path}/${id}`),
        200,
      ).vesselCount;
    for (const [path, id] of rows) {
      expect(await countOf(path, id), path).toBe(0);
    }
    await createVessel(service, org.admin, references);
    await createVessel(service, newOrganization().admin, references);
    for (const [path, id] of rows) {
      // Vessels of every organization; an engine fitted twice counts once.
      expect(await countOf(path, id), path).toBe(2);
      const viewerRow = bodyOf(
        await service.request(org.admin, 'GET', `/api/v2/${path}/${id}`),
        200,
      );
      expect(viewerRow, path).not.toHaveProperty('vesselCount');
    }
    // List rows carry it too (one grouped count per page).
    const page = bodyOf<Page<{ id: string; vesselCount?: number }>>(
      await service.request(
        SUPER_ADMIN,
        'GET',
        `/api/v2/fuels?search=${references.fuelCode}`,
      ),
      200,
    );
    expect(page.data).toEqual([
      expect.objectContaining({ id: references.fuelId, vesselCount: 2 }),
    ]);
    const viewerPage = bodyOf<Page<Record<string, unknown>>>(
      await service.request(
        org.viewer,
        'GET',
        `/api/v2/fuels?search=${references.fuelCode}`,
      ),
      200,
    );
    expect(viewerPage.data[0]).not.toHaveProperty('vesselCount');
  });

  it('links ship types, fuels and engines to the methodology catalog without republishing vessels', async () => {
    const references = await createReferenceSet(service);
    const vessel = await createVessel(service, org.admin, references);
    const snapshotsOf = async () =>
      (
        await pool.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM outbox WHERE entity_key = $1',
          [vessel.id],
        )
      ).rows[0]?.count ?? 0;
    const before = await snapshotsOf();

    for (const [path, id, referenceIds] of [
      [
        'vessel-types',
        references.typeId,
        ['imo-mepc-353-78', 'imo-mepc-354-78'],
      ],
      ['fuels', references.fuelId, ['imo-mepc-364-79']],
      ['engines', references.mainEngineId, ['legacy-mvp-backend']],
    ] as const) {
      const url = `/api/v2/${path}/${id}`;
      expect(
        bodyOf(
          await service.request(SUPER_ADMIN, 'PATCH', url, { referenceIds }),
          200,
        ).referenceIds,
        path,
      ).toEqual(referenceIds);
      expect(
        bodyOf(await service.request(org.viewer, 'GET', url), 200).referenceIds,
        path,
      ).toEqual(referenceIds);
      for (const invalid of [['no-such-reference'], null]) {
        const problem = problemOf(
          await service.request(SUPER_ADMIN, 'PATCH', url, {
            referenceIds: invalid,
          }),
          400,
        );
        expect(fieldsOf(problem), `${path} ${JSON.stringify(invalid)}`).toEqual(
          ['referenceIds'],
        );
      }
    }
    // Provenance is not part of the snapshot: nothing was republished…
    expect(await snapshotsOf()).toBe(before);
    // …while a change of an embedded value still is.
    bodyOf(
      await service.request(
        SUPER_ADMIN,
        'PATCH',
        `/api/v2/fuels/${references.fuelId}`,
        { density: 0.85, referenceIds: [] },
      ),
      200,
    );
    expect(await snapshotsOf()).toBe(before + 1);

    const created = await createReference(service, '/api/v2/fuels', {
      code: uniqueCode('lng'),
      name: 'LNG (test)',
      carbonContent: 0.75,
      conversionFactor: 2.75,
      density: 0.45,
      referenceIds: ['imo-mepc-364-79'],
    });
    expect(created.referenceIds).toEqual(['imo-mepc-364-79']);
    const plain = await createReference(service, '/api/v2/engines', {
      kind: 'auxiliary',
      name: 'Generator (test)',
      rpm: 1500,
      powerKw: 100,
      sfoc: 210,
    });
    expect(plain.referenceIds).toEqual([]);
  });

  it('checks formulas against the server grammar without storing them', async () => {
    const validate = (actor: typeof org.viewer | null, body: object) =>
      service.request(actor, 'POST', '/api/v2/fuel-formulas/validate', body);
    expect(
      bodyOf(
        await validate(org.viewer, {
          formula: '-0.0382 * speedKnot ** 2 + 0.8658 * speedKnot - 0.0197',
        }),
        200,
      ),
    ).toEqual({ valid: true, problem: null });
    const invalid = bodyOf<{
      valid: boolean;
      problem: { code: string; message: string; position: number } | null;
    }>(await validate(org.viewer, { formula: '2 * speed' }), 200);
    expect(invalid).toMatchObject({
      valid: false,
      problem: { code: 'UNKNOWN_IDENTIFIER', position: 4, token: 'speed' },
    });
    expect(invalid.problem?.message).toMatch(
      /^Unknown identifier "speed".* at position 4$/,
    );
    expect(
      bodyOf(await validate(org.viewer, { formula: '1+'.repeat(300) }), 200)
        .problem,
    ).toMatchObject({ code: 'FORMULA_TOO_LONG', position: 500, token: null });
    expect(fieldsOf(problemOf(await validate(org.viewer, {}), 400))).toEqual([
      'formula',
    ]);
    expect(
      fieldsOf(
        problemOf(
          await validate(org.viewer, { formula: 'x'.repeat(2001) }),
          400,
        ),
      ),
    ).toEqual(['formula']);
    expect((await validate(null, { formula: '1' })).statusCode).toBe(401);
  });
});
