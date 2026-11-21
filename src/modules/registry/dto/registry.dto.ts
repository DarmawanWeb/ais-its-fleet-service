import { PageQueryDto } from '@darmawanweb/ais-its-nest/http';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

import { trimString } from '../../common/validation.js';
import type { RegistryEntry } from '../registry.repository.js';

/** Query of `GET /registry/search`. */
export class RegistrySearchQuery extends PageQueryDto {
  @ApiProperty({
    example: 'dharma',
    minLength: 1,
    maxLength: 100,
    description:
      'Name (prefix; substring from 3 characters), IMO number or MMSI (prefix of digits)',
  })
  @Transform(trimString)
  @IsString()
  @Length(1, 100)
  readonly q!: string;
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
