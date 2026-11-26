import type { TenantPrincipal } from './vessel-access.js';

/** Sort keys of `GET /vessels`. */
export const VESSEL_SORT_KEYS = [
  'name',
  'mmsi',
  'imo',
  'gt',
  'dwt',
  'builtYear',
  'updatedAt',
] as const;

/** A sort key of `GET /vessels`. */
export type VesselSortKey = (typeof VESSEL_SORT_KEYS)[number];

/** Directions of a sort. */
export const SORT_ORDERS = ['asc', 'desc'] as const;

/** A direction of a sort. */
export type SortOrder = (typeof SORT_ORDERS)[number];

/**
 * Sort keys that are technical data: the shared identity of a vessel is id,
 * MMSI, IMO, name, flag, type, status and photo (spec §8.5, `updatedAt` is
 * part of the summary view), while tonnages and the build year belong to the
 * owner's detail view. Sorting by them must not reveal how foreign vessels
 * compare, so only the values the principal may see order the list.
 */
export const TECHNICAL_SORT_KEYS: ReadonlySet<VesselSortKey> = new Set([
  'gt',
  'dwt',
  'builtYear',
]);

/** Whose technical values a technical sort key may use. */
export type TechnicalSortScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'organization'; readonly orgId: string }
  | { readonly kind: 'none' };

/**
 * The vessels whose technical values order a list for `principal`: those of
 * its detail view (`ownsVessel`), i.e. every vessel for platform
 * administrators, the active organization's for everybody else. The other
 * vessels sort after them, by name, as if the value were unknown.
 */
export function technicalSortScope(
  principal: TenantPrincipal,
): TechnicalSortScope {
  if (principal.isPlatformAdmin) return { kind: 'all' };
  return principal.orgId === null
    ? { kind: 'none' }
    : { kind: 'organization', orgId: principal.orgId };
}

/** Most MMSIs one `GET /vessels?mmsi=` lookup accepts (= the largest `pageSize`). */
export const MAX_MMSI_LOOKUP = 100;
