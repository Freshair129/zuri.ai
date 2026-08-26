// @req FR-059, FR-038, FR-036 — one implementation of "may this viewer act on
// this Business", used by every site that asks.
// @spec SEC-001, SEC-008
// @tested tests/unit/viewer-authority.test.js
//
// The predicate lived in two places already — `assertBusinessOwned` in the
// FR-059 strategy service and `assertMembershipBusinessOwned` in the FR-038
// permission service — with identical logic and different HTTP statuses. A third
// copy was about to be written for FR-036 project teams.
//
// Duplicating an authorization predicate is precisely the disease this
// repository has now diagnosed eight times: a rule applied by hand at each site,
// correct at the sites someone remembered. So the part that can be *wrong* — the
// decision — lives here once. The part that is legitimately per-site — the
// status code and message a caller has already promised its consumers — stays
// at the call site.
//
// No I/O and no imports on purpose: this is called from services and could be
// called from a client guard.

/** Every branch fails closed. A viewer missing the field is not authorized. */
function grantList(viewer, field) {
  const list = viewer?.[field]
  return Array.isArray(list) ? list : null
}

/**
 * May this viewer WRITE within this Business?
 *
 * `ownedBusinessIds` is the per-Business OWNER grant. `role === 'OWNER'` is a
 * per-principal label — true for anyone who owns any Business anywhere — and is
 * never an answer to this question. Neither is `visibleBusinessIds`: a plain
 * MEMBER membership puts a Business there, which is why "role is OWNER AND the
 * Business is visible" does not compose into an authorization check.
 * (.brain/rca/2026-08-16-global-role-is-not-per-business-authority.md)
 */
export function ownsBusiness(viewer, businessId) {
  if (!businessId || typeof businessId !== 'string') return false
  const owned = grantList(viewer, 'ownedBusinessIds')
  return owned !== null && owned.includes(businessId)
}

/**
 * May this viewer WRITE within this Tenant?
 *
 * @req FR-074 — the authority governing creation of a Business inside an
 * existing Tenant, and of a TENANT-scoped Workspace.
 *
 * This is not a new grant. A tenant-wide OWNER Membership — `businessId: null`,
 * `role: 'OWNER'` — has always existed in the data, and `resolveViewer` already
 * expanded it into `ownedBusinessIds` for every Business in that Tenant. What was
 * missing is that the Tenant itself was never named, so a write *at* Tenant scope
 * had nothing to ask. `ownedTenantIds` surfaces a row that was already there and
 * grants nobody anything they did not already hold.
 *
 * Deliberately NOT satisfied by owning every Business in a Tenant. Those are
 * different statements: the set of Businesses is a snapshot, and a principal who
 * happens to own all of today's is not thereby authorized over the Tenant that
 * will hold tomorrow's.
 */
export function ownsTenant(viewer, tenantId) {
  if (!tenantId || typeof tenantId !== 'string') return false
  const owned = grantList(viewer, 'ownedTenantIds')
  return owned !== null && owned.includes(tenantId)
}

/**
 * May this viewer perform an installation-wide operation?
 *
 * @req FR-075 — the authority governing a whole-database restore and the scope
 * primitives that sit above any Tenant.
 *
 * A restore replaces every Portfolio, Tenant, Business, identity and audit row at
 * once. No composition of per-Business or per-Tenant ownership can express that:
 * owning everything that exists today says nothing about the rows the snapshot
 * will introduce. It is a different *scope* of authority, not a larger amount of
 * the same one — which is why the honest answer was never `ownsBusiness` or a
 * loop over it, and why this route stayed unrepayable until the capability was
 * named.
 *
 * True for a platform grant (FR-031, carried on a trusted session per SEC-008)
 * and for the local single-installation session, whose operator is the person at
 * the machine — the premise ADR-016 already designs local backup around. False
 * for every ordinary authenticated principal, including one owning every
 * Business in the installation.
 */
export function isInstallationOperator(viewer) {
  return viewer?.isOperator === true
}

/**
 * May this viewer READ within this Business?
 *
 * Strictly weaker than `ownsBusiness` and never a substitute for it. Use this to
 * decide whether a Business may be *shown*; use `ownsBusiness` to decide whether
 * it may be *changed*.
 */
export function seesBusiness(viewer, businessId) {
  if (!businessId || typeof businessId !== 'string') return false
  const visible = grantList(viewer, 'visibleBusinessIds')
  return visible !== null && visible.includes(businessId)
}

/**
 * May this viewer act as the SoT pipeline's external data plane, for this
 * Tenant? True only for a service-account viewer (FR-102) resolved from a
 * `SotDataPlaneKey` bound to exactly `tenantId`. Deliberately its own
 * predicate rather than a case inside `isInstallationOperator`: a data-plane
 * key is not an installation operator and must never be able to satisfy that
 * check — it can submit and pull SoT decisions for the one Tenant it is
 * scoped to, nothing an operator grant would additionally unlock (whole-
 * installation restore, cross-tenant reach).
 */
export function isSotDataPlaneFor(viewer, tenantId) {
  if (!tenantId || typeof tenantId !== 'string') return false
  if (viewer?.isSotDataPlane !== true) return false
  return viewer.tenantId === tenantId
}

/**
 * May this viewer act as an Enterprise API integration, for this Tenant? True
 * only for a service-account viewer (FR-106) resolved from an `ApiAccessKey`
 * bound to exactly `tenantId`. The same reasoning as `isSotDataPlaneFor`, for
 * the same reason a separate predicate exists at all: an API access key is not
 * an installation operator, not a Person, and not the SoT data plane — it may
 * use the FR-019 Enterprise API surface for the one Tenant it names, and a
 * key can never widen that surface beyond its Tenant however it is presented
 * (SEC-001, SEC-006, BR-002).
 */
export function isApiAccessFor(viewer, tenantId) {
  if (!tenantId || typeof tenantId !== 'string') return false
  if (viewer?.isApiAccess !== true) return false
  return viewer.tenantId === tenantId
}
