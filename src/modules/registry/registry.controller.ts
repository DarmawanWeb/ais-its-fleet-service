import type { Paginated } from '@darmawanweb/ais-its-contracts/api';
import { RequirePermissions } from '@darmawanweb/ais-its-nest/auth';
import { ApiPageResponse } from '@darmawanweb/ais-its-nest/http';
import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import {
  RegistryParticularsDto,
  RegistrySearchQuery,
} from './dto/registry.dto.js';
import { RegistryService } from './registry.service.js';

/** Registry particulars (legacy secondary ship data): `/api/v2/registry` (spec §13.3). */
@ApiTags('registry')
@Controller('registry')
export class RegistryController {
  constructor(private readonly registry: RegistryService) {}

  @Get('search')
  @RequirePermissions('vessel:read')
  @ApiOperation({
    summary: 'Search registry particulars by name, IMO number or MMSI',
  })
  @ApiPageResponse(RegistryParticularsDto)
  async search(
    @Query() query: RegistrySearchQuery,
  ): Promise<Paginated<RegistryParticularsDto>> {
    const page = await this.registry.search(query);
    return {
      ...page,
      data: page.data.map((entry) => new RegistryParticularsDto(entry)),
    };
  }

  @Get(':imoOrMmsi')
  @RequirePermissions('vessel:read')
  @ApiOperation({ summary: 'Registry particulars of an MMSI or IMO number' })
  @ApiParam({
    name: 'imoOrMmsi',
    example: '525005223',
    description:
      'MMSI (9 digits) or IMO number (7 digits, optionally prefixed with IMO)',
  })
  @ApiOkResponse({ type: RegistryParticularsDto })
  async get(
    @Param('imoOrMmsi') imoOrMmsi: string,
  ): Promise<RegistryParticularsDto> {
    return new RegistryParticularsDto(await this.registry.get(imoOrMmsi));
  }
}
