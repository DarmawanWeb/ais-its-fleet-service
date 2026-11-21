import { Module } from '@nestjs/common';

import { SnapshotsModule } from '../snapshots/snapshots.module.js';
import { VesselTypesController } from './vessel-types.controller.js';
import { VesselTypesRepository } from './vessel-types.repository.js';
import { VesselTypesService } from './vessel-types.service.js';

/** Ship types (reference data). */
@Module({
  imports: [SnapshotsModule],
  controllers: [VesselTypesController],
  providers: [VesselTypesService, VesselTypesRepository],
})
export class VesselTypesModule {}
