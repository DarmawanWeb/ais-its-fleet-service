import { Module } from '@nestjs/common';

import { SnapshotsModule } from '../snapshots/snapshots.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { VesselPhotosService } from './vessel-photos.service.js';
import { VesselsController } from './vessels.controller.js';
import { VesselsRepository } from './vessels.repository.js';
import { VesselsService } from './vessels.service.js';

/** Vessels, their dimensions, engines, ports and photos. */
@Module({
  imports: [SnapshotsModule, StorageModule],
  controllers: [VesselsController],
  providers: [VesselsService, VesselPhotosService, VesselsRepository],
})
export class VesselsModule {}
