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
import { CreateFuelDto, FuelDto, UpdateFuelDto } from './dto/fuel.dto.js';
import { FuelsService } from './fuels.service.js';

/** Fuels with CO2 conversion factors: `/api/v2/fuels` (spec §13.3). */
@ApiTags('fuels')
@Controller('fuels')
export class FuelsController {
  constructor(
    private readonly fuels: FuelsService,
    private readonly usage: ReferenceUsage,
  ) {}

  @Get()
  @RequirePermissions('vessel:read')
  @ApiOperation({ summary: 'List fuels (Cf, carbon content, density)' })
  @ApiPageResponse(FuelDto)
  async list(
    @Query() query: ReferenceListQuery,
    @CurrentPrincipal() principal: Principal,
  ): Promise<Paginated<FuelDto>> {
    const page = await this.fuels.list(query);
    const counts = await this.usage.countsFor(
      principal,
      'fuel',
      page.data.map((fuel) => fuel.id),
    );
    return {
      ...page,
      data: page.data.map((fuel) => new FuelDto(fuel, counts?.of(fuel.id))),
    };
  }

  @Get(':id')
  @RequirePermissions('vessel:read')
  @ApiOperation({ summary: 'Get a fuel' })
  @ApiOkResponse({ type: FuelDto })
  async get(
    @UuidParam() id: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<FuelDto> {
    const fuel = await this.fuels.get(id);
    const counts = await this.usage.countsFor(principal, 'fuel', [id]);
    return new FuelDto(fuel, counts?.of(id));
  }

  @Post()
  @RequirePermissions('reference:write')
  @ApiOperation({ summary: 'Create a fuel' })
  @ApiCreatedResponse({ type: FuelDto })
  async create(
    @Body() body: CreateFuelDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: FastifyRequest,
  ): Promise<FuelDto> {
    return new FuelDto(await this.fuels.create(body, principal, request));
  }

  @Patch(':id')
  @RequirePermissions('reference:write')
  @ApiOperation({
    summary: 'Change a fuel',
    description:
      'Republishes the snapshot of every vessel burning the fuel (fleet.vessel.upserted.v1).',
  })
  @ApiOkResponse({ type: FuelDto })
  async update(
    @UuidParam() id: string,
    @Body() body: UpdateFuelDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: FastifyRequest,
  ): Promise<FuelDto> {
    const { value } = await this.fuels.update(id, body, principal, request);
    return new FuelDto(value);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('reference:write')
  @ApiOperation({
    summary: 'Delete an unused fuel (409 REFERENCE_IN_USE otherwise)',
  })
  @ApiNoContentResponse()
  async remove(
    @UuidParam() id: string,
    @CurrentPrincipal() principal: Principal,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.fuels.remove(id, principal, request);
  }
}
