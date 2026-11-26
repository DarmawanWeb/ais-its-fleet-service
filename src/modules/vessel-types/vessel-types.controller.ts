import type { Paginated } from '@darmawanweb/ais-its-contracts/api';
import {
  CurrentPrincipal,
  type Principal,
  RequirePermissions,
} from '@darmawanweb/ais-its-nest/auth';
import { ApiPageResponse, UuidParam } from '@darmawanweb/ais-its-nest/http';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { ReferenceListQuery } from '../common/validation.js';
import { ReferenceUsage } from '../snapshots/reference-usage.js';
import {
  CreateVesselTypeDto,
  UpdateVesselTypeDto,
  VesselTypeDto,
} from './dto/vessel-type.dto.js';
import { VesselTypesService } from './vessel-types.service.js';

/** Ship types with CII reference lines: `/api/v2/vessel-types` (spec §13.3). */
@ApiTags('vessel-types')
@Controller('vessel-types')
export class VesselTypesController {
  constructor(
    private readonly types: VesselTypesService,
    private readonly usage: ReferenceUsage,
  ) {}

  @Get()
  @RequirePermissions('vessel:read')
  @ApiOperation({
    summary: 'List ship types (CII reference line and rating vector)',
  })
  @ApiPageResponse(VesselTypeDto)
  async list(
    @Query() query: ReferenceListQuery,
    @CurrentPrincipal() principal: Principal,
  ): Promise<Paginated<VesselTypeDto>> {
    const page = await this.types.list(query);
    const counts = await this.usage.countsFor(
      principal,
      'vesselType',
      page.data.map((type) => type.id),
    );
    return {
      ...page,
      data: page.data.map(
        (type) => new VesselTypeDto(type, counts?.of(type.id)),
      ),
    };
  }

  @Get(':id')
  @RequirePermissions('vessel:read')
  @ApiOperation({ summary: 'Get a ship type' })
  @ApiOkResponse({ type: VesselTypeDto })
  async get(
    @UuidParam() id: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<VesselTypeDto> {
    const type = await this.types.get(id);
    const counts = await this.usage.countsFor(principal, 'vesselType', [id]);
    return new VesselTypeDto(type, counts?.of(id));
  }

  @Post()
  @RequirePermissions('reference:write')
  @ApiOperation({ summary: 'Create a ship type' })
  @ApiCreatedResponse({ type: VesselTypeDto })
  async create(
    @Body() body: CreateVesselTypeDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: FastifyRequest,
  ): Promise<VesselTypeDto> {
    return new VesselTypeDto(await this.types.create(body, principal, request));
  }

  @Patch(':id')
  @RequirePermissions('reference:write')
  @ApiOperation({
    summary: 'Change a ship type',
    description:
      'Republishes the snapshot of every vessel of the type (fleet.vessel.upserted.v1).',
  })
  @ApiOkResponse({ type: VesselTypeDto })
  async update(
    @UuidParam() id: string,
    @Body() body: UpdateVesselTypeDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: FastifyRequest,
  ): Promise<VesselTypeDto> {
    const { value } = await this.types.update(id, body, principal, request);
    return new VesselTypeDto(value);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('reference:write')
  @ApiOperation({
    summary: 'Delete an unused ship type (409 REFERENCE_IN_USE otherwise)',
  })
  @ApiNoContentResponse()
  async remove(
    @UuidParam() id: string,
    @CurrentPrincipal() principal: Principal,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.types.remove(id, principal, request);
  }
}
