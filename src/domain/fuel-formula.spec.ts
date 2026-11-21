import { describe, expect, it } from 'vitest';

import {
  checkFuelFormula,
  FUEL_FORMULA_MAX_DEPTH,
  FUEL_FORMULA_MAX_LENGTH,
  type FuelFormulaNode,
  FuelFormulaSyntaxError,
  parseFuelFormula,
} from './fuel-formula.js';

const SPEED: FuelFormulaNode = { kind: 'variable', name: 'speedKnot' };
const num = (value: number): FuelFormulaNode => ({ kind: 'number', value });

/** The error of an invalid formula (fails the test when it parses). */
function errorOf(source: string): FuelFormulaSyntaxError {
  try {
    parseFuelFormula(source);
  } catch (error) {
    if (error instanceof FuelFormulaSyntaxError) return error;
    throw error;
  }
  throw new Error(`"${source}" parsed`);
}

describe('parseFuelFormula — the legacy samples (Postman 3.7)', () => {
  it('parses the main-engine regression with JavaScript precedence', () => {
    // -0.0382 * speedKnot ** 2 + 0.8658 * speedKnot - 0.0197
    expect(
      parseFuelFormula(
        '-0.0382 * speedKnot ** 2 + 0.8658 * speedKnot - 0.0197',
      ),
    ).toEqual({
      kind: 'binary',
      operator: '-',
      left: {
        kind: 'binary',
        operator: '+',
        left: {
          kind: 'binary',
          operator: '*',
          left: { kind: 'unary', operator: '-', operand: num(0.0382) },
          right: { kind: 'binary', operator: '^', left: SPEED, right: num(2) },
        },
        right: {
          kind: 'binary',
          operator: '*',
          left: num(0.8658),
          right: SPEED,
        },
      },
      right: num(0.0197),
    });
  });

  it('parses the auxiliary-engine regression with Math.exp', () => {
    expect(parseFuelFormula('1.5103 * Math.exp(-0.064 * speedKnot)')).toEqual({
      kind: 'binary',
      operator: '*',
      left: num(1.5103),
      right: {
        kind: 'call',
        name: 'exp',
        args: [
          {
            kind: 'binary',
            operator: '*',
            left: { kind: 'unary', operator: '-', operand: num(0.064) },
            right: SPEED,
          },
        ],
      },
    });
  });
});

describe('parseFuelFormula — grammar', () => {
  it('treats ^ like ** (power, spec §15.4) and both as right-associative', () => {
    const power = parseFuelFormula('2 ^ 3 ** 2');
    expect(power).toEqual({
      kind: 'binary',
      operator: '^',
      left: num(2),
      right: { kind: 'binary', operator: '^', left: num(3), right: num(2) },
    });
    expect(parseFuelFormula('speedKnot^2')).toEqual(
      parseFuelFormula('speedKnot ** 2'),
    );
  });

  it('binds a leading minus weaker than the power: -x ** 2 = -(x²)', () => {
    expect(parseFuelFormula('-speedKnot ** 2')).toEqual({
      kind: 'unary',
      operator: '-',
      operand: { kind: 'binary', operator: '^', left: SPEED, right: num(2) },
    });
    // A signed exponent, as JavaScript allows it.
    expect(parseFuelFormula('2 ** -1')).toEqual({
      kind: 'binary',
      operator: '^',
      left: num(2),
      right: { kind: 'unary', operator: '-', operand: num(1) },
    });
  });

  it('accepts every function with or without Math., and number forms', () => {
    for (const source of [
      'exp(speedKnot)',
      'Math.log(speedKnot + 1)',
      'ln(speedKnot + 1)',
      'Math.ln(2)',
      'sqrt(speedKnot)',
      'pow(speedKnot, 2)',
      'Math.pow(speedKnot, 0.5)',
      'abs(-speedKnot)',
      'min(speedKnot, 12)',
      'Math.max(0.5, speedKnot, 3)',
      '.5 + 1. + 1e-3 + 2.5E+2',
      '  ( speedKnot\t*\n2 )  ',
      '+speedKnot',
      '0.5',
    ]) {
      expect(checkFuelFormula(source), source).toMatchObject({ valid: true });
    }
  });

  it('refuses code and unknown identifiers', () => {
    for (const [source, message] of [
      ['eval(1)', 'Unknown identifier "eval"'],
      ['eval("1")', 'Unexpected character "\\""'],
      ['process.exit(1)', 'Unknown identifier "process.exit"'],
      ['Math.random()', 'Unknown identifier "Math.random"'],
      ['constructor', 'Unknown identifier "constructor"'],
      ['speed', 'Unknown identifier "speed"'],
      ['speedKnot; 1', 'Unexpected character ";"'],
      ['speedKnot = 1', 'Unexpected character "="'],
      ['`1`', 'Unexpected character "`"'],
      ["'1'", `Unexpected character "'"`],
      ['[1]', 'Unexpected character "["'],
      ['speedKnot % 2', 'Unexpected character "%"'],
      ['speedKnot & 1', 'Unexpected character "&"'],
    ] as const) {
      expect(errorOf(source).message, source).toContain(message);
    }
  });

  it('refuses malformed expressions with the position', () => {
    expect(errorOf('speedKnot *')).toMatchObject({
      position: 11,
      message: 'Unexpected end of formula at position 11',
    });
    expect(errorOf('(speedKnot').message).toContain('Expected ")"');
    expect(errorOf('speedKnot)').position).toBe(9);
    expect(errorOf('2 speedKnot').message).toContain('Unexpected "speedKnot"');
    expect(errorOf('exp speedKnot').message).toContain('Expected "("');
    expect(errorOf('min()').message).toContain('Unexpected ")"');
    expect(errorOf('* 2').position).toBe(0);
  });

  it('checks the arity of the functions', () => {
    expect(errorOf('pow(2)').message).toContain(
      'pow() takes 2 arguments, got 1',
    );
    expect(errorOf('exp(1, 2)').message).toContain(
      'exp() takes 1 argument, got 2',
    );
  });

  it('refuses empty, overlong, deeply nested and out-of-range formulas', () => {
    expect(errorOf('   ').message).toContain('Empty formula');
    expect(errorOf('1+'.repeat(FUEL_FORMULA_MAX_LENGTH)).message).toContain(
      `Longer than ${FUEL_FORMULA_MAX_LENGTH} characters`,
    );
    const deep = `${'('.repeat(FUEL_FORMULA_MAX_DEPTH + 1)}1${')'.repeat(FUEL_FORMULA_MAX_DEPTH + 1)}`;
    expect(errorOf(deep).message).toContain('Nested deeper than');
    expect(
      errorOf('-'.repeat(FUEL_FORMULA_MAX_DEPTH + 1) + '1').message,
    ).toContain('Nested deeper than');
    expect(errorOf('1e999').message).toContain('out of range');
  });
});

describe('checkFuelFormula', () => {
  it('reports instead of throwing', () => {
    expect(checkFuelFormula('speedKnot +')).toEqual({
      valid: false,
      message: 'Unexpected end of formula at position 11',
      position: 11,
    });
    expect(checkFuelFormula('speedKnot')).toEqual({ valid: true, ast: SPEED });
  });
});
