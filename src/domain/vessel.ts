import type {
  CapacityUnit,
  EngineKind,
  VesselStatus,
} from '@darmawanweb/ais-its-contracts/domain';

/**
 * Principal dimensions and hull-form coefficients of a vessel (legacy
 * `ShipSize`, spec §13.3 `vessel_dimensions`). Lengths in metres, speeds in
 * knots; the coefficients are dimensionless. They feed the CII capacity and
 * the Holtrop–Mennen resistance chain of the emission service
 * (docs/METHODOLOGY.md §7.3); legacy field names in brackets.
 */
export interface VesselDimensions {
  /** CII capacity: DWT or GT according to the ship type's `capacityUnit` (t or GT). */
  readonly capacity: number;
  /** Deadweight tonnage, t (optional, informative). */
  readonly dwt: number | null;
  /** Gross tonnage (optional, informative). */
  readonly gt: number | null;
  /** Block coefficient C_B = ∇ / (L·B·T). */
  readonly cb: number;
  /** Length on the waterline L_WL, m. */
  readonly lwl: number;
  /** Moulded breadth B, m. */
  readonly b: number;
  /** Draught T, m. */
  readonly t: number;
  /** Waterplane area coefficient C_WP = A_WP / (L_WL·B). */
  readonly cwp: number;
  /** Length overall LOA, m. */
  readonly loa: number;
  /** Length between perpendiculars L_PP, m. */
  readonly lpp: number;
  /** Prismatic coefficient C_P = C_B / C_M. */
  readonly cp: number;
  /** Midship section coefficient C_M = A_M / (B·T). */
  readonly cm: number;
  /**
   * Second block coefficient of the legacy displacement Δ = L_m·B·T·C_bnsp·1.025
   * (L_m = (L_WL + L_PP)/2); contracts describe it as the block coefficient
   * at service draught — its exact thesis definition is open
   * (docs/METHODOLOGY.md §7.3.1).
   */
  readonly cbnsp: number;
  /** Bulbous bow fitted [legacy `bulbosbow`]; the legacy uses it as A_BT ∈ {0, 1} m². */
  readonly bulbousBow: boolean;
  /** Holtrop afterbody (stern shape) coefficient C_stern (−25 … +10). */
  readonly cstern: number;
  /**
   * Factors of the class rule for the minimum rudder area
   * A = c1·c2·c3·c4·1.75·L·T/100 that the legacy uses as the appendage area
   * S_APP (docs/METHODOLOGY.md §7.3.7): c1 ship-type factor (1.0 general,
   * 0.9 bulk carriers/tankers, 1.7 tugs/trawlers).
   */
  readonly c1: number;
  /** Rudder-type factor c2 (1.0 general, 0.9 semi-spade, 0.7 high-lift). */
  readonly c2: number;
  /**
   * Rudder-profile factor c3 (1.0 NACA/plate, 0.8 hollow); the legacy also
   * reuses it as the Holtrop bulb coefficient c3 in c2 = exp(−1.89·√c3)
   * (docs/METHODOLOGY.md §7.3.10).
   */
  readonly c3: number;
  /** Rudder-arrangement factor (the rule's c4: 1.0 in the propeller jet, 1.5 outside). */
  readonly c5: number;
  /** Service speed V_S, kn. */
  readonly vs: number;
}

/** A ship type with its CII reference line and rating vector. */
export interface VesselType {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly capacityUnit: CapacityUnit;
  /** Reference line CII_ref = a · Capacity^(−c). */
  readonly a: number;
  readonly c: number;
  /** Regulation-fixed capacity of the size band; `null` = the vessel's own capacity. */
  readonly capacityFixed: number | null;
  /** Rating boundaries as multiples of the required CII: exp(d_i). */
  readonly d1: number;
  readonly d2: number;
  readonly d3: number;
  readonly d4: number;
  /** Legacy web icon code (`bulkca`, `ro-rop`, …). */
  readonly icon: string | null;
  /** Provenance of the values. */
  readonly source: string | null;
  /** Ids of the methodology catalog's references behind the values. */
  readonly referenceIds: readonly string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** A fuel with its CO2 conversion factor. */
export interface Fuel {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  /** Carbon content, mass fraction (informative; Cf ≈ 44/12 · Cc). */
  readonly carbonContent: number;
  /** Cf, t CO2 per t fuel. */
  readonly conversionFactor: number;
  /** Density, t/m³ (= kg/L). */
  readonly density: number;
  readonly source: string | null;
  /** Ids of the methodology catalog's references behind the values. */
  readonly referenceIds: readonly string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** An engine of the catalogue. */
export interface Engine {
  readonly id: string;
  readonly code: string | null;
  readonly kind: EngineKind;
  readonly name: string;
  /** Rated speed, rpm. */
  readonly rpm: number;
  /** Rated power, kW. */
  readonly powerKw: number;
  /** Specific fuel oil consumption, g/kWh. */
  readonly sfoc: number;
  readonly source: string | null;
  /** Ids of the methodology catalog's references behind the values. */
  readonly referenceIds: readonly string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** A first fuel formula (safe expressions of `speedKnot`, L/min). */
export interface FuelFormula {
  readonly id: string;
  readonly code: string | null;
  readonly name: string;
  readonly mainEngineFormula: string;
  readonly auxiliaryEngineFormula: string;
  readonly source: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Role of an engine on board. */
export type EngineRole = EngineKind;

/** An engine fitted to a vessel. */
export interface VesselEngine {
  readonly role: EngineRole;
  /** Number of identical engines (≥ 1). */
  readonly quantity: number;
  readonly engine: Engine;
}

/** The `vessels` row. */
export interface VesselRecord {
  readonly id: string;
  /** Owning organization; `null` = platform-owned. */
  readonly orgId: string | null;
  readonly mmsi: number;
  readonly imo: string | null;
  readonly name: string;
  /** ISO 3166-1 alpha-2 flag state. */
  readonly flag: string | null;
  readonly builtYear: number | null;
  readonly status: VesselStatus;
  /** Share of the year at sea, percent. */
  readonly annualVoyagePercentage: number;
  readonly photoKey: string | null;
  readonly typeId: string;
  readonly fuelId: string;
  readonly firstFuelFormulaId: string | null;
  readonly legacyId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** A vessel with everything its snapshot and detail view need. */
export interface VesselAggregate {
  readonly vessel: VesselRecord;
  readonly dimensions: VesselDimensions;
  readonly type: VesselType;
  readonly fuel: Fuel;
  readonly firstFuelFormula: FuelFormula | null;
  /** Main engine first, then auxiliary engines in their stored order. */
  readonly engines: readonly VesselEngine[];
  /** Ports of call in their stored order. */
  readonly portIds: readonly string[];
}
