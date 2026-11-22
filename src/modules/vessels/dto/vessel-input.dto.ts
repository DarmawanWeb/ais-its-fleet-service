import {
  VESSEL_STATUSES,
  type VesselStatus,
} from '@darmawanweb/ais-its-contracts/domain';
import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import {
  BoundedPageQueryDto,
  CODE_PATTERN,
  IsOptionalNonNull,
  PatchType,
  trimString,
  upperTrimString,
} from '../../common/validation.js';
import { ENGINE_KIND_VALUES } from '../../engines/dto/engine.dto.js';

const finite = { allowNaN: false, allowInfinity: false } as const;

/** IMO ship identification number: 7 digits. */
export const IMO_PATTERN = /^\d{7}$/;

/** Flag state: ISO 3166-1 alpha-2. */
export const FLAG_PATTERN = /^[A-Z]{2}$/;

/** Most engine rows and ports per vessel. */
export const MAX_VESSEL_ENGINES = 16;
export const MAX_VESSEL_PORTS = 50;

/**
 * Principal dimensions and hull coefficients (legacy `ShipSize`; field names
 * of VesselSnapshotV1 — legacy `bulbosbow` is `bulbousBow`). Lengths in m,
 * speed in kn, coefficients dimensionless (see `domain/vessel.ts`).
 */
export class VesselDimensionsDto {
  @ApiProperty({
    example: 2877,
    description:
      'CII capacity: DWT or GT according to the ship type capacityUnit',
  })
  @IsNumber(finite)
  @IsPositive()
  readonly capacity!: number;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Deadweight, t',
  })
  @IsOptional()
  @IsNumber(finite)
  @Min(0)
  readonly dwt?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 2877,
    description: 'Gross tonnage',
  })
  @IsOptional()
  @IsNumber(finite)
  @Min(0)
  readonly gt?: number | null;

  @ApiProperty({ example: 0.644818, description: 'Block coefficient C_B' })
  @IsNumber(finite)
  @Min(0)
  @Max(1.5)
  readonly cb!: number;

  @ApiProperty({ example: 69.72, description: 'Length on waterline L_WL, m' })
  @IsNumber(finite)
  @Min(0)
  @Max(600)
  readonly lwl!: number;

  @ApiProperty({ example: 16.3, description: 'Moulded breadth B, m' })
  @IsNumber(finite)
  @Min(0)
  @Max(100)
  readonly b!: number;

  @ApiProperty({ example: 4.1, description: 'Draught T, m' })
  @IsNumber(finite)
  @Min(0)
  @Max(40)
  readonly t!: number;

  @ApiProperty({
    example: 0.753,
    description: 'Waterplane area coefficient C_WP',
  })
  @IsNumber(finite)
  @Min(0)
  @Max(1.5)
  readonly cwp!: number;

  @ApiProperty({ example: 73.3, description: 'Length overall LOA, m' })
  @IsNumber(finite)
  @Min(0)
  @Max(600)
  readonly loa!: number;

  @ApiProperty({
    example: 66.4,
    description: 'Length between perpendiculars L_PP, m',
  })
  @IsNumber(finite)
  @Min(0)
  @Max(600)
  readonly lpp!: number;

  @ApiProperty({ example: 0.673, description: 'Prismatic coefficient C_P' })
  @IsNumber(finite)
  @Min(0)
  @Max(1.5)
  readonly cp!: number;

  @ApiProperty({
    example: 0.9806,
    description: 'Midship section coefficient C_M',
  })
  @IsNumber(finite)
  @Min(0)
  @Max(1.5)
  readonly cm!: number;

  @ApiProperty({
    example: 0.661,
    description:
      'Second block coefficient of the legacy displacement L_m·B·T·C_bnsp·1.025',
  })
  @IsNumber(finite)
  @Min(0)
  @Max(1.5)
  readonly cbnsp!: number;

  @ApiProperty({
    example: false,
    description: 'Bulbous bow fitted (legacy bulbosbow)',
  })
  @IsBoolean()
  readonly bulbousBow!: boolean;

  @ApiProperty({
    example: 8,
    description: 'Holtrop stern shape coefficient C_stern',
  })
  @IsNumber(finite)
  @Min(-100)
  @Max(100)
  readonly cstern!: number;

  @ApiProperty({
    example: 1,
    description: 'Rudder-area rule factor c1 (ship type)',
  })
  @IsNumber(finite)
  readonly c1!: number;

  @ApiProperty({
    example: 1,
    description: 'Rudder-area rule factor c2 (rudder type)',
  })
  @IsNumber(finite)
  readonly c2!: number;

  @ApiProperty({
    example: 1,
    description:
      'Rudder-area rule factor c3 (profile; legacy Holtrop bulb coefficient)',
  })
  @IsNumber(finite)
  readonly c3!: number;

  @ApiProperty({
    example: 1.5,
    description: 'Rudder arrangement factor (rule c4)',
  })
  @IsNumber(finite)
  readonly c5!: number;

  @ApiProperty({ example: 12, description: 'Service speed V_S, kn' })
  @IsNumber(finite)
  @Min(0)
  @Max(60)
  readonly vs!: number;
}

/** One engine of `PUT /vessels/:id/engines`. */
export class VesselEngineInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  readonly engineId!: string;

  @ApiProperty({
    enum: ENGINE_KIND_VALUES,
    description: 'Role on board; must equal the catalogue kind of the engine',
  })
  @IsIn(ENGINE_KIND_VALUES)
  readonly role!: 'main' | 'auxiliary';

  @ApiProperty({
    example: 2,
    minimum: 1,
    maximum: 64,
    description: 'Number of identical engines',
  })
  @IsInt()
  @Min(1)
  @Max(64)
  readonly quantity!: number;
}

/** `POST /vessels`. */
export class CreateVesselDto {
  @ApiProperty({
    example: 525005223,
    minimum: 100_000_000,
    maximum: 999_999_999,
  })
  @IsInt()
  @Min(100_000_000)
  @Max(999_999_999)
  readonly mmsi!: number;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '9037941',
    pattern: IMO_PATTERN.source,
  })
  @IsOptional()
  @Transform(trimString)
  @Matches(IMO_PATTERN)
  readonly imo?: string | null;

  @ApiProperty({ example: 'Dharma Ferry VIII', maxLength: 120 })
  @Transform(trimString)
  @IsString()
  @Length(1, 120)
  readonly name!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'ID',
    pattern: FLAG_PATTERN.source,
    description: 'Flag state, ISO 3166-1 alpha-2',
  })
  @IsOptional()
  @Transform(upperTrimString)
  @Matches(FLAG_PATTERN)
  readonly flag?: string | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 1990,
    minimum: 1800,
    maximum: 2200,
  })
  @IsOptional()
  @IsInt()
  @Min(1800)
  @Max(2200)
  readonly builtYear?: number | null;

  @ApiPropertyOptional({ enum: VESSEL_STATUSES, default: 'active' })
  @IsOptionalNonNull()
  @IsIn(VESSEL_STATUSES)
  readonly status?: VesselStatus;

  @ApiProperty({
    example: 41.6666666666667,
    minimum: 0,
    maximum: 100,
    description: 'Share of the year at sea, percent (SEEMP)',
  })
  @IsNumber(finite)
  @Min(0)
  @Max(100)
  readonly annualVoyagePercentage!: number;

  @ApiProperty({
    format: 'uuid',
    description: 'Ship type (CII reference line)',
  })
  @IsUUID()
  readonly typeId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  readonly fuelId!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  readonly firstFuelFormulaId?: string | null;

  @ApiProperty({ type: VesselDimensionsDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => VesselDimensionsDto)
  readonly dimensions!: VesselDimensionsDto;

  @ApiPropertyOptional({
    type: [VesselEngineInputDto],
    maxItems: MAX_VESSEL_ENGINES,
  })
  @IsOptionalNonNull()
  @IsArray()
  @ArrayMaxSize(MAX_VESSEL_ENGINES)
  @ValidateNested({ each: true })
  @Type(() => VesselEngineInputDto)
  readonly engines?: VesselEngineInputDto[];

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    maxItems: MAX_VESSEL_PORTS,
    uniqueItems: true,
    description: 'Ports of call, in order',
  })
  @IsOptionalNonNull()
  @IsArray()
  @ArrayMaxSize(MAX_VESSEL_PORTS)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  readonly portIds?: string[];

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Owning organization — platform administrators only (default: the active organization)',
  })
  @IsOptionalNonNull()
  @IsUUID()
  readonly orgId?: string;

  @ApiPropertyOptional({
    maxLength: 64,
    description:
      'Id of the legacy MVP document — platform administrators only (data migration)',
  })
  @IsOptionalNonNull()
  @IsString()
  @Length(1, 64)
  readonly legacyId?: string;
}

/**
 * `PATCH /vessels/:id`: identity, status, voyage share and references.
 * Dimensions, engines and ports have their own `PUT` sub-resources;
 * `orgId` (ownership transfer) is reserved to platform administrators.
 * `null` clears `imo`, `flag`, `builtYear` and `firstFuelFormulaId`; for
 * every other member it is `400 VALIDATION_FAILED`.
 */
export class UpdateVesselDto extends PatchType(
  OmitType(CreateVesselDto, [
    'dimensions',
    'engines',
    'portIds',
    'legacyId',
  ] as const),
) {}

/** Query of `GET /vessels` (page-based list, spec §5). */
export class ListVesselsQuery extends BoundedPageQueryDto {
  @ApiPropertyOptional({
    description:
      'Name (case-insensitive substring), MMSI or IMO number (prefix of digits)',
    maxLength: 120,
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Length(1, 120)
  readonly search?: string;

  @ApiPropertyOptional({
    example: 'roro_passenger',
    pattern: CODE_PATTERN.source,
  })
  @IsOptional()
  @Matches(CODE_PATTERN)
  @MaxLength(64)
  readonly typeCode?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Owning organization (platform administrators: any; others: their own)',
  })
  @IsOptional()
  @IsUUID()
  readonly orgId?: string;

  @ApiPropertyOptional({ enum: VESSEL_STATUSES })
  @IsOptional()
  @IsIn(VESSEL_STATUSES)
  readonly status?: VesselStatus;
}
