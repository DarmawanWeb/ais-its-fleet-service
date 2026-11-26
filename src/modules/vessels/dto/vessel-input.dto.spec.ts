import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MAX_PAGE } from '@darmawanweb/ais-its-nest/http';
import { describe, expect, it } from 'vitest';

import { SAMPLE_DIMENSIONS } from '../../../../test/fixtures/sample-vessel.js';
import { ReferenceListQuery } from '../../common/validation.js';
import { UpdateEngineDto } from '../../engines/dto/engine.dto.js';
import {
  CreateFuelFormulaDto,
  UpdateFuelFormulaDto,
} from '../../fuel-formulas/dto/fuel-formula.dto.js';
import { CreateFuelDto, UpdateFuelDto } from '../../fuels/dto/fuel.dto.js';
import { UpdatePortDto } from '../../ports/dto/port.dto.js';
import { RegistrySearchQuery } from '../../registry/dto/registry.dto.js';
import { UpdateVesselTypeDto } from '../../vessel-types/dto/vessel-type.dto.js';
import {
  CreateVesselDto,
  ListVesselsQuery,
  UpdateVesselDto,
} from './vessel-input.dto.js';

/** Validates like the kit's ValidationPipe (whitelist, forbidNonWhitelisted). */
async function errorsOf(
  type: new () => object,
  input: Record<string, unknown>,
): Promise<Record<string, string[]>> {
  const errors = await validate(plainToInstance(type, input), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return Object.fromEntries(
    errors.map((error) => [
      error.property,
      Object.keys(error.constraints ?? {}).length > 0
        ? Object.keys(error.constraints ?? {}).sort()
        : (error.children ?? []).map((child) => child.property).sort(),
    ]),
  );
}

const VALID = {
  mmsi: 525005223,
  imo: '9037941',
  name: ' Dharma Ferry VIII ',
  flag: 'id',
  annualVoyagePercentage: 41.6666666666667,
  typeId: '01980000-0000-7000-8000-000000000301',
  fuelId: '01980000-0000-7000-8000-000000000401',
  dimensions: SAMPLE_DIMENSIONS,
  engines: [
    {
      engineId: '01980000-0000-7000-8000-000000000101',
      role: 'main',
      quantity: 2,
    },
  ],
  portIds: ['01980000-0000-7000-8000-000000000201'],
};

describe('CreateVesselDto', () => {
  it('accepts the legacy sample vessel and normalizes name and flag', async () => {
    const dto = plainToInstance(CreateVesselDto, VALID);
    expect(await validate(dto)).toEqual([]);
    expect(dto.name).toBe('Dharma Ferry VIII');
    expect(dto.flag).toBe('ID');
  });

  it('rejects malformed identity, voyage share and references', async () => {
    expect(
      await errorsOf(CreateVesselDto, {
        ...VALID,
        mmsi: 12345,
        imo: 'IMO123456',
        flag: 'USA',
        annualVoyagePercentage: 120,
        typeId: 'not-a-uuid',
        portIds: [VALID.portIds[0], VALID.portIds[0]],
      }),
    ).toEqual({
      mmsi: ['min'],
      imo: ['matches'],
      flag: ['matches'],
      annualVoyagePercentage: ['max'],
      typeId: ['isUuid'],
      portIds: ['arrayUnique'],
    });
  });

  it('validates the nested dimensions and engines', async () => {
    expect(
      await errorsOf(CreateVesselDto, {
        ...VALID,
        dimensions: {
          ...SAMPLE_DIMENSIONS,
          capacity: 0,
          bulbousBow: 'no',
          bulbosbow: false,
        },
        engines: [
          {
            engineId: VALID.engines[0]?.engineId,
            role: 'generator',
            quantity: 0,
          },
        ],
      }),
    ).toEqual({
      dimensions: ['bulbosbow', 'bulbousBow', 'capacity'],
      engines: ['0'],
    });
  });

  it('requires the dimensions (a nested object is not optional by itself)', async () => {
    expect(
      await errorsOf(CreateVesselDto, { ...VALID, dimensions: undefined }),
    ).toEqual({ dimensions: ['isDefined'] });
    // PATCH has no dimensions at all (PUT /vessels/:id/dimensions replaces them).
    expect(
      await errorsOf(UpdateVesselDto, { dimensions: SAMPLE_DIMENSIONS }),
    ).toEqual({ dimensions: ['whitelistValidation'] });
  });
});

describe('UpdateVesselDto', () => {
  it('accepts any subset but not the sub-resources', async () => {
    expect(await errorsOf(UpdateVesselDto, {})).toEqual({});
    expect(await errorsOf(UpdateVesselDto, { status: 'laid_up' })).toEqual({});
    expect(
      await errorsOf(UpdateVesselDto, { dimensions: SAMPLE_DIMENSIONS }),
    ).toEqual({
      dimensions: ['whitelistValidation'],
    });
  });

  it('refuses null for required members and lets it clear nullable ones', async () => {
    // Regression: PartialType's @IsOptional() let null reach NOT NULL columns (500).
    for (const field of [
      'mmsi',
      'name',
      'typeId',
      'fuelId',
      'status',
      'annualVoyagePercentage',
      'orgId',
    ]) {
      expect(
        Object.keys(await errorsOf(UpdateVesselDto, { [field]: null })),
      ).toEqual([field]);
    }
    expect(
      await errorsOf(UpdateVesselDto, {
        imo: null,
        flag: null,
        builtYear: null,
        firstFuelFormulaId: null,
      }),
    ).toEqual({});
  });
});

describe('CreateVesselDto — optional members that are not nullable', () => {
  it('refuses null for status, engines, portIds, orgId and legacyId', async () => {
    for (const field of ['status', 'engines', 'portIds', 'orgId', 'legacyId']) {
      expect(
        Object.keys(
          await errorsOf(CreateVesselDto, { ...VALID, [field]: null }),
        ),
      ).toEqual([field]);
    }
    // Absent is fine (defaults apply).
    const { engines: _engines, portIds: _portIds, ...minimal } = VALID;
    expect(await errorsOf(CreateVesselDto, minimal)).toEqual({});
  });
});

describe('PATCH bodies of the reference data', () => {
  const cases: readonly {
    readonly type: new () => object;
    readonly required: readonly string[];
    readonly nullable: readonly string[];
  }[] = [
    {
      type: UpdateVesselTypeDto,
      required: ['code', 'name', 'capacityUnit', 'a', 'c', 'd'],
      nullable: ['capacityFixed', 'icon', 'source'],
    },
    {
      type: UpdateFuelDto,
      required: [
        'code',
        'name',
        'carbonContent',
        'conversionFactor',
        'density',
      ],
      nullable: ['source'],
    },
    {
      type: UpdateEngineDto,
      required: ['kind', 'name', 'rpm', 'powerKw', 'sfoc'],
      nullable: ['code', 'source'],
    },
    {
      type: UpdateFuelFormulaDto,
      required: ['name', 'mainEngineFormula', 'auxiliaryEngineFormula'],
      nullable: ['code', 'source'],
    },
    {
      type: UpdatePortDto,
      required: ['name', 'code', 'location'],
      nullable: ['administrativeLocation', 'radiusM', 'source'],
    },
  ];

  it.each(cases)(
    '$type.name refuses null for required members',
    async (entry) => {
      for (const field of entry.required) {
        expect(
          Object.keys(await errorsOf(entry.type, { [field]: null })),
        ).toEqual([field]);
      }
    },
  );

  it.each(cases)(
    '$type.name lets null clear nullable members',
    async (entry) => {
      expect(
        await errorsOf(
          entry.type,
          Object.fromEntries(entry.nullable.map((field) => [field, null])),
        ),
      ).toEqual({});
    },
  );
});

describe('page queries', () => {
  it.each([ListVesselsQuery, ReferenceListQuery])(
    '%o bounds page to 1..MAX_PAGE',
    async (type) => {
      expect(await errorsOf(type, { page: String(MAX_PAGE) })).toEqual({});
      expect(await errorsOf(type, { page: String(MAX_PAGE + 1) })).toEqual({
        page: ['max'],
      });
      // Regression: a 20-digit page overflowed the OFFSET (500).
      expect(await errorsOf(type, { page: '99999999999999999999' })).toEqual({
        page: ['max'],
      });
      expect(await errorsOf(type, { page: '0' })).toEqual({ page: ['min'] });
      expect(await errorsOf(type, { page: '1.5' })).toEqual({
        page: ['isInt'],
      });
      expect(await errorsOf(type, { pageSize: '101' })).toEqual({
        pageSize: ['max'],
      });
    },
  );

  it('bounds the registry search page as well', async () => {
    expect(
      await errorsOf(RegistrySearchQuery, { q: 'dharma', page: '2000000' }),
    ).toEqual({ page: ['max'] });
    expect(
      await errorsOf(RegistrySearchQuery, { q: 'dharma', match: 'fuzzy' }),
    ).toEqual({ match: ['isIn'] });
  });
});

describe('CreateFuelFormulaDto', () => {
  it('accepts the legacy sample formulas', async () => {
    expect(
      await errorsOf(CreateFuelFormulaDto, {
        name: 'Sample',
        mainEngineFormula:
          '-0.0382 * speedKnot ** 2 + 0.8658 * speedKnot - 0.0197',
        auxiliaryEngineFormula: '1.5103 * Math.exp(-0.064 * speedKnot)',
      }),
    ).toEqual({});
  });

  it('rejects formulas outside the safe grammar with the reason', async () => {
    const errors = await validate(
      plainToInstance(CreateFuelFormulaDto, {
        name: 'Evil',
        mainEngineFormula: 'process.exit(1)',
        auxiliaryEngineFormula: 'speedKnot +',
      }),
    );
    expect(
      Object.fromEntries(
        errors.map((error) => [error.property, error.constraints]),
      ),
    ).toEqual({
      mainEngineFormula: {
        isFuelFormula: expect.stringContaining(
          'Unknown identifier "process.exit"',
        ) as unknown,
      },
      auxiliaryEngineFormula: {
        isFuelFormula: expect.stringContaining(
          'Unexpected end of formula at position 11',
        ) as unknown,
      },
    });
  });
});

describe('ListVesselsQuery batch lookup and sort', () => {
  it('reads mmsi as a comma-separated or repeated list of MMSIs', async () => {
    expect(await errorsOf(ListVesselsQuery, { mmsi: '525005223' })).toEqual({});
    expect(
      await errorsOf(ListVesselsQuery, { mmsi: '525005223, 525005224' }),
    ).toEqual({});
    expect(
      await errorsOf(ListVesselsQuery, { mmsi: ['525005223', '525005224'] }),
    ).toEqual({});
    const query = plainToInstance(ListVesselsQuery, {
      mmsi: '525005223,525005224',
    });
    expect(query.mmsi).toEqual(['525005223', '525005224']);
  });

  it.each([
    '',
    '525005223,',
    '0525005223',
    '52500522',
    '5250052e2',
    '525005223;525005224',
    Array.from({ length: 101 }, (_, index) => String(525_000_000 + index)).join(
      ',',
    ),
  ])('refuses mmsi=%j', async (mmsi) => {
    expect(await errorsOf(ListVesselsQuery, { mmsi })).toEqual({
      mmsi: ['isMmsiList'],
    });
  });

  it('accepts the sort keys and orders and nothing else', async () => {
    for (const sort of [
      'name',
      'mmsi',
      'imo',
      'gt',
      'dwt',
      'builtYear',
      'updatedAt',
    ]) {
      expect(
        await errorsOf(ListVesselsQuery, { sort, order: 'desc' }),
        sort,
      ).toEqual({});
    }
    expect(await errorsOf(ListVesselsQuery, { sort: 'orgId' })).toEqual({
      sort: ['isIn'],
    });
    expect(await errorsOf(ListVesselsQuery, { order: 'up' })).toEqual({
      order: ['isIn'],
    });
  });
});

describe('referenceIds of ship types, fuels and engines', () => {
  const create = {
    code: 'diesel_gas_oil',
    name: 'Diesel/Gas Oil',
    carbonContent: 0.8744,
    conversionFactor: 3.206,
    density: 0.86,
  };

  it('accepts ids of the methodology catalog, unique, and [] to clear', async () => {
    expect(
      await errorsOf(CreateFuelDto, {
        ...create,
        referenceIds: ['imo-mepc-364-79'],
      }),
    ).toEqual({});
    expect(await errorsOf(CreateFuelDto, create)).toEqual({});
    for (const type of [UpdateVesselTypeDto, UpdateFuelDto, UpdateEngineDto]) {
      expect(await errorsOf(type, { referenceIds: [] }), type.name).toEqual({});
      expect(
        await errorsOf(type, {
          referenceIds: ['imo-mepc-353-78', 'legacy-mvp-backend'],
        }),
        type.name,
      ).toEqual({});
    }
  });

  it('refuses unknown or duplicate ids, too many ids and null', async () => {
    for (const type of [UpdateVesselTypeDto, UpdateFuelDto, UpdateEngineDto]) {
      expect(
        await errorsOf(type, { referenceIds: ['no-such-reference'] }),
        type.name,
      ).toEqual({ referenceIds: ['isCatalogReference'] });
      expect(
        await errorsOf(type, {
          referenceIds: ['imo-mepc-364-79', 'imo-mepc-364-79'],
        }),
        type.name,
      ).toEqual({ referenceIds: ['arrayUnique'] });
      expect(
        await errorsOf(type, {
          referenceIds: Array.from({ length: 21 }, () => 'imo-mepc-364-79'),
        }),
        type.name,
      ).toEqual({ referenceIds: ['arrayMaxSize', 'arrayUnique'] });
      // null (a NOT NULL column) and a bare string fail as non-arrays.
      for (const referenceIds of [null, 'imo-mepc-364-79']) {
        expect(
          (await errorsOf(type, { referenceIds })).referenceIds,
          type.name,
        ).toContain('isArray');
      }
    }
  });
});
