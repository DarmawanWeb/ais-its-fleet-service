import type { Paginated } from '@darmawanweb/ais-its-contracts/api';
import {
  CurrentPrincipal,
  type Principal,
  RequirePermissions,
  RequirePlatformAdmin,
} from '@darmawanweb/ais-its-nest/auth';
import {
  MmsiParam,
  PageMetaDto,
  UuidParam,
} from '@darmawanweb/ais-its-nest/http';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { PHOTO_MAX_BYTES } from '../../domain/photo.js';
import { ArrayBodyPipe, UuidArrayBodyPipe } from '../common/array-body.pipe.js';
import {
  CreateVesselDto,
  ListVesselsQuery,
  MAX_VESSEL_ENGINES,
  MAX_VESSEL_PORTS,
  UpdateVesselDto,
  VesselDimensionsDto,
  VesselEngineInputDto,
} from './dto/vessel-input.dto.js';
import {
  RepublishResultDto,
  toVesselDto,
  VESSEL_PAGE_SCHEMA,
  VESSEL_VIEW_SCHEMA,
  VesselDetailDto,
  VesselSummaryDto,
} from './dto/vessel-output.dto.js';
import { readPhotoUpload } from './photo-upload.js';
import type { VesselView } from './vessel-view.js';
import { VesselPhotosService } from './vessel-photos.service.js';
import { VesselsService } from './vessels.service.js';

/** The detail view of a vessel the principal just changed (it owns it). */
function detailOf(view: VesselView): VesselDetailDto {
  if (view.view !== 'detail') {
    // Writes require ownership, which implies the detail view.
    throw new Error(
      `Vessel ${view.identity.vessel.id} changed without detail access`,
    );
  }
  return new VesselDetailDto(view);
}

/**
 * Vessels: `/api/v2/vessels` (spec §13.3). Reads need `vessel:read` and
 * return the detail view for the owning organization, the summary view
 * otherwise (§8.5); writes need `vessel:write` and ownership.
 */
@ApiTags('vessels')
@ApiExtraModels(VesselSummaryDto, VesselDetailDto, PageMetaDto)
@Controller('vessels')
export class VesselsController {
  constructor(
    private readonly vessels: VesselsService,
    private readonly photos: VesselPhotosService,
  ) {}

  @Get()
  @RequirePermissions('vessel:read')
  @ApiOperation({
    summary: 'List vessels',
    description:
      'Identity fields for every vessel (`view: summary`); technical fields only for vessels of the active organization (`view: detail`).',
  })
  @ApiOkResponse({ schema: VESSEL_PAGE_SCHEMA })
  async list(
    @Query() query: ListVesselsQuery,
    @CurrentPrincipal() principal: Principal,
  ): Promise<Paginated<VesselSummaryDto | VesselDetailDto>> {
    const page = await this.vessels.list(query, principal);
    return { ...page, data: page.data.map(toVesselDto) };
  }

  @Post()
  @RequirePermissions('vessel:write')
  @ApiOperation({
    summary: 'Register a vessel in the active organization',
    description:
      'Platform administrators may set `orgId`. Publishes fleet.vessel.upserted.v1.',
  })
  @ApiCreatedResponse({ type: VesselDetailDto })
  async create(
    @Body() body: CreateVesselDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: FastifyRequest,
  ): Promise<VesselDetailDto> {
    return detailOf(await this.vessels.create(body, principal, request));
  }

  @Get('by-mmsi/:mmsi')
  @RequirePermissions('vessel:read')
  @ApiOperation({ summary: 'Get a vessel by MMSI' })
  @ApiOkResponse({ schema: VESSEL_VIEW_SCHEMA })
  async getByMmsi(
    @MmsiParam('mmsi', { description: 'MMSI: exactly nine digits' })
    mmsi: number,
    @CurrentPrincipal() principal: Principal,
  ): Promise<VesselSummaryDto | VesselDetailDto> {
    return toVesselDto(await this.vessels.get({ mmsi }, principal));
  }

  @Get(':id')
  @RequirePermissions('vessel:read')
  @ApiOperation({ summary: 'Get a vessel' })
  @ApiOkResponse({ schema: VESSEL_VIEW_SCHEMA })
  async get(
    @UuidParam() id: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<VesselSummaryDto | VesselDetailDto> {
    return toVesselDto(await this.vessels.get({ id }, principal));
  }

  @Patch(':id')
  @RequirePermissions('vessel:write')
  @ApiOperation({
    summary: 'Change identity, status, voyage share or references of a vessel',
  })
  @ApiOkResponse({ type: VesselDetailDto })
  async update(
    @UuidParam() id: string,
    @Body() body: UpdateVesselDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: FastifyRequest,
  ): Promise<VesselDetailDto> {
    return detailOf(await this.vessels.update(id, body, principal, request));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('vessel:write')
  @ApiOperation({
    summary: 'Delete a vessel (publishes fleet.vessel.deleted.v1)',
  })
  @ApiNoContentResponse()
  async remove(
    @UuidParam() id: string,
    @CurrentPrincipal() principal: Principal,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.vessels.remove(id, principal, request);
  }

  @Put(':id/dimensions')
  @RequirePermissions('vessel:write')
  @ApiOperation({ summary: 'Replace the dimensions and hull coefficients' })
  @ApiOkResponse({ type: VesselDetailDto })
  async replaceDimensions(
    @UuidParam() id: string,
    @Body() body: VesselDimensionsDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: FastifyRequest,
  ): Promise<VesselDetailDto> {
    return detailOf(
      await this.vessels.replaceDimensions(id, body, principal, request),
    );
  }

  @Put(':id/engines')
  @RequirePermissions('vessel:write')
  @ApiOperation({
    summary: 'Replace the fitted engines',
    description:
      'At most one main-engine row; each engine once per role (identical engines: quantity); the role must equal the catalogue kind.',
  })
  @ApiBody({ type: [VesselEngineInputDto] })
  @ApiOkResponse({ type: VesselDetailDto })
  async replaceEngines(
    @UuidParam() id: string,
    @Body(new ArrayBodyPipe(VesselEngineInputDto, MAX_VESSEL_ENGINES))
    engines: VesselEngineInputDto[],
    @CurrentPrincipal() principal: Principal,
    @Req() request: FastifyRequest,
  ): Promise<VesselDetailDto> {
    return detailOf(
      await this.vessels.replaceEngines(id, engines, principal, request),
    );
  }

  @Put(':id/ports')
  @RequirePermissions('vessel:write')
  @ApiOperation({ summary: 'Replace the ports of call (ordered port ids)' })
  @ApiBody({
    schema: {
      type: 'array',
      items: { type: 'string', format: 'uuid' },
      maxItems: MAX_VESSEL_PORTS,
      uniqueItems: true,
    },
  })
  @ApiOkResponse({ type: VesselDetailDto })
  async replacePorts(
    @UuidParam() id: string,
    @Body(new UuidArrayBodyPipe(MAX_VESSEL_PORTS)) portIds: string[],
    @CurrentPrincipal() principal: Principal,
    @Req() request: FastifyRequest,
  ): Promise<VesselDetailDto> {
    return detailOf(
      await this.vessels.replacePorts(id, portIds, principal, request),
    );
  }

  @Post(':id/photo')
  @RequirePermissions('vessel:write')
  @ApiOperation({
    summary: 'Upload the vessel photo',
    description: `JPEG, PNG or WebP (recognized by content), at most ${PHOTO_MAX_BYTES} bytes; replaces the previous photo.`,
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiCreatedResponse({ type: VesselDetailDto })
  async uploadPhoto(
    @UuidParam() id: string,
    @CurrentPrincipal() principal: Principal,
    @Req() request: FastifyRequest,
  ): Promise<VesselDetailDto> {
    const bytes = await readPhotoUpload(request);
    return detailOf(await this.photos.upload(id, bytes, principal, request));
  }

  @Delete(':id/photo')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('vessel:write')
  @ApiOperation({
    summary: 'Delete the vessel photo (removes the stored object)',
  })
  @ApiNoContentResponse()
  async removePhoto(
    @UuidParam() id: string,
    @CurrentPrincipal() principal: Principal,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.photos.remove(id, principal, request);
  }

  @Post(':id/republish')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions('vessel:write')
  @RequirePlatformAdmin()
  @ApiOperation({
    summary: 'Re-enqueue the snapshot of a vessel (super_admin)',
    description:
      'Enqueues one fleet.vessel.upserted.v1 with the current data; the relay publishes it asynchronously.',
  })
  @ApiAcceptedResponse({ type: RepublishResultDto })
  async republish(
    @UuidParam() id: string,
    @CurrentPrincipal() principal: Principal,
    @Req() request: FastifyRequest,
  ): Promise<RepublishResultDto> {
    const enqueued = await this.vessels.republish(id, principal, request);
    return new RepublishResultDto(id, enqueued);
  }
}
