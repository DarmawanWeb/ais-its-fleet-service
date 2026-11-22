import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import type { Engine } from '../../../domain/vessel.js';
import {
  CODE_PATTERN,
  PatchType,
  ReferenceListQuery,
  trimString,
} from '../../common/validation.js';

/** Engine kinds of the catalogue (contracts `ENGINE_KINDS`). */
export const ENGINE_KIND_VALUES = ['main', 'auxiliary'] as const;

/** `POST /engines`. */
export class CreateEngineDto {
  @ApiPropertyOptional({
    example: 'niigata_6m28bet',
    pattern: CODE_PATTERN.source,
    maxLength: 64,
    nullable: true,
    description: 'Optional stable code (seeds and imports upsert by it)',
  })
  @IsOptional()
  @Transform(trimString)
  @Matches(CODE_PATTERN)
  @MaxLength(64)
  readonly code?: string | null;

  @ApiProperty({ enum: ENGINE_KIND_VALUES })
  @IsIn(ENGINE_KIND_VALUES)
  readonly kind!: 'main' | 'auxiliary';

  @ApiProperty({ example: 'NIIGATA 6M28BET', maxLength: 120 })
  @Transform(trimString)
  @IsString()
  @Length(1, 120)
  readonly name!: string;

  @ApiProperty({ example: 390, description: 'Rated speed, rpm' })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(100_000)
  readonly rpm!: number;

  @ApiProperty({ example: 2100, description: 'Rated power, kW' })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1_000_000)
  readonly powerKw!: number;

  @ApiProperty({
    example: 179.2,
    description: 'Specific fuel oil consumption, g/kWh',
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(10_000)
  readonly sfoc!: number;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  readonly source?: string | null;
}

/** `PATCH /engines/:id`: any subset of the create fields; `null` clears `code` and `source` only. */
export class UpdateEngineDto extends PatchType(CreateEngineDto) {}

/** Query of `GET /engines`. */
export class ListEnginesQuery extends ReferenceListQuery {
  @ApiPropertyOptional({ enum: ENGINE_KIND_VALUES })
  @IsOptional()
  @IsIn(ENGINE_KIND_VALUES)
  readonly kind?: 'main' | 'auxiliary';
}

/** An engine on the wire. */
export class EngineDto {
  @ApiProperty({ format: 'uuid' })
  readonly id: string;

  @ApiProperty({ type: String, nullable: true, example: 'niigata_6m28bet' })
  readonly code: string | null;

  @ApiProperty({ enum: ENGINE_KIND_VALUES })
  readonly kind: 'main' | 'auxiliary';

  @ApiProperty({ example: 'NIIGATA 6M28BET' })
  readonly name: string;

  @ApiProperty({ example: 390, description: 'rpm' })
  readonly rpm: number;

  @ApiProperty({ example: 2100, description: 'kW' })
  readonly powerKw: number;

  @ApiProperty({ example: 179.2, description: 'g/kWh' })
  readonly sfoc: number;

  @ApiProperty({ type: String, nullable: true })
  readonly source: string | null;

  @ApiProperty({ format: 'date-time' })
  readonly createdAt: string;

  @ApiProperty({ format: 'date-time' })
  readonly updatedAt: string;

  constructor(engine: Engine) {
    this.id = engine.id;
    this.code = engine.code;
    this.kind = engine.kind;
    this.name = engine.name;
    this.rpm = engine.rpm;
    this.powerKw = engine.powerKw;
    this.sfoc = engine.sfoc;
    this.source = engine.source;
    this.createdAt = engine.createdAt.toISOString();
    this.updatedAt = engine.updatedAt.toISOString();
  }
}
