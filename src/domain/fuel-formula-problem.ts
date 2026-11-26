import { validateFuelFormula } from '@darmawanweb/ais-its-contracts/domain';

/**
 * Stable codes of the problems of a first fuel formula, for clients that show
 * their own (localized) messages. The shared grammar (contracts
 * `validateFuelFormula`) reports a message and a position; the code is
 * derived from the message's wording, which `fuel-formula.spec.ts` pins.
 */
export const FUEL_FORMULA_PROBLEM_CODES = [
  'EMPTY_FORMULA',
  'FORMULA_TOO_LONG',
  'TOO_MANY_TOKENS',
  'NESTED_TOO_DEEPLY',
  'UNEXPECTED_CHARACTER',
  'NUMBER_OUT_OF_RANGE',
  'UNKNOWN_IDENTIFIER',
  'WRONG_ARGUMENT_COUNT',
  'EXPECTED_TOKEN',
  'UNEXPECTED_END',
  'UNEXPECTED_TOKEN',
  'SYNTAX_ERROR',
] as const;

/** A code of {@link FUEL_FORMULA_PROBLEM_CODES}. */
export type FuelFormulaProblemCode =
  (typeof FUEL_FORMULA_PROBLEM_CODES)[number];

/** Why a formula is not in the grammar, and where. */
export interface FuelFormulaProblem {
  readonly code: FuelFormulaProblemCode;
  /** The grammar's message, ending with ` at position <position>`. */
  readonly message: string;
  /** Zero-based character offset of the problem. */
  readonly position: number;
  /**
   * The source text of the token at `position` (as the grammar's tokenizer
   * reads it), or `null` at the end of the formula and for length problems.
   */
  readonly token: string | null;
}

/** The message prefixes of the grammar, most specific first. */
const CODE_BY_PREFIX: readonly (readonly [RegExp, FuelFormulaProblemCode])[] = [
  [/^Empty formula/, 'EMPTY_FORMULA'],
  [/^Longer than \d+ characters/, 'FORMULA_TOO_LONG'],
  [/^More than \d+ tokens/, 'TOO_MANY_TOKENS'],
  [/^Nested deeper than \d+ levels/, 'NESTED_TOO_DEEPLY'],
  [/^Unexpected character /, 'UNEXPECTED_CHARACTER'],
  [/^Number .* is out of range/, 'NUMBER_OUT_OF_RANGE'],
  [/^Unknown identifier /, 'UNKNOWN_IDENTIFIER'],
  [/^\w+\(\) takes \d+ arguments?, got \d+/, 'WRONG_ARGUMENT_COUNT'],
  [/^Expected "/, 'EXPECTED_TOKEN'],
  [/^Unexpected end of formula/, 'UNEXPECTED_END'],
  [/^Unexpected "/, 'UNEXPECTED_TOKEN'],
];

/** The tokens of the grammar (contracts' tokenizer), anchored at the start. */
const TOKEN_PATTERNS: readonly RegExp[] = [
  /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/,
  /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?/,
  /^\*\*/,
];

/** The token that starts at `position` of `source`, or `null` past its end. */
function tokenAt(source: string, position: number): string | null {
  if (position < 0 || position >= source.length) return null;
  const rest = source.slice(position);
  for (const pattern of TOKEN_PATTERNS) {
    const match = pattern.exec(rest);
    if (match !== null) return match[0];
  }
  // Operators, parentheses, commas and unexpected characters are one character.
  return String.fromCodePoint(rest.codePointAt(0) ?? 0);
}

/** The code of a grammar message (`SYNTAX_ERROR` for wording not listed). */
export function fuelFormulaProblemCode(
  message: string,
): FuelFormulaProblemCode {
  return (
    CODE_BY_PREFIX.find(([pattern]) => pattern.test(message))?.[1] ??
    'SYNTAX_ERROR'
  );
}

/**
 * Checks a first fuel formula against the shared grammar (contracts
 * `validateFuelFormula`, default limits) and describes its first problem.
 *
 * The formula is checked as `POST` / `PATCH /fuel-formulas` store it: without
 * surrounding whitespace (`String#trim`, as `trimString` does before
 * `@IsFuelFormula()`), so the 500-character limit applies to the trimmed text.
 * Positions, and the position at the end of the message, refer to `source` as
 * given (an editor's text); an empty formula is reported at 0.
 *
 * @method fuel.first_formula
 * @returns `null` when the formula is in the grammar (and would be stored)
 */
export function fuelFormulaProblem(source: string): FuelFormulaProblem | null {
  const formula = source.trim();
  const result = validateFuelFormula(formula);
  if (result.valid) return null;
  const [issue] = result.errors;
  const code = fuelFormulaProblemCode(issue.message);
  const offset = formula === '' ? 0 : source.length - source.trimStart().length;
  const position = issue.position + offset;
  return {
    code,
    message:
      offset === 0
        ? issue.message
        : issue.message.replace(
            / at position \d+$/,
            ` at position ${position}`,
          ),
    position,
    token:
      code === 'FORMULA_TOO_LONG' || code === 'EMPTY_FORMULA'
        ? null
        : // `null` at the end of the formula, before any trailing whitespace.
          tokenAt(formula, issue.position),
  };
}
