import { isValidMmsi } from '@darmawanweb/ais-its-contracts/domain';

/** Registry particulars of a ship (legacy `SecondaryShip`, spec §13.3). */
export interface RegistryParticulars {
  readonly imo: string | null;
  readonly mmsi: number;
  readonly name: string;
  /** Year built. */
  readonly built: number | null;
  /** Flag code as delivered by the source (ISO alpha-2 or alpha-3). */
  readonly flag: string | null;
  readonly flagName: string | null;
  readonly type: string | null;
  readonly typeName: string | null;
  /** Gross tonnage. */
  readonly gt: number | null;
  /** Deadweight, t. */
  readonly dwt: number | null;
  /** Length overall, m. */
  readonly loa: number | null;
  /** Breadth, m. */
  readonly beam: number | null;
  /** Draught, m. */
  readonly draught: number | null;
  /** Classification society. */
  readonly class: string | null;
  readonly classCode: string | null;
  /** The source document as imported. */
  readonly raw: Readonly<Record<string, unknown>>;
}

/** How `GET /registry/:imoOrMmsi` reads its key. */
export type RegistryKey =
  | { readonly kind: 'mmsi'; readonly mmsi: number }
  | { readonly kind: 'imo'; readonly imo: string };

/**
 * Reads a registry key: 9 digits are an MMSI, 7 digits (optionally prefixed
 * with `IMO`, as legacy data often writes it) an IMO number.
 *
 * @returns the key, or `undefined` when the value is neither
 */
export function parseRegistryKey(value: string): RegistryKey | undefined {
  const trimmed = value.trim();
  if (/^\d{9}$/.test(trimmed)) {
    const mmsi = Number(trimmed);
    return isValidMmsi(mmsi) ? { kind: 'mmsi', mmsi } : undefined;
  }
  const imo = /^(?:IMO\s*)?(\d{7})$/i.exec(trimmed);
  return imo?.[1] === undefined ? undefined : { kind: 'imo', imo: imo[1] };
}

/** The index-friendly predicates of a registry search. */
export interface RegistrySearchPlan {
  /** Case-folded name prefix (`lower(name) LIKE '<prefix>%'`, btree-indexed). */
  readonly namePrefix: string;
  /** Case-insensitive substring of the name (only for 3+ characters; scans). */
  readonly nameContains: string | undefined;
  /** IMO prefix of a digit query (`imo LIKE '<digits>%'`, indexed). */
  readonly imoPrefix: string | undefined;
  /** MMSI range of a digit query: every MMSI starting with the digits (indexed). */
  readonly mmsiRange: readonly [number, number] | undefined;
}

/** Shortest query matched as a substring of names; shorter ones only match prefixes. */
export const REGISTRY_CONTAINS_MIN_LENGTH = 3;

/**
 * Plans a registry search for a free-text query without trigram indexes
 * (services may not create extensions, spec §6): names match by prefix
 * through a `text_pattern_ops` index and by substring for 3+ characters;
 * a query of 1–9 digits (optionally `IMO…`) also matches IMO numbers and
 * MMSIs that start with it, through their btree indexes.
 */
export function planRegistrySearch(query: string): RegistrySearchPlan {
  const text = query.trim().toLowerCase();
  const digits = /^(?:imo\s*)?(\d{1,9})$/.exec(text)?.[1];
  let mmsiRange: readonly [number, number] | undefined;
  if (digits !== undefined) {
    const scale = 10 ** (9 - digits.length);
    const low = Number(digits) * scale;
    // MMSIs have exactly 9 digits: a prefix starting with 0 matches none.
    mmsiRange = digits.startsWith('0') ? undefined : [low, low + scale - 1];
  }
  return {
    namePrefix: text,
    nameContains:
      text.length >= REGISTRY_CONTAINS_MIN_LENGTH ? text : undefined,
    imoPrefix: digits !== undefined && digits.length <= 7 ? digits : undefined,
    mmsiRange,
  };
}

/** A legacy `SecondaryShip` document (every field a string, as stored by the MVP). */
export type LegacySecondaryShip = Readonly<Record<string, unknown>>;

/** Outcome of {@link mapLegacySecondaryShip}. */
export type LegacyRegistryMapping =
  | { readonly ok: true; readonly particulars: RegistryParticulars }
  | { readonly ok: false; readonly reason: string };

function text(document: LegacySecondaryShip, field: string): string | null {
  const value = document[field];
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** A non-negative number from a legacy string such as `"2877"` or `"73.3"`. */
function measure(document: LegacySecondaryShip, field: string): number | null {
  const value = text(document, field);
  if (value === null) return null;
  const number = Number(value.replace(',', '.'));
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function year(document: LegacySecondaryShip, field: string): number | null {
  const value = text(document, field);
  const match = value === null ? null : /^(\d{4})/.exec(value);
  if (match?.[1] === undefined) return null;
  const built = Number(match[1]);
  return built >= 1800 && built <= 2200 ? built : null;
}

/**
 * Maps a legacy `SecondaryShip` document (upper-case string fields `IMO`,
 * `MMSI`, `NAME`, `BUILT`, `FLAG`, `FLAGNAME`, `TYPE`, `TYPENAME`, `GT`,
 * `DWT`, `LOA`, `BEAM`, `DRAUGHT`, `CLASS`, `CLASSCODE`) to registry
 * particulars. Numbers are parsed leniently (blank or unparsable → `null`);
 * a document without a 9-digit MMSI or a name is refused. The document is
 * kept as `raw`.
 */
export function mapLegacySecondaryShip(
  document: LegacySecondaryShip,
): LegacyRegistryMapping {
  const mmsiText = text(document, 'MMSI');
  const mmsi = mmsiText === null ? Number.NaN : Number(mmsiText);
  if (!isValidMmsi(mmsi)) {
    return { ok: false, reason: `invalid MMSI ${JSON.stringify(mmsiText)}` };
  }
  const name = text(document, 'NAME');
  if (name === null) return { ok: false, reason: 'missing NAME' };
  return {
    ok: true,
    particulars: {
      imo: text(document, 'IMO')?.replace(/^IMO\s*/i, '') ?? null,
      mmsi,
      name: name.slice(0, 200),
      built: year(document, 'BUILT'),
      flag: text(document, 'FLAG')?.slice(0, 8) ?? null,
      flagName: text(document, 'FLAGNAME')?.slice(0, 120) ?? null,
      type: text(document, 'TYPE')?.slice(0, 120) ?? null,
      typeName: text(document, 'TYPENAME')?.slice(0, 120) ?? null,
      gt: measure(document, 'GT'),
      dwt: measure(document, 'DWT'),
      loa: measure(document, 'LOA'),
      beam: measure(document, 'BEAM'),
      draught: measure(document, 'DRAUGHT'),
      class: text(document, 'CLASS')?.slice(0, 120) ?? null,
      classCode: text(document, 'CLASSCODE')?.slice(0, 64) ?? null,
      raw: { ...document },
    },
  };
}
