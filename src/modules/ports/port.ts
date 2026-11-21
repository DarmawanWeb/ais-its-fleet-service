/** A port of call (legacy `Port`), positioned in WGS 84. */
export interface Port {
  readonly id: string;
  readonly name: string;
  /** Unique code, e.g. `PBI`. */
  readonly code: string;
  /** Administrative area code (Indonesian kode wilayah). */
  readonly administrativeLocation: string | null;
  /** Longitude, degrees. */
  readonly lon: number;
  /** Latitude, degrees. */
  readonly lat: number;
  /** Radius of the port area, m (`null` = unknown). */
  readonly radiusM: number | null;
  readonly source: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Columns of a new port. */
export type NewPort = Omit<Port, 'createdAt' | 'updatedAt'>;

/** Changeable columns of a port (`lon`/`lat` change together). */
export type PortChanges = Partial<Omit<NewPort, 'id'>>;
