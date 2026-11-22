import { ValidationFailedError } from '@darmawanweb/ais-its-nest';
import { describe, expect, it } from 'vitest';

import { parseMmsiParam } from './params.js';

describe('parseMmsiParam', () => {
  it('reads exactly nine digits as an MMSI', () => {
    expect(parseMmsiParam('525005223')).toBe(525_005_223);
    expect(parseMmsiParam('100000000')).toBe(100_000_000);
  });

  it.each([
    '2147483648',
    '99999999999999999999',
    '12',
    '-5',
    '1e5',
    '0x1F4A1D67',
    '0525005223',
    '052500522',
    ' 525005223',
    '5250052.3',
    'abc',
    '',
  ])('refuses %j with 400 VALIDATION_FAILED on mmsi', (value) => {
    try {
      parseMmsiParam(value);
      expect.unreachable(`${value} was accepted`);
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationFailedError);
      expect((error as ValidationFailedError).errors).toEqual([
        {
          field: 'mmsi',
          message: 'mmsi must be a 9-digit MMSI',
          code: 'isMmsi',
        },
      ]);
    }
  });

  it('refuses non-string values', () => {
    expect(() => parseMmsiParam(525_005_223)).toThrow(ValidationFailedError);
    expect(() => parseMmsiParam(undefined)).toThrow(ValidationFailedError);
  });
});
