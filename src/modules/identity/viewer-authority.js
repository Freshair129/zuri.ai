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
