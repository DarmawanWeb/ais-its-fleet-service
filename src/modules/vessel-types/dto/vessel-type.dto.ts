import { IsOptionalNotNull } from '@darmawanweb/ais-its-nest/http';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDefined,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import type { DdVector } from '@darmawanweb/ais-its-contracts/domain';

import { VESSEL_COUNT_DESCRIPTION } from '../../snapshots/reference-usage.js';
import type { VesselType } from '../../../domain/vessel.js';
import {
  CODE_PATTERN,
  IsCatalogReference,
  IsStrictlyIncreasing,
  MAX_REFERENCE_IDS,
  PatchType,
  REFERENCE_IDS_DESCRIPTION,
  trimString,
} from '../../common/validation.js';

/** Legacy web icon codes (`fe-legacy/public/ships/<icon>.png`). */
export const VESSEL_TYPE_ICONS = [
  'bulkca',
  'combin',
  'contai',
  'cruise',
  'gascar',
  'genera',
  'lngcar',
  'refrig',
  'ro-roc',
  'ro-rop',
  'ro-rov',
  'tanker',
  'unknown',
] as const;

/** CII rating boundaries as multiples of the required CII (exp(d_i), MEPC.354(78)). */
export class DdVectorDto {
  @ApiProperty({
    example: 0.76,
    description: 'Superior / lower boundary (A|B)',
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  readonly d1!: number;

  @ApiProperty({ example: 0.92, description: 'Lower / upper boundary (B|C)' })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  readonly d2!: number;

  @ApiProperty({
    example: 1.14,
    description: 'Upper / inferior boundary (C|D)',
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  readonly d3!: number;

  @ApiProperty({ example: 1.3, description: 'Inferior boundary (D|E)' })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  readonly d4!: number;
}

/** `POST /vessel-types`. */
export class CreateVesselTypeDto {
  @ApiProperty({
    example: 'roro_passenger',
    pattern: CODE_PATTERN.source,
    maxLength: 64,
    description: 'Stable unique code (lowercase snake case)',
  })
  @Transform(trimString)
  @Matches(CODE_PATTERN)
  @MaxLength(64)
  readonly code!: string;

  @ApiProperty({ example: 'Ro-ro passenger ship', maxLength: 120 })
  @Transform(trimString)
  @IsString()
  @Length(1, 120)
  readonly name!: string;

  @ApiProperty({
    enum: ['DWT', 'GT'],
    description:
      'Capacity of the CII reference line: deadweight or gross tonnage',
  })
  @IsIn(['DWT', 'GT'])
  readonly capacityUnit!: 'DWT' | 'GT';

  @ApiProperty({
    example: 2023,
    description: 'Reference line parameter a (CII_ref = a · Capacity^-c)',
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  readonly a!: number;

  @ApiProperty({ example: 0.46, description: 'Reference line exponent c' })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  readonly c!: number;

  @ApiPropertyOptional({
    example: 279000,
    nullable: true,
    description:
      'Regulation-fixed capacity of the size band (MEPC.353(78)); the CII uses it instead of the vessel capacity when set',
  })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  readonly capacityFixed?: number | null;

  @ApiProperty({ type: DdVectorDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => DdVectorDto)
  @IsStrictlyIncreasing(['d1', 'd2', 'd3', 'd4'])
  readonly d!: DdVectorDto;

  @ApiPropertyOptional({ enum: VESSEL_TYPE_ICONS, nullable: true })
  @IsOptional()
  @IsIn(VESSEL_TYPE_ICONS)
  readonly icon?: string | null;

  @ApiPropertyOptional({
    maxLength: 2000,
    nullable: true,
    description:
      'Provenance of the values (regulation, table, verification note)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  readonly source?: string | null;

  @ApiPropertyOptional({
    type: [String],
    maxItems: MAX_REFERENCE_IDS,
    uniqueItems: true,
    example: ['imo-mepc-353-78', 'imo-mepc-354-78'],
    description: REFERENCE_IDS_DESCRIPTION,
  })
  @IsOptionalNotNull()
  @IsArray()
  @ArrayMaxSize(MAX_REFERENCE_IDS)
  @ArrayUnique()
  @IsCatalogReference({ each: true })
  readonly referenceIds?: string[];
}

/**
 * `PATCH /vessel-types/:id`: any subset of the create fields; `null` clears
 * `capacityFixed`, `icon` and `source` and is refused for the others.
 */
export class UpdateVesselTypeDto extends PatchType(CreateVesselTypeDto) {}

/** A vessel type on the wire. */
export class VesselTypeDto {
  @ApiProperty({ format: 'uuid' })
  readonly id: string;

  @ApiProperty({ example: 'roro_passenger' })
  readonly code: string;

  @ApiProperty({ example: 'Ro-ro passenger ship' })
  readonly name: string;

  @ApiProperty({ enum: ['DWT', 'GT'] })
  readonly capacityUnit: 'DWT' | 'GT';

  @ApiProperty({ example: 2023 })
  readonly a: number;

  @ApiProperty({ example: 0.46 })
  readonly c: number;

  @ApiProperty({ type: Number, nullable: true, example: null })
  readonly capacityFixed: number | null;

  @ApiProperty({ type: DdVectorDto })
  readonly d: DdVector;

  @ApiProperty({ type: String, nullable: true, enum: VESSEL_TYPE_ICONS })
  readonly icon: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly source: string | null;

  @ApiProperty({
    type: [String],
    example: ['imo-mepc-353-78', 'imo-mepc-354-78'],
    description:
      "Ids of the methodology catalog's references behind the values (docs/references/references.json)",
  })
  readonly referenceIds: string[];

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

  constructor(type: VesselType, vesselCount?: number) {
    this.id = type.id;
    this.code = type.code;
    this.name = type.name;
    this.capacityUnit = type.capacityUnit;
    this.a = type.a;
    this.c = type.c;
    this.capacityFixed = type.capacityFixed;
    this.d = { d1: type.d1, d2: type.d2, d3: type.d3, d4: type.d4 };
    this.icon = type.icon;
    this.source = type.source;
    this.referenceIds = [...type.referenceIds];
    this.createdAt = type.createdAt.toISOString();
    this.updatedAt = type.updatedAt.toISOString();
    if (vesselCount !== undefined) this.vesselCount = vesselCount;
  }
}
