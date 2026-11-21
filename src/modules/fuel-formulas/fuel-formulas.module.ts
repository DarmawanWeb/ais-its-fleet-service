import { Module } from '@nestjs/common';

import { SnapshotsModule } from '../snapshots/snapshots.module.js';
import { FuelFormulasController } from './fuel-formulas.controller.js';
import { FuelFormulasRepository } from './fuel-formulas.repository.js';
import { FuelFormulasService } from './fuel-formulas.service.js';

/** First fuel formulas (reference data). */
@Module({
  imports: [SnapshotsModule],
  controllers: [FuelFormulasController],
  providers: [FuelFormulasService, FuelFormulasRepository],
})
export class FuelFormulasModule {}
