import { readFile } from 'node:fs/promises';

import { createLogger, loadConfig } from '@darmawanweb/ais-its-nest';
import {
  createDatabasePool,
  databasePoolSettings,
} from '@darmawanweb/ais-its-nest/db';

import { configSchema } from './config.js';
import { inTransaction } from './db/database.js';
import type { LegacySecondaryShip } from './domain/registry.js';
import { importLegacyRegistry } from './modules/registry/registry-importer.js';
import { RegistryRepository } from './modules/registry/registry.repository.js';

/** A JSON array, or NDJSON as written by `mongoexport` (one document per line). */
function parseDocuments(text: string): LegacySecondaryShip[] {
  const trimmed = text.trim();
  const values: unknown[] = trimmed.startsWith('[')
    ? (JSON.parse(trimmed) as unknown[])
    : trimmed
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as unknown);
  return values.filter(
    (value): value is LegacySecondaryShip =>
      typeof value === 'object' && value !== null && !Array.isArray(value),
  );
}

// `pnpm registry:import <file>`: loads legacy SecondaryShip documents
// (mongoexport JSON or NDJSON) into registry_particulars.
const config = loadConfig(configSchema);
const logger = createLogger({
  service: `${config.SERVICE_NAME}-registry-import`,
  version: config.SERVICE_VERSION,
  level: config.LOG_LEVEL,
  pretty: config.LOG_PRETTY,
});
const file = process.argv[2];
if (file === undefined) {
  logger.error('Usage: pnpm registry:import <secondaryships.json>');
  process.exitCode = 2;
} else {
  const pool = createDatabasePool(databasePoolSettings(config));
  try {
    const documents = parseDocuments(await readFile(file, 'utf8'));
    const report = await inTransaction(pool, (transaction) =>
      importLegacyRegistry(transaction.db, new RegistryRepository(), documents),
    );
    logger.info({ report }, 'Registry particulars imported');
  } catch (error) {
    logger.error({ err: error }, 'Registry import failed');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
