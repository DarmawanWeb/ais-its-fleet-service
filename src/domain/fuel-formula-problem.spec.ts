import { FUEL_FORMULA_LIMITS } from '@darmawanweb/ais-its-contracts/domain';
import { describe, expect, it } from 'vitest';

import {
  FUEL_FORMULA_PROBLEM_CODES,
  fuelFormulaProblem,
  fuelFormulaProblemCode,
} from './fuel-formula-problem.js';

describe('fuelFormulaProblem', () => {
  it('accepts formulas of the grammar', () => {
    expect(
      fuelFormulaProblem(
        '-0.0382 * speedKnot ** 2 + 0.8658 * speedKnot - 0.0197',
      ),
    ).toBeNull();
    expect(
      fuelFormulaProblem('1.5103 * Math.exp(-0.064 * speedKnot)'),
    ).toBeNull();
  });

  it.each([
    ['', 'EMPTY_FORMULA', 0, null],
    ['1+'.repeat(FUEL_FORMULA_LIMITS.maxLength), 'FORMULA_TOO_LONG', 500, null],
    [
      `${'('.repeat(FUEL_FORMULA_LIMITS.maxDepth + 1)}1${')'.repeat(FUEL_FORMULA_LIMITS.maxDepth + 1)}`,
      'NESTED_TOO_DEEPLY',
      33,
      '1',
    ],
    ['speedKnot; 1', 'UNEXPECTED_CHARACTER', 9, ';'],
    ['1e999 * speedKnot', 'NUMBER_OUT_OF_RANGE', 0, '1e999'],
    ['2 * speed', 'UNKNOWN_IDENTIFIER', 4, 'speed'],
    ['Math.random()', 'UNKNOWN_IDENTIFIER', 0, 'Math.random'],
    ['pow(speedKnot)', 'WRONG_ARGUMENT_COUNT', 0, 'pow'],
    ['(speedKnot', 'EXPECTED_TOKEN', 10, null],
    ['speedKnot +', 'UNEXPECTED_END', 11, null],
    ['speedKnot * * 2', 'UNEXPECTED_TOKEN', 12, '*'],
    ['speedKnot ** ** 2', 'UNEXPECTED_TOKEN', 13, '**'],
  ] as const)(
    'reports %j as %s at %i (token %j)',
    (source, code, position, token) => {
      const problem = fuelFormulaProblem(source);
      expect(problem).toMatchObject({ code, position, token });
      expect(problem?.message).toMatch(/ at position \d+$/);
    },
  );

  it('reports more tokens than the limit when the length limit is raised', () => {
    // The default limits make 500 characters bind first; the code exists for
    // callers of the grammar with a larger maxLength.
    expect(fuelFormulaProblemCode('More than 500 tokens at position 999')).toBe(
      'TOO_MANY_TOKENS',
    );
  });

  it('falls back to SYNTAX_ERROR for wording it does not know', () => {
    expect(fuelFormulaProblemCode('Something new at position 3')).toBe(
      'SYNTAX_ERROR',
    );
    expect(FUEL_FORMULA_PROBLEM_CODES).toContain('SYNTAX_ERROR');
  });
});
