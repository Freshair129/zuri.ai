import { DOMAINS, isDomainVisible } from '@/config/domains'

// @req FR-061 — domain visibility is resolved per Business, because the grant
// it represents (`Membership.domainKeysJson`) is per Business.
// @spec SDD-034, SDD-017, SEC-008 — every resolver branch fills the map; there
// is no "sees everything" flag for a consumer to read instead.
// @tested tests/unit/fr061-per-business-domain-visibility.test.js,
//   tests/unit/domain-visibility-server-enforcement.test.js,
//   tests/integration/domain-visibility-server.test.js
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

/**
 * The server-side half of FR-061: refuse a request for a domain this viewer was
 * not granted in THIS Business.
 *
 * @req FR-061 — until now `domainsForBusiness` had exactly two consumers, and
 * both of them ran in the browser: `business-shell-guard.js` (the route guard)
 * and `DomainBar.jsx`. A grant that only a client reads is a rendering rule, not
 * an authorization rule — a MEMBER whose `Membership.domainKeysJson` excludes
 * `customer` was still answered by `GET /api/crm/conversations` if they typed
 * the URL. This predicate is the same decision, taken where it cannot be
 * skipped (D2-domain-identity-23).
 *
 * It **re-derives nothing**. `isDomainVisible` supplies the `alwaysVisible`
 * exemption (Business Home) and the old-fixture tolerance; `domainsForBusiness`
 * supplies the per-Business grant, including the OWNER/DEV branches that fill
 * every key of the map rather than raising a "sees everything" flag (SDD-034).
 * A second reading of those rules here is how the guard and the bar would drift
 * apart, which is the shape of the incident FR-061 itself closed.
 *
 * **The refusal is 404-shaped and says `Business not found`** — byte-identical
 * to what each of these readers already throws for a Business that does not
 * exist. FR-072(a): a caller must not be able to tell "this Business is real and
 * you lack the domain" from "no such Business", because the first answer is an
 * enumeration oracle over other tenants' ids. The message is the one those
 * services already use, not a new string, so `handle()` maps both to the same
 * body via the same path.
 *
 * **Where this is applied, and why not everywhere.** Three API families call it
 * today, one domain key each: `src/app/api/crm/**` → `customer`,
 * `src/app/api/market/**` → `market`, `src/app/api/people/**` → `people`.
 * `tests/unit/domain-visibility-server-enforcement.test.js` is a ratchet over
 * exactly those trees, so a new route under them cannot land unguarded.
 *
 *   - **Project-manager routes are deliberately out.** `/api/projects`,
 *     `/api/work`, `/api/milestones` and their neighbours answer the Development
 *     domain (`projects`) *and* feed Business Home, which is `alwaysVisible`
 *     precisely so a MEMBER granted only one domain still has a page to land on
 *     (`config/domains.js`, FR-060). Gating those endpoints on `projects` would
 *     blank the surface the `alwaysVisible` slot exists to guarantee, so the
 *     mapping there is a product question rather than a mechanical one and is
 *     left open rather than guessed at.
 *   - **Platform routes are already gated** on owner/operator authority
 *     (`ownsBusiness` / `isInstallationOperator`), which is strictly stronger
 *     than domain visibility; adding this predicate there would change no
 *     answer.
 *
 * @param {object} viewer
 * @param {string} businessId
 * @param {string} domainKey  a key from `config/domains.js`
 * @throws {Error & {status: 404}} when the domain is not granted in this Business
 */
export function assertDomainVisible(viewer, businessId, domainKey) {
  if (isDomainVisible(domainKey, domainsForBusiness(viewer, businessId))) return
  const error = new Error('Business not found')
  error.status = 404
  throw error
}
