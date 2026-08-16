// The only sanctioned way to build a viewer in a test.
//
// @spec .brain/rca/2026-08-16-global-role-is-not-per-business-authority.md
// @tested tests/unit/viewer-factory-contract.test.js
//
// Three authorization holes shipped this repository's tests green because every
// suite built viewers by hand, in shapes `resolveViewer` cannot actually
// produce — typically `{ role: 'OWNER', visibleBusinessIds: [...] }` with no
// `ownedBusinessIds` at all. The guard passed, the test passed, and the hole was
// invisible from inside the suite.
//
// This factory does not merely fill in the missing fields. It enforces the
// resolver's own invariants, so the impossible viewer that hid those bugs
// cannot be constructed at all. If you find yourself fighting it, the shape you
// want probably cannot exist in production either — which is the point.

const DEFAULT_DOMAINS = ['projects', 'people', 'platform']

function fail(message) {
  throw new Error(
    `makeViewer: ${message}\n` +
    'This shape cannot be produced by resolveViewer, so a test built on it would ' +
    'prove nothing about real behaviour.',
  )
}

/**
 * Build a viewer with the same shape and invariants as `resolveViewer`.
 *
 * @param {object} [over]
 * @param {'OWNER'|'MEMBER'|'DEV'} [over.role]
 * @param {string[]} [over.visibleBusinessIds]
 * @param {string[]} [over.ownedBusinessIds]  must be a subset of visibleBusinessIds
 * @param {string[]} [over.visibleDomains]        the union across Businesses
 * @param {Record<string,string[]>} [over.domainsByBusinessId]  per-Business grant
 * @param {boolean}  [over.isPlatform]
 * @param {object}   [over.principal]
 */
export function makeViewer(over = {}) {
  const {
    role = over.ownedBusinessIds?.length ? 'OWNER' : 'MEMBER',
    visibleBusinessIds = ['b-1'],
    ownedBusinessIds = role === 'OWNER' ? visibleBusinessIds : [],
    visibleDomains = DEFAULT_DOMAINS,
    // @req FR-061 — every resolver branch emits this, so a fixture without it
    // is a shape production cannot produce. Filled in below (not here) so the
    // array checks still run first on a caller that passed a non-array.
    domainsByBusinessId = null,
    isPlatform = role === 'DEV',
    principal = { id: 'per-1', code: 'PER-1', displayName: 'Test Principal' },
  } = over

  for (const [name, value] of Object.entries({ visibleBusinessIds, ownedBusinessIds, visibleDomains })) {
    if (!Array.isArray(value)) fail(`${name} must be an array — resolveViewer always returns one`)
  }

  // `ownedBusinessIds ⊆ visibleBusinessIds` holds in all three resolver branches.
  const outside = ownedBusinessIds.filter((id) => !visibleBusinessIds.includes(id))
  if (outside.length) {
    fail(`ownedBusinessIds contains ${outside.join(', ')}, which is not in visibleBusinessIds`)
  }

  // A platform DEV grant is cross-tenant visibility, never per-Business ownership.
  if (role === 'DEV' && ownedBusinessIds.length) {
    fail('a platform DEV owns no Business — ownedBusinessIds must be empty')
  }

  // `role` is a *global* label derived from the same memberships as
  // ownedBusinessIds: OWNER exactly when the principal owns something. To model
  // "OWNER elsewhere, only a MEMBER here" — the shape that hid three holes —
  // give them a Business they own and a separate one they merely see.
  if (role === 'OWNER' && ownedBusinessIds.length === 0) {
    fail('role OWNER with an empty ownedBusinessIds cannot occur — use ownsElsewhere() for "OWNER somewhere else"')
  }
  if (role === 'MEMBER' && ownedBusinessIds.length) {
    fail('role MEMBER cannot own a Business — resolveViewer would have labelled this principal OWNER')
  }

  // @req FR-061 — the map may only speak about Businesses the viewer can see,
  // and an owned Business always carries every domain (an OWNER Membership
  // derives them from the role, per Membership). Defaulting to an even grant on
  // every visible Business keeps existing callers honest without forcing them
  // to spell it out; pass it explicitly to model an uneven grant.
  const domains = domainsByBusinessId
    ?? Object.fromEntries(visibleBusinessIds.map((id) => [id, [...visibleDomains]]))
  if (typeof domains !== 'object' || Array.isArray(domains)) {
    fail('domainsByBusinessId must be a plain object keyed by Business id')
  }
  const unseen = Object.keys(domains).filter((id) => !visibleBusinessIds.includes(id))
  if (unseen.length) {
    fail(`domainsByBusinessId mentions ${unseen.join(', ')}, which is not in visibleBusinessIds`)
  }
  const thin = ownedBusinessIds.filter((id) => (domains[id] || []).length < visibleDomains.length)
  if (thin.length) {
    fail(`${thin.join(', ')} is owned, so it must carry every domain the viewer sees anywhere`)
  }

  return {
    principal, role, visibleBusinessIds, ownedBusinessIds,
    domainsByBusinessId: domains, visibleDomains, isPlatform,
  }
}

/**
 * The attacker shape from the authorization RCAs: OWNER of Business A, merely a
 * MEMBER of Business B. `role` is the global 'OWNER' label and B is visible,
 * yet B is not owned — the exact combination two guards failed to compose.
 */
export function ownsElsewhere({ owns = 'b-owned', sees = 'b-target', seesDomains = null, ...rest } = {}) {
  const visibleDomains = rest.visibleDomains || DEFAULT_DOMAINS
  return makeViewer({
    role: 'OWNER',
    visibleBusinessIds: [owns, sees],
    ownedBusinessIds: [owns],
    // @req FR-061 — the same shape has a domain dimension: all domains on the
    // owned Business, only what the Membership granted on the other. Pass
    // `seesDomains` to model it; omitted keeps the pre-FR-061 default of an
    // even grant, so existing callers still assert what they meant to.
    ...(seesDomains ? { domainsByBusinessId: { [owns]: [...visibleDomains], [sees]: seesDomains } } : {}),
    ...rest,
  })
}

/** A platform developer: sees everything, owns nothing. */
export function makeDevViewer(over = {}) {
  return makeViewer({ role: 'DEV', ownedBusinessIds: [], isPlatform: true, ...over })
}
