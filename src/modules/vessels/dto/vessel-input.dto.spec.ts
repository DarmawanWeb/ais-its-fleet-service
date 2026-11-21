import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { SAMPLE_DIMENSIONS } from '../../../../test/fixtures/sample-vessel.js';
import { CreateFuelFormulaDto } from '../../fuel-formulas/dto/fuel-formula.dto.js';
import { CreateVesselDto, UpdateVesselDto } from './vessel-input.dto.js';

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
