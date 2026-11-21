/**
 * The safe expression language of first fuel formulas (docs/PLATFORM_SPEC.md
 * §13.5 and §15.4): the emission service evaluates the strings stored here,
 * so fleet refuses anything outside the grammar when a formula is written.
 * A formula is parsed into an AST; nothing is ever evaluated with `eval` or
 * `new Function`.
 *
 * Grammar (EBNF; whitespace between tokens is ignored):
 *
 * ```text
 * formula  = sum ;
 * sum      = product , { ( "+" | "-" ) , product } ;
 * product  = unary , { ( "*" | "/" ) , unary } ;
 * unary    = ( "+" | "-" ) , unary | power ;
 * power    = primary , [ ( "**" | "^" ) , unary ] ;      (* right-associative *)
 * primary  = number | "speedKnot" | call | "(" , sum , ")" ;
 * call     = [ "Math." ] , function , "(" , sum , { "," , sum } , ")" ;
 * function = "exp" | "log" | "ln" | "sqrt" | "pow" | "abs" | "min" | "max" ;
 * number   = digits , [ "." , [ digits ] ] , [ exponent ] | "." , digits , [ exponent ] ;
 * exponent = ( "e" | "E" ) , [ "+" | "-" ] , digits ;
 * ```
 *
 * `^` and `**` both mean power (spec §15.4: the legacy JavaScript evaluator
 * would have read `^` as bitwise XOR). A unary minus binds weaker than the
 * power, as in mathematics: `-speedKnot ** 2` is `-(speedKnot²)` (JavaScript
 * rejects that form; every formula JavaScript accepts keeps its meaning).
 * `log` and `ln` are the natural logarithm (JavaScript `Math.log`).
 */

/** Longest formula accepted, characters (also a CHECK in `fuel_formulas`). */
export const FUEL_FORMULA_MAX_LENGTH = 500;

/** Deepest nesting of parentheses, calls and signs. */
export const FUEL_FORMULA_MAX_DEPTH = 32;

/** The only variable of a formula: the segment speed in knots. */
export const FUEL_FORMULA_VARIABLE = 'speedKnot';

/** Functions of the grammar and their arity (`'variadic'` = one or more). */
export const FUEL_FORMULA_FUNCTIONS = Object.freeze({
  exp: 1,
  log: 1,
  ln: 1,
  sqrt: 1,
  pow: 2,
  abs: 1,
  min: 'variadic',
  max: 'variadic',
} as const);

/** A function name of the grammar. */
export type FuelFormulaFunction = keyof typeof FUEL_FORMULA_FUNCTIONS;

/** A node of a parsed formula. */
export type FuelFormulaNode =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'variable'; readonly name: typeof FUEL_FORMULA_VARIABLE }
  | {
      readonly kind: 'unary';
      readonly operator: '+' | '-';
      readonly operand: FuelFormulaNode;
    }
  | {
      readonly kind: 'binary';
      /** `^` is the power operator (`**` and `^` in the source). */
      readonly operator: '+' | '-' | '*' | '/' | '^';
      readonly left: FuelFormulaNode;
      readonly right: FuelFormulaNode;
    }
  | {
      readonly kind: 'call';
      readonly name: FuelFormulaFunction;
      readonly args: readonly FuelFormulaNode[];
    };

/** A formula that is not in the grammar; `position` is the 0-based character offset. */
export class FuelFormulaSyntaxError extends Error {
  override readonly name = 'FuelFormulaSyntaxError';

  constructor(
    message: string,
    readonly position: number,
  ) {
    super(`${message} at position ${position}`);
  }
}

type TokenKind = 'number' | 'identifier' | 'operator' | '(' | ')' | ',' | 'end';

interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly position: number;
}

const NUMBER_PATTERN = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
const IDENTIFIER_PATTERN =
  /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?/;
const WHITESPACE = /\s/;

function isFunctionName(name: string): name is FuelFormulaFunction {
  return Object.hasOwn(FUEL_FORMULA_FUNCTIONS, name);
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source.charAt(index);
    if (WHITESPACE.test(character)) {
      index += 1;
      continue;
    }
    const rest = source.slice(index);
    const number = NUMBER_PATTERN.exec(rest);
    if (number !== null) {
      tokens.push({ kind: 'number', text: number[0], position: index });
      index += number[0].length;
      continue;
    }
    const identifier = IDENTIFIER_PATTERN.exec(rest);
    if (identifier !== null) {
      tokens.push({ kind: 'identifier', text: identifier[0], position: index });
      index += identifier[0].length;
      continue;
    }
    if (rest.startsWith('**')) {
      tokens.push({ kind: 'operator', text: '**', position: index });
      index += 2;
      continue;
    }
    if ('+-*/^'.includes(character)) {
      tokens.push({ kind: 'operator', text: character, position: index });
    } else if (character === '(' || character === ')' || character === ',') {
      tokens.push({ kind: character, text: character, position: index });
    } else {
      throw new FuelFormulaSyntaxError(
        `Unexpected character ${JSON.stringify(character)}`,
        index,
      );
    }
    index += 1;
  }
  tokens.push({ kind: 'end', text: '', position: source.length });
  return tokens;
}

/** Recursive-descent parser over the token list (one instance per formula). */
class Parser {
  private index = 0;
  private depth = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parse(): FuelFormulaNode {
    const node = this.sum();
    const next = this.peek();
    if (next.kind !== 'end') throw this.unexpected(next);
    return node;
  }

  private sum(): FuelFormulaNode {
    let left = this.product();
    for (;;) {
      const operator = this.operator('+', '-');
      if (operator === undefined) return left;
      left = { kind: 'binary', operator, left, right: this.product() };
    }
  }

  private product(): FuelFormulaNode {
    let left = this.unary();
    for (;;) {
      const operator = this.operator('*', '/');
      if (operator === undefined) return left;
      left = { kind: 'binary', operator, left, right: this.unary() };
    }
  }

  private unary(): FuelFormulaNode {
    const operator = this.operator('+', '-');
    if (operator === undefined) return this.power();
    return this.nested(() => ({
      kind: 'unary',
      operator,
      operand: this.unary(),
    }));
  }

  private power(): FuelFormulaNode {
    const base = this.primary();
    if (this.operator('**', '^') === undefined) return base;
    return { kind: 'binary', operator: '^', left: base, right: this.unary() };
  }

  private primary(): FuelFormulaNode {
    const token = this.advance();
    switch (token.kind) {
      case 'number': {
        const value = Number(token.text);
        if (!Number.isFinite(value)) {
          throw new FuelFormulaSyntaxError(
            `Number ${token.text} is out of range`,
            token.position,
          );
        }
        return { kind: 'number', value };
      }
      case 'identifier':
        return this.identifier(token);
      case '(': {
        const inner = this.nested(() => this.sum());
        this.expect(')');
        return inner;
      }
      case ',':
      case ')':
      case 'operator':
      case 'end':
        throw this.unexpected(token);
    }
  }

  private identifier(token: Token): FuelFormulaNode {
    if (token.text === FUEL_FORMULA_VARIABLE) {
      return { kind: 'variable', name: FUEL_FORMULA_VARIABLE };
    }
    const name = token.text.startsWith('Math.')
      ? token.text.slice('Math.'.length)
      : token.text;
    if (!isFunctionName(name)) {
      throw new FuelFormulaSyntaxError(
        `Unknown identifier "${token.text}" (allowed: ${FUEL_FORMULA_VARIABLE} and the functions ` +
          `${Object.keys(FUEL_FORMULA_FUNCTIONS).join(', ')}, optionally prefixed with Math.)`,
        token.position,
      );
    }
    this.expect('(');
    const args = this.nested(() => {
      const list = [this.sum()];
      while (this.peek().kind === ',') {
        this.advance();
        list.push(this.sum());
      }
      return list;
    });
    this.expect(')');
    const arity = FUEL_FORMULA_FUNCTIONS[name];
    if (arity !== 'variadic' && args.length !== arity) {
      throw new FuelFormulaSyntaxError(
        `${name}() takes ${arity} argument${arity === 1 ? '' : 's'}, got ${args.length}`,
        token.position,
      );
    }
    return { kind: 'call', name, args };
  }

  /** Runs `parse` one nesting level deeper, refusing pathological nesting. */
  private nested<T>(parse: () => T): T {
    this.depth += 1;
    if (this.depth > FUEL_FORMULA_MAX_DEPTH) {
      throw new FuelFormulaSyntaxError(
        `Nested deeper than ${FUEL_FORMULA_MAX_DEPTH} levels`,
        this.peek().position,
      );
    }
    try {
      return parse();
    } finally {
      this.depth -= 1;
    }
  }

  /** Consumes the next token when it is one of the operators. */
  private operator<const Operator extends string>(
    ...operators: readonly Operator[]
  ): (Operator extends '**' ? '^' : Operator) | undefined {
    const token = this.peek();
    if (token.kind !== 'operator') return undefined;
    const match = operators.find((operator) => operator === token.text);
    if (match === undefined) return undefined;
    this.advance();
    // `**` is normalized to `^`; every other operator maps to itself.
    return (match === '**' ? '^' : match) as Operator extends '**'
      ? '^'
      : Operator;
  }

  private expect(kind: TokenKind): void {
    const token = this.advance();
    if (token.kind !== kind) {
      throw token.kind === 'end'
        ? new FuelFormulaSyntaxError(`Expected "${kind}"`, token.position)
        : new FuelFormulaSyntaxError(
            `Expected "${kind}" but found "${token.text}"`,
            token.position,
          );
    }
  }

  private peek(): Token {
    // The token list always ends with an `end` token, which is never consumed past.
    return this.tokens[this.index] ?? this.endToken();
  }

  private advance(): Token {
    const token = this.peek();
    if (token.kind !== 'end') this.index += 1;
    return token;
  }

  private endToken(): Token {
    return this.tokens.at(-1) ?? { kind: 'end', text: '', position: 0 };
  }

  private unexpected(token: Token): FuelFormulaSyntaxError {
    return token.kind === 'end'
      ? new FuelFormulaSyntaxError('Unexpected end of formula', token.position)
      : new FuelFormulaSyntaxError(
          `Unexpected "${token.text}"`,
          token.position,
        );
  }
}

/**
 * Parses a first-fuel-formula string (main or auxiliary engine fuel flow as a
 * function of `speedKnot`) into an AST, or throws why it is not in the safe
 * grammar.
 *
 * The method evaluates `q = max(f(V_kn), 0.5)` per engine group in L/min
 * (unit implied by the legacy density conversion); this function implements
 * the language half of it — which strings `f` may be.
 *
 * @method fuel.first_formula
 * @see docs/METHODOLOGY.md §7.2.1 `fuel.first_formula` (catalog references
 *   `legacy-mvp-backend`, `platform-spec-v1-1`)
 * @see docs/PLATFORM_SPEC.md §13.5 (grammar) and §15.4 (`^` means power, no `new Function`)
 * @param source - the formula, e.g. `-0.0382 * speedKnot ** 2 + 0.8658 * speedKnot - 0.0197`
 * @returns the AST
 * @throws FuelFormulaSyntaxError when the formula is empty, too long, too
 *   deeply nested or outside the grammar
 *
 * @example
 * parseFuelFormula('1.5103 * Math.exp(-0.064 * speedKnot)');
 * // → { kind: 'binary', operator: '*', left: { kind: 'number', value: 1.5103 }, right: { kind: 'call', name: 'exp', … } }
 */
export function parseFuelFormula(source: string): FuelFormulaNode {
  if (source.length > FUEL_FORMULA_MAX_LENGTH) {
    throw new FuelFormulaSyntaxError(
      `Longer than ${FUEL_FORMULA_MAX_LENGTH} characters`,
      FUEL_FORMULA_MAX_LENGTH,
    );
  }
  if (source.trim() === '') {
    throw new FuelFormulaSyntaxError('Empty formula', 0);
  }
  return new Parser(tokenize(source)).parse();
}

/** Outcome of {@link checkFuelFormula}. */
export type FuelFormulaCheck =
  | { readonly valid: true; readonly ast: FuelFormulaNode }
  | {
      readonly valid: false;
      readonly message: string;
      readonly position: number;
    };

/**
 * {@link parseFuelFormula} as a result instead of an exception (DTO
 * validation reports every invalid field at once).
 *
 * @method fuel.first_formula
 */
export function checkFuelFormula(source: string): FuelFormulaCheck {
  try {
    return { valid: true, ast: parseFuelFormula(source) };
  } catch (error) {
    if (error instanceof FuelFormulaSyntaxError) {
      return { valid: false, message: error.message, position: error.position };
    }
    throw error;
  }
}
