import type { Principal } from '@darmawanweb/ais-its-nest/auth';
import { InjectDb } from '@darmawanweb/ais-its-nest/db';
import { Injectable } from '@nestjs/common';

import type { FleetDb } from '../../db/database.js';
import {
  type ReferenceKind,
  VesselAggregatesRepository,
} from './vessel-aggregates.repository.js';

/** OpenAPI description of `vesselCount` on the reference rows. */
export const VESSEL_COUNT_DESCRIPTION =
  'Vessels of every organization that use this row; a row in use cannot be deleted (409 REFERENCE_IN_USE). ' +
  'Present only for principals with reference:write (platform administrators): the count spans the technical data of every tenant (spec §8.5).';

/** Vessel counts of the rows of one response, by row id. */
export interface ReferenceCounts {
  /** The count of a row of the response (`0` when no vessel uses it). */
  of(id: string): number;
}

/**
 * Usage counts of reference rows (`vesselCount` of vessel types, fuels,
 * engines, fuel formulas and ports). They are shown to the principals who
 * may delete reference rows (`reference:write`, i.e. platform
 * administrators), because a count spans the vessels of every organization
 * and fuels, engines, formulas and ports are tenant-private technical data
 * (spec §8.5); everybody else gets rows without the field.
 */
@Injectable()
export class ReferenceUsage {
  constructor(
    @InjectDb() private readonly db: FleetDb,
    private readonly aggregates: VesselAggregatesRepository,
  ) {}

  /** `true` when the principal sees usage counts. */
  static visibleTo(principal: Principal): boolean {
    return principal.can('reference:write');
  }

  /**
   * The vessel counts of the rows `ids` of `kind` when the principal may see
   * them, else `undefined` (one grouped query).
   */
  async countsFor(
    principal: Principal,
    kind: ReferenceKind,
    ids: readonly string[],
  ): Promise<ReferenceCounts | undefined> {
    if (!ReferenceUsage.visibleTo(principal)) return undefined;
    const counts = await this.aggregates.countVesselsUsingEach(
      this.db,
      kind,
      ids,
    );
    return { of: (id) => counts.get(id) ?? 0 };
  }
}
