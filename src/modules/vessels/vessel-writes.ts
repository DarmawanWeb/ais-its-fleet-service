import { ConflictError } from '@darmawanweb/ais-its-nest';
import { databaseErrorInfo, PG_SQLSTATES } from '@darmawanweb/ais-its-nest/db';

import type { FleetDb } from '../../db/database.js';
import {
  type TenantPrincipal,
  ownsVessel,
} from '../../domain/vessel-access.js';
import type { VesselRecord } from '../../domain/vessel.js';
import {
  ForeignOrganizationError,
  ImoTakenError,
  invalidField,
  MmsiTakenError,
  VesselNotFoundError,
} from '../../errors.js';
import type { VesselsRepository } from './vessels.repository.js';

/** Request fields a constraint violation of a vessel write refers to. */
export interface VesselWriteInput {
  readonly mmsi?: number | undefined;
  readonly imo?: string | null | undefined;
  readonly legacyId?: string | undefined;
}

/** Foreign keys of vessel writes and the request field each one validates. */
const FOREIGN_KEY_FIELDS: Readonly<Record<string, readonly [string, string]>> =
  {
    vessels_type_id_fkey: ['typeId', 'No vessel type with this id'],
    vessels_fuel_id_fkey: ['fuelId', 'No fuel with this id'],
    vessels_first_fuel_formula_id_fkey: [
      'firstFuelFormulaId',
      'No fuel formula with this id',
    ],
    vessel_engines_engine_id_fkey: ['engines', 'An engine no longer exists'],
    vessel_ports_port_id_fkey: ['portIds', 'A port no longer exists'],
  };

/**
 * Maps a constraint violation of a vessel write to its problem: duplicate
 * MMSI / IMO / legacy id → `409`, unknown referenced id → `400
 * VALIDATION_FAILED` on the field; anything else is rethrown.
 */
export function vesselWriteError(
  error: unknown,
  input: VesselWriteInput,
): unknown {
  const pg = databaseErrorInfo(error);
  if (pg?.code === PG_SQLSTATES.UNIQUE_VIOLATION) {
    switch (pg.constraint) {
      case 'vessels_mmsi_key':
        return new MmsiTakenError(input.mmsi ?? 0, error);
      case 'vessels_imo_key':
        return new ImoTakenError(input.imo ?? '', error);
      case 'vessels_legacy_id_key':
        return new ConflictError(
          `Legacy id ${input.legacyId ?? ''} is already imported`,
          {
            code: 'LEGACY_ID_ALREADY_EXISTS',
            extra: { legacyId: input.legacyId },
            cause: error,
          },
        );
      case undefined:
      default:
        return error;
    }
  }
  if (
    pg?.code === PG_SQLSTATES.FOREIGN_KEY_VIOLATION &&
    pg.constraint !== undefined
  ) {
    const field = FOREIGN_KEY_FIELDS[pg.constraint];
    if (field !== undefined)
      return invalidField(field[0], field[1], 'notFound');
  }
  return error;
}

/** Runs a vessel write and maps its constraint violations ({@link vesselWriteError}). */
export async function mappingVesselErrors<T>(
  input: VesselWriteInput,
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    throw vesselWriteError(error, input);
  }
}

/**
 * Locks a vessel the principal may change (`FOR UPDATE`): `404` when it does
 * not exist, `403` when it belongs to another organization (identity is
 * shared, so revealing its existence leaks nothing).
 */
export async function lockOwnedVessel(
  repository: VesselsRepository,
  db: FleetDb,
  id: string,
  principal: TenantPrincipal,
): Promise<VesselRecord> {
  const vessel = await repository.lock(db, id);
  if (vessel === undefined) throw new VesselNotFoundError({ id });
  if (!ownsVessel(principal, vessel)) throw new ForeignOrganizationError();
  return vessel;
}
