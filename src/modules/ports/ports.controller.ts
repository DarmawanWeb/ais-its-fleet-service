import type { Paginated } from '@darmawanweb/ais-its-contracts/api';
import {
  CurrentPrincipal,
  type Principal,
  RequirePermissions,
} from '@darmawanweb/ais-its-nest/auth';
import { ApiPageResponse, bboxOf } from '@darmawanweb/ais-its-nest/http';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
  CreatePortDto,
  ListPortsQuery,
  PortDto,
  UpdatePortDto,
} from './dto/port.dto.js';
import { PortsService } from './ports.service.js';

/** Ports of call with GeoJSON positions: `/api/v2/ports` (spec §13.3). */
@ApiTags('ports')
@Controller('ports')
export class PortsController {
  constructor(private readonly ports: PortsService) {}

  @Get()
  @RequirePermissions('vessel:read')
  @ApiOperation({ summary: 'List ports (optionally inside a bbox)' })
  @ApiPageResponse(PortDto)
  async list(@Query() query: ListPortsQuery): Promise<Paginated<PortDto>> {
    const page = await this.ports.list({
      page: query.page,
      pageSize: query.pageSize,
      search: query.search,
      bbox: bboxOf(query),
    });
    return { ...page, data: page.data.map((port) => new PortDto(port)) };
  }

  @Get(':id')
  @RequirePermissions('vessel:read')
  @ApiOperation({ summary: 'Get a port' })
  @ApiOkResponse({ type: PortDto })
  async get(@Param('id', new ParseUUIDPipe()) id: string): Promise<PortDto> {
    return new PortDto(await this.ports.get(id));
  }

  @Post()
  @RequirePermissions('reference:write')
  @ApiOperation({ summary: 'Create a port' })
  @ApiCreatedResponse({ type: PortDto })
  async create(
    @Body() body: CreatePortDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: FastifyRequest,
  ): Promise<PortDto> {
    return new PortDto(await this.ports.create(body, principal, request));
  }

  @Patch(':id')
  @RequirePermissions('reference:write')
  @ApiOperation({
    summary: 'Change a port',
  })
  @ApiOkResponse({ type: PortDto })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdatePortDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: FastifyRequest,
  ): Promise<PortDto> {
    return new PortDto(await this.ports.update(id, body, principal, request));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('reference:write')
  @ApiOperation({
    summary:
      'Delete a port no vessel calls at (409 REFERENCE_IN_USE otherwise)',
  })
  @ApiNoContentResponse()
  async remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentPrincipal() principal: Principal,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.ports.remove(id, principal, request);
  }
}
