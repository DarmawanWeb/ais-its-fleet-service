import { Module } from '@nestjs/common';

import { SnapshotsModule } from '../snapshots/snapshots.module.js';
import { PortsController } from './ports.controller.js';
import { PortsRepository } from './ports.repository.js';
import { PortsService } from './ports.service.js';

/** Ports of call (reference data). */
@Module({
  imports: [SnapshotsModule],
  controllers: [PortsController],
  providers: [PortsService, PortsRepository],
})
export class PortsModule {}
