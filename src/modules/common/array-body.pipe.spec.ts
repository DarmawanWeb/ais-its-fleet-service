import { ValidationFailedError } from '@darmawanweb/ais-its-nest';
import { describe, expect, it } from 'vitest';

import { VesselEngineInputDto } from '../vessels/dto/vessel-input.dto.js';
import { ArrayBodyPipe, UuidArrayBodyPipe } from './array-body.pipe.js';

const ENGINE = '01980000-0000-7000-8000-000000000101';
const PORT = '01980000-0000-7000-8000-000000000201';

async function fieldErrors(run: () => unknown): Promise<string[]> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ValidationFailedError) {
      return (error.errors ?? []).map(
        (entry) => `${entry.field}:${entry.code ?? ''}`,
      );
    }
    throw error;
  }
  return [];
}

describe('ArrayBodyPipe', () => {
  const pipe = new ArrayBodyPipe(VesselEngineInputDto, 2);

  it('returns validated DTO instances', async () => {
    const items = await pipe.transform([
      { engineId: ENGINE, role: 'main', quantity: 2 },
    ]);
    expect(items[0]).toBeInstanceOf(VesselEngineInputDto);
  });

  it('reports item errors with their index and refuses non-arrays and long arrays', async () => {
    // class-validator reports whitelist violations first: compare as a set.
    expect(
      (
        await fieldErrors(() =>
          pipe.transform([
            { engineId: 'x', role: 'main', quantity: 1, extra: true },
            7,
          ]),
        )
      ).sort(),
    ).toEqual([
      '0.engineId:isUuid',
      '0.extra:whitelistValidation',
      '1:isObject',
    ]);
    expect(
      await fieldErrors(() => pipe.transform({ engineId: ENGINE })),
    ).toEqual(['body:isArray']);
    expect(await fieldErrors(() => pipe.transform([{}, {}, {}]))).toEqual([
      'body:arrayMaxSize',
    ]);
  });
});

describe('UuidArrayBodyPipe', () => {
  const pipe = new UuidArrayBodyPipe(3);

  it('accepts unique UUIDs and reports bad or repeated ones', async () => {
    expect(pipe.transform([PORT])).toEqual([PORT]);
    expect(
      await fieldErrors(() => pipe.transform([PORT, 'nope', PORT])),
    ).toEqual(['1:isUuid', '2:arrayUnique']);
  });
});
