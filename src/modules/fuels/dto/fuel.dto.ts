import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import type { Fuel } from '../../../domain/vessel.js';
import {
  CODE_PATTERN,
  PatchType,
  trimString,
} from '../../common/validation.js';

/** `POST /fuels`. */
export class CreateFuelDto {
  @ApiProperty({
    example: 'diesel_gas_oil',
    pattern: CODE_PATTERN.source,
    maxLength: 64,
  })
  @Transform(trimString)
  @Matches(CODE_PATTERN)
  @MaxLength(64)
  readonly code!: string;

  @ApiProperty({ example: 'Diesel/Gas Oil', maxLength: 120 })
  @Transform(trimString)
  @IsString()
  @Length(1, 120)
  readonly name!: string;

  @ApiProperty({
    example: 0.8744,
    minimum: 0,
    maximum: 1,
    description: 'Carbon content, mass fraction (informative: Cf ≈ 44/12 · Cc)',
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1)
  readonly carbonContent!: number;

  @ApiProperty({
    example: 3.206,
    description: 'Cf, t CO2 per t fuel (MEPC.364(79))',
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  readonly conversionFactor!: number;

  @ApiProperty({
    example: 0.86,
    description:
      'Density, t/m³ (= kg/L), converts first-formula litres to tonnes',
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  @Max(2)
  readonly density!: number;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  readonly source?: string | null;
}

/** `PATCH /fuels/:id`: any subset of the create fields; `null` clears `source` only. */
export class UpdateFuelDto extends PatchType(CreateFuelDto) {}

/** A fuel on the wire. */
export class FuelDto {
  @ApiProperty({ format: 'uuid' })
  readonly id: string;

  @ApiProperty({ example: 'diesel_gas_oil' })
  readonly code: string;

  @ApiProperty({ example: 'Diesel/Gas Oil' })
  readonly name: string;

  @ApiProperty({ example: 0.8744 })
  readonly carbonContent: number;

  @ApiProperty({ example: 3.206 })
  readonly conversionFactor: number;

  @ApiProperty({ example: 0.86 })
  readonly density: number;

  @ApiProperty({ type: String, nullable: true })
  readonly source: string | null;

  @ApiProperty({ format: 'date-time' })
  readonly createdAt: string;

  @ApiProperty({ format: 'date-time' })
  readonly updatedAt: string;

  constructor(fuel: Fuel) {
    this.id = fuel.id;
    this.code = fuel.code;
    this.name = fuel.name;
    this.carbonContent = fuel.carbonContent;
    this.conversionFactor = fuel.conversionFactor;
    this.density = fuel.density;
    this.source = fuel.source;
    this.createdAt = fuel.createdAt.toISOString();
    this.updatedAt = fuel.updatedAt.toISOString();
  }
}
