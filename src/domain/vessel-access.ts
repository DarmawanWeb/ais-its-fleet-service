/**
 * Tenancy rules of vessel data (docs/PLATFORM_SPEC.md §8.5): the identity of
 * a vessel (id, MMSI, IMO, name, flag, type, status, photo) is shared with
 * every principal holding `vessel:read`; its technical data (dimensions,
 * engines, fuel, formula, ports, voyage share) is private to the owning
 * organization, except for platform administrators.
 */

/** The part of a principal the rules look at (the kit's `Principal` fits). */
export interface TenantPrincipal {
  /** Active organization; `null` for platform admins without one. */
  readonly orgId: string | null;
  /** Holds the platform role `super_admin`. */
  readonly isPlatformAdmin: boolean;
}

/** Which representation of a vessel a principal receives. */
export type VesselView = 'detail' | 'summary';

/** `true` when the principal owns the vessel's technical data or administers the platform. */
export function ownsVessel(
  principal: TenantPrincipal,
  vessel: { readonly orgId: string | null },
): boolean {
  if (principal.isPlatformAdmin) return true;
  return vessel.orgId !== null && vessel.orgId === principal.orgId;
}

/**
 * The view of a vessel for a principal: `detail` (identity + technical data,
 * `VesselDetailDto`) for its own organization and platform admins,
 * `summary` (identity only, `VesselSummaryDto`) for everybody else.
 */
export function vesselViewFor(
  principal: TenantPrincipal,
  vessel: { readonly orgId: string | null },
): VesselView {
  return ownsVessel(principal, vessel) ? 'detail' : 'summary';
}

/** Why a principal may not create a vessel for an organization. */
export type OwnerRefusal = 'organization_required' | 'foreign_organization';

/** Outcome of {@link ownerOfNewVessel}. */
export type OwnerDecision =
  | { readonly allowed: true; readonly orgId: string | null }
  | { readonly allowed: false; readonly reason: OwnerRefusal };

/**
 * The owning organization of a new vessel. Organization members create
 * vessels in their active organization only (an `orgId` in the request must
 * be that one); platform admins may name any organization, or none for a
 * platform-owned vessel when they have no active organization.
 */
export function ownerOfNewVessel(
  principal: TenantPrincipal,
  requestedOrgId: string | undefined,
): OwnerDecision {
  if (principal.isPlatformAdmin) {
    return { allowed: true, orgId: requestedOrgId ?? principal.orgId };
  }
  if (principal.orgId === null) {
    return { allowed: false, reason: 'organization_required' };
  }
  if (requestedOrgId !== undefined && requestedOrgId !== principal.orgId) {
    return { allowed: false, reason: 'foreign_organization' };
  }
  return { allowed: true, orgId: principal.orgId };
}
