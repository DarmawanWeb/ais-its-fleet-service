import { Module } from '@nestjs/common';

import { RegistryController } from './registry.controller.js';
import { RegistryRepository } from './registry.repository.js';
import { RegistryService } from './registry.service.js';

/** Registry particulars (legacy `SecondaryShip`). */
@Module({
  controllers: [RegistryController],
  providers: [RegistryService, RegistryRepository],
})
export class RegistryModule {}
