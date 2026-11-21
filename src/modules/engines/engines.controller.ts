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

import {
  CreateEngineDto,
  EngineDto,
  ListEnginesQuery,
  UpdateEngineDto,
} from './dto/engine.dto.js';
import { ID_PIPE } from '../common/params.js';
import { EnginesService } from './engines.service.js';

/** Engine catalogue: `/api/v2/engines?kind=` (spec §13.3). */
@ApiTags('engines')
@Controller('engines')
export class EnginesController {
  constructor(private readonly engines: EnginesService) {}

  @Get()
  @RequirePermissions('vessel:read')
  @ApiOperation({ summary: 'List engines (main or auxiliary)' })
  @ApiPageResponse(EngineDto)
  async list(@Query() query: ListEnginesQuery): Promise<Paginated<EngineDto>> {
    const page = await this.engines.list(query);
    return { ...page, data: page.data.map((engine) => new EngineDto(engine)) };
  }

  @Get(':id')
  @RequirePermissions('vessel:read')
  @ApiOperation({ summary: 'Get an engine' })
  @ApiOkResponse({ type: EngineDto })
  async get(@Param('id', ID_PIPE) id: string): Promise<EngineDto> {
    return new EngineDto(await this.engines.get(id));
  }

  @Post()
  @RequirePermissions('reference:write')
  @ApiOperation({ summary: 'Create an engine' })
  @ApiCreatedResponse({ type: EngineDto })
  async create(
    @Body() body: CreateEngineDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: FastifyRequest,
  ): Promise<EngineDto> {
    return new EngineDto(await this.engines.create(body, principal, request));
  }

  @Patch(':id')
  @RequirePermissions('reference:write')
  @ApiOperation({
    summary: 'Change an engine',
    description:
      'Republishes the snapshot of every vessel the engine is fitted to (fleet.vessel.upserted.v1); the kind of an engine in use cannot change.',
  })
  @ApiOkResponse({ type: EngineDto })
  async update(
    @Param('id', ID_PIPE) id: string,
    @Body() body: UpdateEngineDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: FastifyRequest,
  ): Promise<EngineDto> {
    const { value } = await this.engines.update(id, body, principal, request);
    return new EngineDto(value);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('reference:write')
  @ApiOperation({
    summary: 'Delete an unused engine (409 REFERENCE_IN_USE otherwise)',
  })
  @ApiNoContentResponse()
  async remove(
    @Param('id', ID_PIPE) id: string,
    @CurrentPrincipal() principal: Principal,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.engines.remove(id, principal, request);
  }
}
