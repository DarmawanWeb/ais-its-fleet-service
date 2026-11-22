import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

import { FUEL_FORMULA_MAX_LENGTH } from '../../../domain/fuel-formula.js';
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
    maxLength: FUEL_FORMULA_MAX_LENGTH,
    description: `Main-engine fuel flow. ${GRAMMAR}`,
  })
  @Transform(trimString)
  @IsString()
  @IsFuelFormula()
  readonly mainEngineFormula!: string;

  @ApiProperty({
    example: '1.5103 * Math.exp(-0.064 * speedKnot)',
    maxLength: FUEL_FORMULA_MAX_LENGTH,
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

  @ApiProperty({ format: 'date-time' })
  readonly createdAt: string;

  @ApiProperty({ format: 'date-time' })
  readonly updatedAt: string;

  constructor(formula: FuelFormula) {
    this.id = formula.id;
    this.code = formula.code;
    this.name = formula.name;
    this.mainEngineFormula = formula.mainEngineFormula;
    this.auxiliaryEngineFormula = formula.auxiliaryEngineFormula;
    this.source = formula.source;
    this.createdAt = formula.createdAt.toISOString();
    this.updatedAt = formula.updatedAt.toISOString();
  }
}
