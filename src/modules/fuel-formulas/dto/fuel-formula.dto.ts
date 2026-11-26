import { FUEL_FORMULA_LIMITS } from '@darmawanweb/ais-its-contracts/domain';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

import { VESSEL_COUNT_DESCRIPTION } from '../../snapshots/reference-usage.js';
import {
  FUEL_FORMULA_PROBLEM_CODES,
  type FuelFormulaProblem,
  type FuelFormulaProblemCode,
} from '../../../domain/fuel-formula-problem.js';
import type { FuelFormula } from '../../../domain/vessel.js';
import {
  CODE_PATTERN,
  IsFuelFormula,
  PatchType,
  trimString,
} from '../../common/validation.js';

const GRAMMAR =
  'Safe expression of speedKnot (kn) giving L/min: numbers, speedKnot, + - * / ** ^ ( ) and ' +
  'Math.<fn> or <fn> for exp, log, ln, sqrt, pow, abs, min, max (^ and ** are powers)';

/** Longest text `POST /fuel-formulas/validate` checks (4 × the grammar's limit). */
export const FUEL_FORMULA_VALIDATE_MAX_LENGTH =
  4 * FUEL_FORMULA_LIMITS.maxLength;

/** `POST /fuel-formulas`. */
export class CreateFuelFormulaDto {
  @ApiPropertyOptional({
    example: 'dharma_ferry_viii',
    pattern: CODE_PATTERN.source,
    maxLength: 64,
    nullable: true,
  })
  @IsOptional()
  @Transform(trimString)
  @Matches(CODE_PATTERN)
  @MaxLength(64)
  readonly code?: string | null;

  @ApiProperty({ example: 'Dharma Ferry VIII regression', maxLength: 120 })
  @Transform(trimString)
  @IsString()
  @Length(1, 120)
  readonly name!: string;

  @ApiProperty({
    example: '-0.0382 * speedKnot ** 2 + 0.8658 * speedKnot - 0.0197',
    maxLength: FUEL_FORMULA_LIMITS.maxLength,
    description: `Main-engine fuel flow. ${GRAMMAR}`,
  })
  @Transform(trimString)
  @IsString()
  @IsFuelFormula()
  readonly mainEngineFormula!: string;

  @ApiProperty({
    example: '1.5103 * Math.exp(-0.064 * speedKnot)',
    maxLength: FUEL_FORMULA_LIMITS.maxLength,
    description: `Auxiliary-engine fuel flow. ${GRAMMAR}`,
  })
  @Transform(trimString)
  @IsString()
  @IsFuelFormula()
  readonly auxiliaryEngineFormula!: string;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  readonly source?: string | null;
}

/** `PATCH /fuel-formulas/:id`: any subset of the create fields; `null` clears `code` and `source` only. */
export class UpdateFuelFormulaDto extends PatchType(CreateFuelFormulaDto) {}

/** A first fuel formula on the wire. */
export class FuelFormulaDto {
  @ApiProperty({ format: 'uuid' })
  readonly id: string;

  @ApiProperty({ type: String, nullable: true })
  readonly code: string | null;

  @ApiProperty({ example: 'Dharma Ferry VIII regression' })
  readonly name: string;

  @ApiProperty({
    example: '-0.0382 * speedKnot ** 2 + 0.8658 * speedKnot - 0.0197',
  })
  readonly mainEngineFormula: string;

  @ApiProperty({ example: '1.5103 * Math.exp(-0.064 * speedKnot)' })
  readonly auxiliaryEngineFormula: string;

  @ApiProperty({ type: String, nullable: true })
  readonly source: string | null;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    example: 3,
    description: VESSEL_COUNT_DESCRIPTION,
  })
  readonly vesselCount?: number;

  @ApiProperty({ format: 'date-time' })
  readonly createdAt: string;

  @ApiProperty({ format: 'date-time' })
  readonly updatedAt: string;

  constructor(formula: FuelFormula, vesselCount?: number) {
    this.id = formula.id;
    this.code = formula.code;
    this.name = formula.name;
    this.mainEngineFormula = formula.mainEngineFormula;
    this.auxiliaryEngineFormula = formula.auxiliaryEngineFormula;
    this.source = formula.source;
    this.createdAt = formula.createdAt.toISOString();
    this.updatedAt = formula.updatedAt.toISOString();
    if (vesselCount !== undefined) this.vesselCount = vesselCount;
  }
}

/** `POST /fuel-formulas/validate`. */
export class ValidateFuelFormulaDto {
  @ApiProperty({
    example: '-0.0382 * speedKnot ** 2 + 0.8658 * speedKnot - 0.0197',
    maxLength: FUEL_FORMULA_VALIDATE_MAX_LENGTH,
    description: `A main- or auxiliary-engine formula. Up to ${FUEL_FORMULA_VALIDATE_MAX_LENGTH} characters are accepted; surrounding whitespace is removed before the check, as POST and PATCH do (the grammar itself allows ${FUEL_FORMULA_LIMITS.maxLength} characters after that: longer ones report FORMULA_TOO_LONG). Positions refer to the text as sent.`,
  })
  @IsString()
  @MaxLength(FUEL_FORMULA_VALIDATE_MAX_LENGTH)
  readonly formula!: string;
}

/** Why a formula is not in the grammar. */
export class FuelFormulaProblemDto {
  @ApiProperty({
    enum: FUEL_FORMULA_PROBLEM_CODES,
    example: 'UNKNOWN_IDENTIFIER',
    description: 'Stable code of the problem (for localized messages)',
  })
  readonly code: FuelFormulaProblemCode;

  @ApiProperty({
    example:
      'Unknown identifier "speed" (allowed: speedKnot and the functions exp, log, ln, sqrt, pow, abs, min, max, optionally prefixed with Math.) at position 4',
    description: "The grammar's message (English), ending with the position",
  })
  readonly message: string;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    example: 4,
    description: 'Zero-based character offset of the problem',
  })
  readonly position: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'speed',
    description:
      'The token at `position`, or null at the end of the formula and for EMPTY_FORMULA / FORMULA_TOO_LONG',
  })
  readonly token: string | null;

  constructor(problem: FuelFormulaProblem) {
    this.code = problem.code;
    this.message = problem.message;
    this.position = problem.position;
    this.token = problem.token;
  }
}

/** Result of `POST /fuel-formulas/validate`. */
export class FuelFormulaValidationDto {
  @ApiProperty({ example: false })
  readonly valid: boolean;

  @ApiProperty({
    type: FuelFormulaProblemDto,
    nullable: true,
    description: 'The first problem; null when `valid`',
  })
  readonly problem: FuelFormulaProblemDto | null;

  constructor(problem: FuelFormulaProblem | null) {
    this.valid = problem === null;
    this.problem = problem === null ? null : new FuelFormulaProblemDto(problem);
  }
}
