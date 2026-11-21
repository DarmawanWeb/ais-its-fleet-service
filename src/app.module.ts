import { AuditModule } from '@darmawanweb/ais-its-nest/audit';
import { AuthModule } from '@darmawanweb/ais-its-nest/auth';
import { DatabaseModule } from '@darmawanweb/ais-its-nest/db';
import { NatsModule } from '@darmawanweb/ais-its-nest/nats';
import { Module } from '@nestjs/common';

import * as schema from './db/schema.js';
import { EnginesModule } from './modules/engines/engines.module.js';
import { FuelFormulasModule } from './modules/fuel-formulas/fuel-formulas.module.js';
import { FuelsModule } from './modules/fuels/fuels.module.js';
import { MethodologyModule } from './modules/methodology/methodology.module.js';
import { PortsModule } from './modules/ports/ports.module.js';
import { RegistryModule } from './modules/registry/registry.module.js';
import { SnapshotsModule } from './modules/snapshots/snapshots.module.js';
import { VesselTypesModule } from './modules/vessel-types/vessel-types.module.js';
import { VesselsModule } from './modules/vessels/vessels.module.js';

/**
 * Root module. `bootstrapService()` wraps it in the kit's platform root module
 * (configuration, logging, metrics, health, validation, problem details).
 * Nothing connects at construction time: connections, migrations, streams,
 * the outbox relay and the bucket check run in lifecycle hooks.
 */
@Module({
  imports: [
    // pg pool + drizzle (search_path=<DATABASE_SCHEMA>,public); migrations on boot.
    DatabaseModule.forRoot({ schema }),
    // This service produces the FLEET stream (created / widened at boot, spec §7.2).
    NatsModule.forRoot({ streams: ['FLEET'] }),
    // Global default-deny guard: every route needs a principal unless @Public().
    AuthModule.forRoot(),
    // audit.recorded.v1 for every change (global; ensures the AUDIT stream).
    AuditModule,
    MethodologyModule,
    SnapshotsModule,
    VesselsModule,
    VesselTypesModule,
    FuelsModule,
    EnginesModule,
    FuelFormulasModule,
    PortsModule,
    RegistryModule,
  ],
})
export class AppModule {}
