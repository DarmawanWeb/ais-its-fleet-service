import type { BBox } from '@darmawanweb/ais-its-contracts/domain';
import {
  geographyIntersectsBBox,
  pointGeography,
} from '@darmawanweb/ais-its-nest/db';
import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, ilike, or, type SQL, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';

import type { FleetDb } from '../../db/database.js';
import { ports, vesselPorts } from '../../db/schema.js';
import { escapeLikePattern } from '../common/validation.js';
import type { NewPort, Port, PortChanges } from './port.js';

/** Name of the unique constraint on `code`. */
export const PORT_CODE_CONSTRAINT = 'ports_code_key';

/** The columns of a {@link Port}: the point as longitude/latitude. */
const PORT_COLUMNS = {
  id: ports.id,
  name: ports.name,
  code: ports.code,
  administrativeLocation: ports.administrativeLocation,
  lon: sql<number>`ST_X(${ports.geom}::geometry)`,
  lat: sql<number>`ST_Y(${ports.geom}::geometry)`,
  radiusM: ports.radiusM,
  source: ports.source,
  createdAt: ports.createdAt,
  updatedAt: ports.updatedAt,
};

/** Column values of `changes` (the position becomes a geography point). */
function columnsOf(changes: PortChanges): PgUpdateSetSource<typeof ports> {
  const { lon, lat, ...rest } = changes;
  return {
    ...rest,
    ...(lon === undefined || lat === undefined
      ? {}
      : { geom: pointGeography(lon, lat) }),
  };
}

/** Drizzle access to `ports` (PostGIS `geography(Point,4326)`). */
@Injectable()
export class PortsRepository {
  async list(
    db: FleetDb,
    filter: {
      readonly search?: string | undefined;
      readonly bbox?: BBox | undefined;
    },
    page: { readonly offset: number; readonly limit: number },
  ): Promise<{ rows: Port[]; total: number }> {
    const conditions: (SQL | undefined)[] = [
      filter.search === undefined
        ? undefined
        : or(
            ilike(ports.name, `%${escapeLikePattern(filter.search)}%`),
            ilike(ports.code, `%${escapeLikePattern(filter.search)}%`),
          ),
      filter.bbox === undefined
        ? undefined
        : geographyIntersectsBBox(ports.geom, filter.bbox),
    ];
    const where = and(...conditions);
    const [rows, totals] = await Promise.all([
      db
        .select(PORT_COLUMNS)
        .from(ports)
        .where(where)
        .orderBy(asc(ports.name), asc(ports.id))
        .limit(page.limit)
        .offset(page.offset),
      db.select({ total: count() }).from(ports).where(where),
    ]);
    return { rows, total: totals[0]?.total ?? 0 };
  }

  async findById(db: FleetDb, id: string): Promise<Port | undefined> {
    const [row] = await db
      .select(PORT_COLUMNS)
      .from(ports)
      .where(eq(ports.id, id))
      .limit(1);
    return row;
  }

  async insert(db: FleetDb, port: NewPort): Promise<Port> {
    const { lon, lat, ...rest } = port;
    const [row] = await db
      .insert(ports)
      .values({ ...rest, geom: pointGeography(lon, lat) })
      .returning(PORT_COLUMNS);
    if (row === undefined)
      throw new Error('INSERT … RETURNING returned no row');
    return row;
  }

  /** Applies `changes` and advances `updated_at`; `undefined` when absent. */
  async update(
    db: FleetDb,
    id: string,
    changes: PortChanges,
  ): Promise<Port | undefined> {
    const [row] = await db
      .update(ports)
      .set({ ...columnsOf(changes), updatedAt: sql`clock_timestamp()` })
      .where(eq(ports.id, id))
      .returning(PORT_COLUMNS);
    return row;
  }

  async delete(db: FleetDb, id: string): Promise<Port | undefined> {
    const [row] = await db
      .delete(ports)
      .where(eq(ports.id, id))
      .returning(PORT_COLUMNS);
    return row;
  }

  /** Number of vessels calling at the port. */
  async countVessels(db: FleetDb, id: string): Promise<number> {
    const [row] = await db
      .select({ total: count() })
      .from(vesselPorts)
      .where(eq(vesselPorts.portId, id));
    return row?.total ?? 0;
  }
}
