import type { Paginated } from '@darmawanweb/ais-its-contracts/api';
import { InjectDb } from '@darmawanweb/ais-its-nest/db';
import { pageOffsetOf, paginate } from '@darmawanweb/ais-its-nest/http';
import { Injectable } from '@nestjs/common';

import type { FleetDb } from '../../db/database.js';
import { parseRegistryKey, planRegistrySearch } from '../../domain/registry.js';
import { invalidField, RegistryEntryNotFoundError } from '../../errors.js';
import {
  type RegistryEntry,
  RegistryRepository,
} from './registry.repository.js';

/**
 * Registry particulars of ships (legacy `SecondaryShip`): public reference
 * data shared with every principal holding `vessel:read` (no tenant data),
 * searched without trigram indexes.
 */
@Injectable()
export class RegistryService {
  constructor(
    @InjectDb() private readonly db: FleetDb,
    private readonly repository: RegistryRepository,
  ) {}

  async search(query: {
    readonly q: string;
    readonly page: number;
    readonly pageSize: number;
  }): Promise<Paginated<RegistryEntry>> {
    const { rows, total } = await this.repository.search(
      this.db,
      planRegistrySearch(query.q),
      { offset: pageOffsetOf(query), limit: query.pageSize },
    );
    return paginate(rows, query, total);
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
