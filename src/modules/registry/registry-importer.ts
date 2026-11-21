import type { FleetDb } from '../../db/database.js';
import {
  type LegacySecondaryShip,
  mapLegacySecondaryShip,
  type RegistryParticulars,
} from '../../domain/registry.js';
import type { RegistryRepository } from './registry.repository.js';

/** Rows upserted per statement. */
const IMPORT_BATCH_SIZE = 500;

/** Outcome of an import. */
export interface RegistryImportReport {
  readonly read: number;
  readonly inserted: number;
  readonly updated: number;
  /** Documents refused, with the reason (first 20). */
  readonly rejected: number;
  readonly rejections: readonly {
    readonly index: number;
    readonly reason: string;
  }[];
}

/**
 * Imports legacy `SecondaryShip` documents (a mongoexport of the MVP
 * collection) into `registry_particulars`: upsert by MMSI, the last
 * document of a duplicated MMSI wins, invalid documents are skipped and
 * reported. Idempotent.
 */
export async function importLegacyRegistry(
  db: FleetDb,
  repository: RegistryRepository,
  documents: readonly LegacySecondaryShip[],
): Promise<RegistryImportReport> {
  const byMmsi = new Map<number, RegistryParticulars>();
  const rejections: { index: number; reason: string }[] = [];
  documents.forEach((document, index) => {
    const mapped = mapLegacySecondaryShip(document);
    if (mapped.ok) byMmsi.set(mapped.particulars.mmsi, mapped.particulars);
    else rejections.push({ index, reason: mapped.reason });
  });
  const entries = [...byMmsi.values()];
  let inserted = 0;
  let updated = 0;
  for (let start = 0; start < entries.length; start += IMPORT_BATCH_SIZE) {
    const result = await repository.upsertMany(
      db,
      entries.slice(start, start + IMPORT_BATCH_SIZE),
    );
    inserted += result.inserted;
    updated += result.updated;
  }
  return {
    read: documents.length,
    inserted,
    updated,
    rejected: rejections.length,
    rejections: rejections.slice(0, 20),
  };
}
