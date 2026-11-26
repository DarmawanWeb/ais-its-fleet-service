import { BBoxQueryDto } from '@darmawanweb/ais-its-nest/http';
import {
  ApiProperty,
  ApiPropertyOptional,
  IntersectionType,
} from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  Equals,
  IsDefined,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { VESSEL_COUNT_DESCRIPTION } from '../../snapshots/reference-usage.js';
import {
  IsLonLat,
  PatchType,
  ReferenceListQuery,
  trimString,
  upperTrimString,
} from '../../common/validation.js';
import type { Port } from '../port.js';

/** Port codes: 2–16 upper-case letters and digits (legacy codes such as `PBI`, or UN/LOCODEs). */
export const PORT_CODE_PATTERN = /^[A-Z0-9]{2,16}$/;

/** A GeoJSON point (RFC 7946, WGS 84). */
export class GeoJsonPointDto {
  @ApiProperty({ enum: ['Point'], example: 'Point' })
  @Equals('Point')
  readonly type!: 'Point';

  @ApiProperty({
    type: [Number],
    minItems: 2,
    maxItems: 2,
    example: [115.5073505, -8.5323949],
    description: '[longitude, latitude], degrees',
  })
  @IsLonLat()
  readonly coordinates!: [number, number];
}

/** `POST /ports`. */
export class CreatePortDto {
  @ApiProperty({ example: 'Padang Bai', maxLength: 120 })
  @Transform(trimString)
  @IsString()
  @Length(1, 120)
  readonly name!: string;

  @ApiProperty({ example: 'PBI', pattern: PORT_CODE_PATTERN.source })
  @Transform(upperTrimString)
  @Matches(PORT_CODE_PATTERN)
  readonly code!: string;

  @ApiPropertyOptional({
    example: '51.07.03.2009',
    maxLength: 64,
    nullable: true,
    description:
      'Administrative area code (Indonesian Kemendagri kode wilayah: province.regency.district.village)',
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Length(1, 64)
  readonly administrativeLocation?: string | null;

  @ApiProperty({ type: GeoJsonPointDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => GeoJsonPointDto)
  readonly location!: GeoJsonPointDto;

  @ApiPropertyOptional({
    example: 1500,
    nullable: true,
    description: 'Radius of the port area, m (unknown when null)',
  })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  @Max(100_000)
  readonly radiusM?: number | null;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  readonly source?: string | null;
}

/**
 * `PATCH /ports/:id`: any subset of the create fields; `null` clears
 * `administrativeLocation`, `radiusM` and `source` only.
 */
export class UpdatePortDto extends PatchType(CreatePortDto) {}

/** Query of `GET /ports`: page, search and an optional `bbox`. */
export class ListPortsQuery extends IntersectionType(
  ReferenceListQuery,
  BBoxQueryDto,
) {}

/** A port on the wire, its position as a GeoJSON point. */
export class PortDto {
  @ApiProperty({ format: 'uuid' })
  readonly id: string;

  @ApiProperty({ example: 'Padang Bai' })
  readonly name: string;

  @ApiProperty({ example: 'PBI' })
  readonly code: string;

  @ApiProperty({ type: String, nullable: true, example: '51.07.03.2009' })
  readonly administrativeLocation: string | null;

  @ApiProperty({ type: GeoJsonPointDto })
  readonly location: {
    readonly type: 'Point';
    readonly coordinates: [number, number];
  };

  @ApiProperty({ type: Number, nullable: true })
  readonly radiusM: number | null;

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

  constructor(port: Port, vesselCount?: number) {
    this.id = port.id;
    this.name = port.name;
    this.code = port.code;
    this.administrativeLocation = port.administrativeLocation;
    this.location = { type: 'Point', coordinates: [port.lon, port.lat] };
    this.radiusM = port.radiusM;
    this.source = port.source;
    this.createdAt = port.createdAt.toISOString();
    this.updatedAt = port.updatedAt.toISOString();
    if (vesselCount !== undefined) this.vesselCount = vesselCount;
  }
}
