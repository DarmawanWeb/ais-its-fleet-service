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

/**
 * How `GET /registry/search` matches names: `prefix` uses only the indexed
 * arms; `contains` adds the substring arm (a sequential scan); `auto` (the
 * default) adds it only when the indexed arms do not fill one page.
 */
export const REGISTRY_MATCH_MODES = ['auto', 'prefix', 'contains'] as const;

/** A name-matching mode of {@link REGISTRY_MATCH_MODES}. */
export type RegistryMatchMode = (typeof REGISTRY_MATCH_MODES)[number];

/** When a search runs its substring arm (see {@link substringArmNeeded}). */
export type RegistrySubstringPolicy = 'never' | 'always' | 'when_sparse';

/**
 * The arms of a registry search. Every arm except the substring arm is an
 * index range scan; each runs as its own `UNION ALL` branch so PostgreSQL
 * can use its index (an `OR` with an unindexable predicate scans the table).
 */
export interface RegistrySearchPlan {
  /**
   * Case-folded query: names starting with it match through
   * `lower(name) text_pattern_ops` (rank 1), names equal to it rank 0.
   */
  readonly text: string;
  /** The digits of a numeric query (1–9 digits, optionally `IMO…`). */
  readonly digits: string | undefined;
  /** IMO prefix of a numeric query of at most 7 digits (`imo text_pattern_ops`). */
  readonly imoPrefix: string | undefined;
  /** Every MMSI starting with the digits (unique btree index on `mmsi`). */
  readonly mmsiRange: readonly [number, number] | undefined;
  /** The substring arm `name ILIKE '%text%'` (rank 2): never for numeric or short queries. */
  readonly substring: RegistrySubstringPolicy;
}

/** Shortest query matched as a substring of names; shorter ones only match prefixes. */
export const REGISTRY_CONTAINS_MIN_LENGTH = 3;

/**
 * Plans a registry search for a free-text query without trigram indexes
 * (services may not create extensions, spec §6). Names match by prefix
 * through a `text_pattern_ops` index; a query of 1–9 digits (optionally
 * `IMO…`) is an identity lookup that also matches IMO numbers and MMSIs
 * starting with it, through their btree indexes. Only a text query of at
 * least {@link REGISTRY_CONTAINS_MIN_LENGTH} characters may add the
 * substring arm, which scans the table: always with `match=contains`, only
 * when the indexed arms leave the first page short with `match=auto`.
 */
export function planRegistrySearch(
  query: string,
  match: RegistryMatchMode = 'auto',
): RegistrySearchPlan {
  const text = query.trim().toLowerCase();
  const digits = /^(?:imo\s*)?(\d{1,9})$/.exec(text)?.[1];
  let mmsiRange: readonly [number, number] | undefined;
  if (digits !== undefined) {
    const scale = 10 ** (9 - digits.length);
    const low = Number(digits) * scale;
    // MMSIs have exactly 9 digits: a prefix starting with 0 matches none.
    mmsiRange = digits.startsWith('0') ? undefined : [low, low + scale - 1];
  }
  const substringAllowed =
    digits === undefined && text.length >= REGISTRY_CONTAINS_MIN_LENGTH;
  return {
    text,
    digits,
    imoPrefix: digits !== undefined && digits.length <= 7 ? digits : undefined,
    mmsiRange,
    substring: !substringAllowed
      ? 'never'
      : match === 'contains'
        ? 'always'
        : match === 'auto'
          ? 'when_sparse'
          : 'never',
  };
}

/**
 * Whether a search adds the substring arm, given how many entries its
 * indexed arms matched. With `when_sparse` that is the case when they do not
 * fill one page: the decision depends on the query and the page size only,
 * never on the page number, so every page of a search reports the same
 * `total`.
 */
export function substringArmNeeded(
  plan: RegistrySearchPlan,
  indexedTotal: number,
  pageSize: number,
): boolean {
  switch (plan.substring) {
    case 'always':
      return true;
    case 'when_sparse':
      return indexedTotal < pageSize;
    case 'never':
      return false;
  }
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
