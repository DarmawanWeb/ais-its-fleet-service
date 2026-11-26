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
import { fuelFormulaProblem } from '../../domain/fuel-formula-problem.js';
import {
  CreateFuelFormulaDto,
  FuelFormulaDto,
  FuelFormulaValidationDto,
  UpdateFuelFormulaDto,
  ValidateFuelFormulaDto,
} from './dto/fuel-formula.dto.js';
import { FuelFormulasService } from './fuel-formulas.service.js';

/** First fuel formulas: `/api/v2/fuel-formulas` (spec §13.3, §13.5). */
@ApiTags('fuel-formulas')
@Controller('fuel-formulas')
export class FuelFormulasController {
  constructor(
    private readonly formulas: FuelFormulasService,
    private readonly usage: ReferenceUsage,
  ) {}

  @Get()
  @RequirePermissions('vessel:read')
  @ApiOperation({ summary: 'List first fuel formulas' })
  @ApiPageResponse(FuelFormulaDto)
  async list(
    @Query() query: ReferenceListQuery,
    @CurrentPrincipal() principal: Principal,
  ): Promise<Paginated<FuelFormulaDto>> {
    const page = await this.formulas.list(query);
    const counts = await this.usage.countsFor(
      principal,
      'fuelFormula',
      page.data.map((formula) => formula.id),
    );
    return {
      ...page,
      data: page.data.map(
        (formula) => new FuelFormulaDto(formula, counts?.of(formula.id)),
      ),
    };
  }

  @Get(':id')
  @RequirePermissions('vessel:read')
  @ApiOperation({ summary: 'Get a first fuel formula' })
  @ApiOkResponse({ type: FuelFormulaDto })
  async get(
    @UuidParam() id: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<FuelFormulaDto> {
    const formula = await this.formulas.get(id);
    const counts = await this.usage.countsFor(principal, 'fuelFormula', [id]);
    return new FuelFormulaDto(formula, counts?.of(id));
  }

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('vessel:read')
  @ApiOperation({
    summary: 'Check a formula against the safe grammar',
    description:
      'The grammar the service stores formulas with (contracts validateFuelFormula: numbers, speedKnot, + - * / ** ^, parentheses, exp, log/ln, sqrt, pow, abs, min, max; at most 500 characters, depth 32). ' +
      'The formula is checked as POST and PATCH store it, without surrounding whitespace; positions refer to the text as sent. ' +
      'Always 200 with { valid, problem }: the first problem with a stable code, its position and token. Nothing is stored. ' +
      'Clients on contracts >= 0.4 can run validateFuelFormula locally instead.',
  })
  @ApiOkResponse({ type: FuelFormulaValidationDto })
  validate(@Body() body: ValidateFuelFormulaDto): FuelFormulaValidationDto {
    return new FuelFormulaValidationDto(fuelFormulaProblem(body.formula));
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
    @UuidParam() id: string,
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
    @UuidParam() id: string,
    @CurrentPrincipal() principal: Principal,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.formulas.remove(id, principal, request);
  }
}
