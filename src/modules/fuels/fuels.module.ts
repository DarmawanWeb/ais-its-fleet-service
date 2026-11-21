import { Module } from '@nestjs/common';

import { SnapshotsModule } from '../snapshots/snapshots.module.js';
import { FuelsController } from './fuels.controller.js';
import { FuelsRepository } from './fuels.repository.js';
import { FuelsService } from './fuels.service.js';

/** Fuels (reference data). */
@Module({
  imports: [SnapshotsModule],
  controllers: [FuelsController],
  providers: [FuelsService, FuelsRepository],
})
export class FuelsModule {}
