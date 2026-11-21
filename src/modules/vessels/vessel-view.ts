import type { VesselAggregate, VesselRecord } from '../../domain/vessel.js';

/** The identity part of a ship type (shared with every tenant). */
export interface VesselTypeSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly icon: string | null;
}

/** A port a vessel calls at, as listed on the vessel. */
export interface PortSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/** Identity fields of a vessel (spec §8.5: shared across tenants). */
export interface VesselIdentity {
  readonly vessel: VesselRecord;
  readonly type: VesselTypeSummary;
  /** Presigned GET URL of the photo (1 h), `null` without a photo. */
  readonly photoUrl: string | null;
}

/**
 * What a principal may see of a vessel: identity only (`summary`), or
 * identity and technical data for the owning organization and platform
 * administrators (`detail`).
 */
export type VesselView =
  | { readonly view: 'summary'; readonly identity: VesselIdentity }
  | {
      readonly view: 'detail';
      readonly identity: VesselIdentity;
      readonly aggregate: VesselAggregate;
      readonly ports: readonly PortSummary[];
    };
