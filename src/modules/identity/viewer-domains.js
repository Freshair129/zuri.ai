import { DOMAINS } from '@/config/domains'

// @req FR-061 — domain visibility is resolved per Business, because the grant
// it represents (`Membership.domainKeysJson`) is per Business.
// @spec SDD-034, SDD-017, SEC-008 — every resolver branch fills the map; there
// is no "sees everything" flag for a consumer to read instead.
// @tested tests/unit/fr061-per-business-domain-visibility.test.js
//
// This module holds no I/O on purpose. `resolve-viewer.js` imports `@/lib/db`,
// and both consumers of the per-Business answer — `business-shell-guard.js` and
// `DomainBar.jsx` — run in the client bundle. Splitting the pure rule out keeps
// Prisma off that path.

export const VIEWER_DOMAINS = DOMAINS.map((domain) => domain.key)

/** A persisted allow-list, or nothing at all if it cannot be trusted. */
export function parseDomainKeys(json) {
  try {
    const keys = JSON.parse(json || '[]')
    return Array.isArray(keys) ? keys.filter((key) => typeof key === 'string') : []
  } catch {
    return []
  }
}

/**
 * The per-Business domain map, derived from the same Membership rows and the
 * same tenant-wide expansion that already produce `visibleBusinessIds`.
 *
 * OWNER-ness is applied **per Membership**: an OWNER Membership grants every
 * domain on the Businesses that Membership covers, and nowhere else. That is
 * the whole fix — the previous rule asked whether the principal owned anything
 * anywhere, which is a different question from the one every consumer was
 * asking (.brain/rca/2026-08-16-global-role-is-not-per-business-authority.md).
 *
 * @param {{memberships?: object[], tenantBusinesses?: {id:string,tenantId:string}[]}} input
 * @returns {Record<string, string[]>}
 */
export function buildDomainsByBusiness({ memberships = [], tenantBusinesses = [] } = {}) {
  const map = {}
  const grant = (businessId, keys) => {
    if (!businessId) return
    const merged = new Set([...(map[businessId] || []), ...keys])
    // Filtered through VIEWER_DOMAINS, so an unknown persisted key grants
    // nothing and the order is the registry's rather than the row's.
    map[businessId] = VIEWER_DOMAINS.filter((key) => merged.has(key))
  }

  for (const membership of memberships) {
    const keys = membership.role === 'OWNER' ? VIEWER_DOMAINS : parseDomainKeys(membership.domainKeysJson)
    if (membership.businessId) {
      grant(membership.businessId, keys)
      continue
    }
    for (const business of tenantBusinesses) {
      if (business.tenantId === membership.tenantId) grant(business.id, keys)
    }
  }
  return map
}

/**
 * Every domain on every listed Business — the platform DEV and
 * local-development branches, which are unrestricted by design.
 *
 * They fill the same map rather than carrying a flag, because a shortcut is
 * exactly what got read in place of the scoped question three times already.
 * Each Business gets its own array: sharing one would be an invisible coupling.
 */
export function allDomainsFor(businessIds = []) {
  return Object.fromEntries(businessIds.filter(Boolean).map((id) => [id, [...VIEWER_DOMAINS]]))
}

/**
 * The only sanctioned way to ask "which domains may this viewer see in THIS
 * Business". Fails closed: an unknown Business grants nothing.
 *
 * The one exception is a viewer carrying no map at all. That is a hand-built
 * fixture predating FR-061 — no `resolveViewer` branch can produce it — and it
 * falls back to the flat field, preserving the old-fixture tolerance
 * `isDomainVisible` already documents. `undefined` (rather than `[]`) for a
 * viewer with neither field keeps that tolerance meaning "unrestricted", which
 * is what the guard did before.
 *
 * @returns {string[]|undefined}
 */
export function domainsForBusiness(viewer, businessId) {
  if (!viewer || typeof viewer !== 'object') return []

  const map = viewer.domainsByBusinessId
  // Absent is the legacy seam. Present-but-malformed is corrupt input, and gets
  // no tolerance at all — the distinction matters, because collapsing the two
  // would turn any damaged map into an unrestricted viewer.
  if (map === undefined || map === null) {
    return Array.isArray(viewer.visibleDomains) ? viewer.visibleDomains : undefined
  }
  if (typeof map !== 'object' || Array.isArray(map)) return []

  if (!businessId || typeof businessId !== 'string') return []
  const granted = map[businessId]
  return Array.isArray(granted) ? granted : []
}
