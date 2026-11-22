import type { Paginated } from '@darmawanweb/ais-its-contracts/api';
import { InjectDb } from '@darmawanweb/ais-its-nest/db';
import { pageOffsetOf, paginate } from '@darmawanweb/ais-its-nest/http';
import { Injectable } from '@nestjs/common';

import type { FleetDb } from '../../db/database.js';
import {
  parseRegistryKey,
  planRegistrySearch,
  type RegistryMatchMode,
  substringArmNeeded,
} from '../../domain/registry.js';
import { invalidField, RegistryEntryNotFoundError } from '../../errors.js';
import {
  type RegistryEntry,
  RegistryRepository,
} from './registry.repository.js';

/**
 * Registry particulars of ships (legacy `SecondaryShip`): public reference
 * data shared with every principal holding `vessel:read` (no tenant data),
 * searched over btree indexes without trigrams.
 */
@Injectable()
export class RegistryService {
  constructor(
    @InjectDb() private readonly db: FleetDb,
    private readonly repository: RegistryRepository,
  ) {}

  /**
   * Searches by name, IMO number or MMSI over indexes; the scanning
   * substring arm runs only as {@link substringArmNeeded} decides.
   */
  async search(query: {
    readonly q: string;
    readonly match?: RegistryMatchMode | undefined;
    readonly page: number;
    readonly pageSize: number;
  }): Promise<Paginated<RegistryEntry>> {
    const plan = planRegistrySearch(query.q, query.match);
    const page = { offset: pageOffsetOf(query), limit: query.pageSize };
    let result = await this.repository.search(
      this.db,
      plan,
      { substring: plan.substring === 'always' },
      page,
    );
    if (
      plan.substring === 'when_sparse' &&
      substringArmNeeded(plan, result.total, query.pageSize)
    ) {
      result = await this.repository.search(
        this.db,
        plan,
        { substring: true },
        page,
      );
    }
    return paginate(result.rows, query, result.total);
  }

  /** By MMSI (9 digits) or IMO number (7 digits, optionally `IMO…`). */
  async get(imoOrMmsi: string): Promise<RegistryEntry> {
    const key = parseRegistryKey(imoOrMmsi);
    if (key === undefined) {
      throw invalidField(
        'imoOrMmsi',
        'Expected an MMSI (9 digits) or an IMO number (7 digits)',
        'isImoOrMmsi',
      );
    }
    const entry = await this.repository.findByKey(this.db, key);
    if (entry === undefined) throw new RegistryEntryNotFoundError(imoOrMmsi);
    return entry;
  }
}
