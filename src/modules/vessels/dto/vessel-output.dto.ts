import {
  VESSEL_STATUSES,
  type VesselStatus,
} from '@darmawanweb/ais-its-contracts/domain';
import { PageMetaDto } from '@darmawanweb/ais-its-nest/http';
import { ApiProperty, getSchemaPath } from '@nestjs/swagger';

import type { VesselDimensions, VesselEngine } from '../../../domain/vessel.js';
import { EngineDto, ENGINE_KIND_VALUES } from '../../engines/dto/engine.dto.js';
import { FuelFormulaDto } from '../../fuel-formulas/dto/fuel-formula.dto.js';
import { FuelDto } from '../../fuels/dto/fuel.dto.js';
import { VesselTypeDto } from '../../vessel-types/dto/vessel-type.dto.js';
import type {
  PortSummary,
  VesselTypeSummary,
  VesselView,
} from '../vessel-view.js';
import { VesselDimensionsDto } from './vessel-input.dto.js';

/** Identity of a ship type (shared with every tenant). */
export class VesselTypeSummaryDto {
  @ApiProperty({ format: 'uuid' })
  readonly id: string;

  @ApiProperty({ example: 'roro_passenger' })
  readonly code: string;

  @ApiProperty({ example: 'Ro-ro passenger ship' })
  readonly name: string;

  @ApiProperty({ type: String, nullable: true, example: 'ro-rop' })
  readonly icon: string | null;

  constructor(type: VesselTypeSummary) {
    this.id = type.id;
    this.code = type.code;
    this.name = type.name;
    this.icon = type.icon;
  }
}

/**
 * Identity of a vessel (spec §8.5): what every principal with `vessel:read`
 * sees, whatever organization owns the vessel.
 */
export class VesselSummaryDto {
  @ApiProperty({
    enum: ['summary', 'detail'],
    description:
      '`summary`: identity only; `detail`: with technical data (own organization)',
  })
  readonly view: 'summary' | 'detail';

  @ApiProperty({ format: 'uuid' })
  readonly id: string;

  @ApiProperty({ example: 525005223 })
  readonly mmsi: number;

  @ApiProperty({ type: String, nullable: true, example: '9037941' })
  readonly imo: string | null;

  @ApiProperty({ example: 'Dharma Ferry VIII' })
  readonly name: string;

  @ApiProperty({ type: String, nullable: true, example: 'ID' })
  readonly flag: string | null;

  @ApiProperty({ type: VesselTypeSummaryDto })
  readonly type: VesselTypeSummaryDto;

  @ApiProperty({ enum: VESSEL_STATUSES })
  readonly status: VesselStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Presigned GET URL of the photo, valid 1 h',
  })
  readonly photoUrl: string | null;

  @ApiProperty({ format: 'date-time' })
  readonly updatedAt: string;

  constructor(view: VesselView) {
    const { vessel, type, photoUrl } = view.identity;
    this.view = view.view;
    this.id = vessel.id;
    this.mmsi = vessel.mmsi;
    this.imo = vessel.imo;
    this.name = vessel.name;
    this.flag = vessel.flag;
    this.type = new VesselTypeSummaryDto(type);
    this.status = vessel.status;
    this.photoUrl = photoUrl;
    this.updatedAt = vessel.updatedAt.toISOString();
  }
}

/** An engine fitted to a vessel. */
export class VesselEngineDto {
  @ApiProperty({ enum: ENGINE_KIND_VALUES })
  readonly role: 'main' | 'auxiliary';

  @ApiProperty({ example: 2, description: 'Number of identical engines' })
  readonly quantity: number;

  @ApiProperty({ type: EngineDto })
  readonly engine: EngineDto;

  constructor(fitted: VesselEngine) {
    this.role = fitted.role;
    this.quantity = fitted.quantity;
    this.engine = new EngineDto(fitted.engine);
  }
}

/** A port of call of a vessel. */
export class VesselPortDto {
  @ApiProperty({ format: 'uuid' })
  readonly id: string;

  @ApiProperty({ example: 'PBI' })
  readonly code: string;

  @ApiProperty({ example: 'Padang Bai' })
  readonly name: string;

  constructor(port: PortSummary) {
    this.id = port.id;
    this.code = port.code;
    this.name = port.name;
  }
}

/**
 * A vessel with its technical data (spec §8.5: owning organization and
 * platform administrators only). Engines are listed as fitted (`role`,
 * `quantity`); `fleet.vessel.upserted.v1` expands them into
 * `mainEngine` / `auxEngines` / `auxEngineQuantity`.
 */
export class VesselDetailDto extends VesselSummaryDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Owning organization',
  })
  readonly orgId: string | null;

  @ApiProperty({
    type: VesselTypeDto,
    description: 'Ship type with its CII parameters',
  })
  override readonly type: VesselTypeDto;

  @ApiProperty({ type: Number, nullable: true, example: 1990 })
  readonly builtYear: number | null;

  @ApiProperty({
    example: 41.6666666666667,
    description: 'Share of the year at sea, percent',
  })
  readonly annualVoyagePercentage: number;

  @ApiProperty({ type: VesselDimensionsDto })
  readonly dimensions: VesselDimensions;

  @ApiProperty({ type: FuelDto })
  readonly fuel: FuelDto;

  @ApiProperty({ type: FuelFormulaDto, nullable: true })
  readonly firstFuelFormula: FuelFormulaDto | null;

  @ApiProperty({
    type: [VesselEngineDto],
    description: 'Main engine first, then auxiliaries',
  })
  readonly engines: VesselEngineDto[];

  @ApiProperty({
    type: [VesselPortDto],
    description: 'Ports of call, in order',
  })
  readonly ports: VesselPortDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Id of the legacy MVP document',
  })
  readonly legacyId: string | null;

  @ApiProperty({ format: 'date-time' })
  readonly createdAt: string;

  constructor(view: Extract<VesselView, { view: 'detail' }>) {
    super(view);
    const { aggregate } = view;
    this.orgId = aggregate.vessel.orgId;
    this.type = new VesselTypeDto(aggregate.type);
    this.builtYear = aggregate.vessel.builtYear;
    this.annualVoyagePercentage = aggregate.vessel.annualVoyagePercentage;
    this.dimensions = { ...aggregate.dimensions };
    this.fuel = new FuelDto(aggregate.fuel);
    this.firstFuelFormula =
      aggregate.firstFuelFormula === null
        ? null
        : new FuelFormulaDto(aggregate.firstFuelFormula);
    this.engines = aggregate.engines.map(
      (fitted) => new VesselEngineDto(fitted),
    );
    this.ports = view.ports.map((port) => new VesselPortDto(port));
    this.legacyId = aggregate.vessel.legacyId;
    this.createdAt = aggregate.vessel.createdAt.toISOString();
  }
}

/** The DTO of a view: detail for the owner, summary for everybody else. */
export function toVesselDto(
  view: VesselView,
): VesselSummaryDto | VesselDetailDto {
  return view.view === 'detail'
    ? new VesselDetailDto(view)
    : new VesselSummaryDto(view);
}

/** OpenAPI schema of a vessel in either view (discriminated by `view`). */
export const VESSEL_VIEW_SCHEMA = {
  oneOf: [
    { $ref: getSchemaPath(VesselDetailDto) },
    { $ref: getSchemaPath(VesselSummaryDto) },
  ],
  discriminator: {
    propertyName: 'view',
    mapping: {
      detail: getSchemaPath(VesselDetailDto),
      summary: getSchemaPath(VesselSummaryDto),
    },
  },
};

/** OpenAPI schema of a page of vessels. */
export const VESSEL_PAGE_SCHEMA = {
  type: 'object',
  required: ['data', 'meta'],
  properties: {
    data: { type: 'array', items: VESSEL_VIEW_SCHEMA },
    meta: { $ref: getSchemaPath(PageMetaDto) },
  },
};

/** `202` of `POST /vessels/:id/republish`. */
export class RepublishResultDto {
  @ApiProperty({ format: 'uuid' })
  readonly vesselId: string;

  @ApiProperty({ example: 1, description: 'Snapshots written to the outbox' })
  readonly enqueued: number;

  constructor(vesselId: string, enqueued: number) {
    this.vesselId = vesselId;
    this.enqueued = enqueued;
  }
}
