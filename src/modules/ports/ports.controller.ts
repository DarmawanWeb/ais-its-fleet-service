import type { Paginated } from '@darmawanweb/ais-its-contracts/api';
import {
  CurrentPrincipal,
  type Principal,
  RequirePermissions,
} from '@darmawanweb/ais-its-nest/auth';
import {
  ApiPageResponse,
  bboxOf,
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

import { ReferenceUsage } from '../snapshots/reference-usage.js';
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
  constructor(
    private readonly ports: PortsService,
    private readonly usage: ReferenceUsage,
  ) {}

  @Get()
  @RequirePermissions('vessel:read')
  @ApiOperation({ summary: 'List ports (optionally inside a bbox)' })
  @ApiPageResponse(PortDto)
  async list(
    @Query() query: ListPortsQuery,
    @CurrentPrincipal() principal: Principal,
  ): Promise<Paginated<PortDto>> {
    const page = await this.ports.list({
      page: query.page,
      pageSize: query.pageSize,
      search: query.search,
      bbox: bboxOf(query),
    });
    const counts = await this.usage.countsFor(
      principal,
      'port',
      page.data.map((port) => port.id),
    );
    return {
      ...page,
      data: page.data.map((port) => new PortDto(port, counts?.of(port.id))),
    };
  }

  @Get(':id')
  @RequirePermissions('vessel:read')
  @ApiOperation({ summary: 'Get a port' })
  @ApiOkResponse({ type: PortDto })
  async get(
    @UuidParam() id: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<PortDto> {
    const port = await this.ports.get(id);
    const counts = await this.usage.countsFor(principal, 'port', [id]);
    return new PortDto(port, counts?.of(id));
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
    @UuidParam() id: string,
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
    @UuidParam() id: string,
    @CurrentPrincipal() principal: Principal,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.ports.remove(id, principal, request);
  }
}
