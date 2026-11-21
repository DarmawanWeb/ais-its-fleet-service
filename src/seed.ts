import 'reflect-metadata';

import { createLogger, loadConfig } from '@darmawanweb/ais-its-nest';
import {
  createDatabasePool,
  databasePoolSettings,
} from '@darmawanweb/ais-its-nest/db';

import { configSchema } from './config.js';
import { inTransaction } from './db/database.js';
import { SnapshotOutbox } from './modules/snapshots/snapshot-outbox.js';
import { VesselAggregatesRepository } from './modules/snapshots/vessel-aggregates.repository.js';
import { ReferenceSeeder } from './seeds/reference-seeder.js';

// `pnpm seed` (after `pnpm migrate`): idempotent reference data in one
// transaction. Snapshots of vessels whose seeded reference rows changed go to
// the outbox; the running service's relay publishes them.
const config = loadConfig(configSchema);
const logger = createLogger({
  service: `${config.SERVICE_NAME}-seed`,
  version: config.SERVICE_VERSION,
  level: config.LOG_LEVEL,
  pretty: config.LOG_PRETTY,
});
const pool = createDatabasePool(databasePoolSettings(config));
try {
  const seeder = new ReferenceSeeder(
    new SnapshotOutbox(new VesselAggregatesRepository()),
  );
  const report = await inTransaction(pool, (transaction) =>
    seeder.run(transaction),
  );
  logger.info({ report }, 'Reference data seeded');
} catch (error) {
  logger.error({ err: error }, 'Seeding failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
