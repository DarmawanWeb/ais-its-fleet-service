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
import {
  CreateFuelFormulaDto,
  FuelFormulaDto,
  UpdateFuelFormulaDto,
} from './dto/fuel-formula.dto.js';
import { FuelFormulasService } from './fuel-formulas.service.js';

/** First fuel formulas: `/api/v2/fuel-formulas` (spec §13.3, §13.5). */
@ApiTags('fuel-formulas')
@Controller('fuel-formulas')
export class FuelFormulasController {
  constructor(private readonly formulas: FuelFormulasService) {}

  @Get()
  @RequirePermissions('vessel:read')
  @ApiOperation({ summary: 'List first fuel formulas' })
  @ApiPageResponse(FuelFormulaDto)
  async list(
    @Query() query: ReferenceListQuery,
  ): Promise<Paginated<FuelFormulaDto>> {
    const page = await this.formulas.list(query);
    return {
      ...page,
      data: page.data.map((formula) => new FuelFormulaDto(formula)),
    };
  }

  @Get(':id')
  @RequirePermissions('vessel:read')
  @ApiOperation({ summary: 'Get a first fuel formula' })
  @ApiOkResponse({ type: FuelFormulaDto })
  async get(@Param('id', ID_PIPE) id: string): Promise<FuelFormulaDto> {
    return new FuelFormulaDto(await this.formulas.get(id));
  }

  @Post()
  @RequirePermissions('reference:write')
  @ApiOperation({
    summary:
      'Create a first fuel formula (strings validated against the safe grammar)',
  })
  @ApiCreatedResponse({ type: FuelFormulaDto })
  async create(
    @Body() body: CreateFuelFormulaDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: FastifyRequest,
  ): Promise<FuelFormulaDto> {
    return new FuelFormulaDto(
      await this.formulas.create(body, principal, request),
    );
  }

  @Patch(':id')
  @RequirePermissions('reference:write')
  @ApiOperation({
    summary: 'Change a first fuel formula',
    description:
      'Republishes the snapshot of every vessel using the formula (fleet.vessel.upserted.v1).',
  })
  @ApiOkResponse({ type: FuelFormulaDto })
  async update(
    @Param('id', ID_PIPE) id: string,
    @Body() body: UpdateFuelFormulaDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: FastifyRequest,
  ): Promise<FuelFormulaDto> {
    const { value } = await this.formulas.update(id, body, principal, request);
    return new FuelFormulaDto(value);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('reference:write')
  @ApiOperation({
    summary:
      'Delete an unused first fuel formula (409 REFERENCE_IN_USE otherwise)',
  })
  @ApiNoContentResponse()
  async remove(
    @Param('id', ID_PIPE) id: string,
    @CurrentPrincipal() principal: Principal,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.formulas.remove(id, principal, request);
  }
}
