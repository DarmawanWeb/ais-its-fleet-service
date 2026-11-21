import { Module } from '@nestjs/common';

import { SnapshotsModule } from '../snapshots/snapshots.module.js';
import { EnginesController } from './engines.controller.js';
import { EnginesRepository } from './engines.repository.js';
import { EnginesService } from './engines.service.js';

/** Engine catalogue (reference data). */
@Module({
  imports: [SnapshotsModule],
  controllers: [EnginesController],
  providers: [EnginesService, EnginesRepository],
})
export class EnginesModule {}
