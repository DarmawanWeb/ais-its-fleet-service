import { PageQueryDto } from '@darmawanweb/ais-its-nest/http';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';

import {
  REGISTRY_MATCH_MODES,
  type RegistryMatchMode,
} from '../../../domain/registry.js';
import { trimString } from '../../common/validation.js';
import type { RegistryEntry } from '../registry.repository.js';

/** Query of `GET /registry/search`. */
export class RegistrySearchQuery extends PageQueryDto {
  @ApiProperty({
    example: 'dharma',
    minLength: 1,
    maxLength: 100,
    description:
      'Name, IMO number or MMSI. Names match by prefix (and by substring from 3 characters, see `match`); 1–9 digits (optionally `IMO…`) match IMO numbers and MMSIs starting with them. Exact matches rank first, then prefix, then substring matches.',
  })
  @Transform(trimString)
  @IsString()
  @Length(1, 100)
  readonly q!: string;

  @ApiPropertyOptional({
    enum: REGISTRY_MATCH_MODES,
    default: 'auto',
    description:
      'Name matching: `prefix` (indexed only), `contains` (adds substring matches, scans the table), `auto` (adds substring matches only when the prefix matches do not fill one page). Numeric queries never match substrings.',
  })
  @IsOptional()
  @IsIn(REGISTRY_MATCH_MODES)
  readonly match?: RegistryMatchMode;
}

/** Registry particulars of a ship on the wire (legacy `SecondaryShip`). */
export class RegistryParticularsDto {
  @ApiProperty({ format: 'uuid' })
  readonly id: string;

  @ApiProperty({ type: String, nullable: true, example: '9037941' })
  readonly imo: string | null;

  @ApiProperty({ example: 525005223 })
  readonly mmsi: number;

  @ApiProperty({ example: 'DHARMA FERRY VIII' })
  readonly name: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 1990,
    description: 'Year built',
  })
  readonly built: number | null;

  @ApiProperty({ type: String, nullable: true, example: 'ID' })
  readonly flag: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Indonesia' })
  readonly flagName: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly type: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Passenger/Ro-Ro Cargo Ship',
  })
  readonly typeName: string | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Gross tonnage' })
  readonly gt: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Deadweight, t' })
  readonly dwt: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Length overall, m',
  })
  readonly loaM: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Breadth, m' })
  readonly beamM: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Draught, m' })
  readonly draughtM: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Classification society',
  })
  readonly class: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly classCode: string | null;

  @ApiProperty({ format: 'date-time' })
  readonly updatedAt: string;

  constructor(entry: RegistryEntry) {
    this.id = entry.id;
    this.imo = entry.imo;
    this.mmsi = entry.mmsi;
    this.name = entry.name;
    this.built = entry.built;
    this.flag = entry.flag;
    this.flagName = entry.flagName;
    this.type = entry.type;
    this.typeName = entry.typeName;
    this.gt = entry.gt;
    this.dwt = entry.dwt;
    this.loaM = entry.loa;
    this.beamM = entry.beam;
    this.draughtM = entry.draught;
    this.class = entry.class;
    this.classCode = entry.classCode;
    this.updatedAt = entry.updatedAt.toISOString();
  }
}
