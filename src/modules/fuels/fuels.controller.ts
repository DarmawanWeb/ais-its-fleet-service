import type { Paginated } from '@darmawanweb/ais-its-contracts/api';
import {
  CurrentPrincipal,
  type Principal,
  RequirePermissions,
} from '@darmawanweb/ais-its-nest/auth';
import { ApiPageResponse } from '@darmawanweb/ais-its-nest/http';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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

import { ID_PIPE } from '../common/params.js';
import { ReferenceListQuery } from '../common/validation.js';
import { CreateFuelDto, FuelDto, UpdateFuelDto } from './dto/fuel.dto.js';
import { FuelsService } from './fuels.service.js';

/** Fuels with CO2 conversion factors: `/api/v2/fuels` (spec §13.3). */
@ApiTags('fuels')
@Controller('fuels')
export class FuelsController {
  constructor(private readonly fuels: FuelsService) {}

  @Get()
  @RequirePermissions('vessel:read')
  @ApiOperation({ summary: 'List fuels (Cf, carbon content, density)' })
  @ApiPageResponse(FuelDto)
  async list(@Query() query: ReferenceListQuery): Promise<Paginated<FuelDto>> {
    const page = await this.fuels.list(query);
    return { ...page, data: page.data.map((fuel) => new FuelDto(fuel)) };
  }

  @Get(':id')
  @RequirePermissions('vessel:read')
  @ApiOperation({ summary: 'Get a fuel' })
  @ApiOkResponse({ type: FuelDto })
  async get(@Param('id', ID_PIPE) id: string): Promise<FuelDto> {
    return new FuelDto(await this.fuels.get(id));
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
    @Param('id', ID_PIPE) id: string,
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
    @Param('id', ID_PIPE) id: string,
    @CurrentPrincipal() principal: Principal,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.fuels.remove(id, principal, request);
  }
}
