// The only sanctioned way to build a viewer in a test.
//
// @spec .brain/rca/2026-08-16-global-role-is-not-per-business-authority.md
// @tested tests/unit/viewer-factory-contract.test.js

import { permissionsForRoles } from '@/modules/identity/rbac'
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
 * @param {Record<string,string[]>} [over.rolesByBusinessId]  generic role bindings by Business
 * @param {Record<string,string[]>} [over.permissionsByBusinessId]  resolved permissions by Business
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
    rolesByBusinessId = {},
    permissionsByBusinessId = null,
    isPlatform = role === 'DEV',
    // @req FR-074 — Tenant-scope ownership, from a tenant-wide OWNER Membership.
    // Defaults empty rather than mirroring ownedBusinessIds: a viewer that
    // silently owned Tenants would make a Tenant-scoped guard look satisfied for
    // a reason the test never stated.
    ownedTenantIds = [],
    // @req FR-075 — the installation-wide capability. Defaults to the DEV grant
    // only, so a test proving an operator-only route refuses an ordinary owner
    // cannot pass by forgetting to switch it off.
    isOperator = role === 'DEV',
    principal = { id: 'per-1', code: 'PER-1', displayName: 'Test Principal' },
  } = over

  for (const [name, value] of Object.entries({
    visibleBusinessIds,
    ownedBusinessIds,
    visibleDomains,
    ownedTenantIds,
  })) {
    if (!Array.isArray(value)) fail(`${name} must be an array — resolveViewer always returns one`)
  }

  // @req FR-074 — a DEV grant is cross-tenant visibility and is not derived from
  // Membership, so it owns no Tenant, exactly as it owns no Business.
  if (role === 'DEV' && ownedTenantIds.length) {
    fail('a platform DEV owns no Tenant — ownedTenantIds must be empty')
  }
  // @req FR-074 — the resolver builds ownedTenantIds from OWNER memberships
  // only, so a MEMBER can never carry one.
  if (role === 'MEMBER' && ownedTenantIds.length) {
    fail('role MEMBER cannot own a Tenant — resolveViewer would have labelled this principal OWNER')
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
  // @req FR-074 — a tenant-wide OWNER Membership on a Tenant that holds no
  // Business yet produces exactly this shape: role OWNER, ownedBusinessIds
  // empty, ownedTenantIds set. That was always producible and simply never
  // arose, so the invariant used to over-reject; it now rejects only the shape
  // the resolver genuinely cannot emit — OWNER of nothing at all.
  if (role === 'OWNER' && ownedBusinessIds.length === 0 && ownedTenantIds.length === 0) {
    fail('role OWNER owning neither a Business nor a Tenant cannot occur — use ownsElsewhere() for "OWNER somewhere else"')
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

  // @req FR-076 — generic role bindings and resolved permissions are separate
  // per-Business maps. Neither is inferred from role, ownership or visibility.
  if (typeof rolesByBusinessId !== 'object' || Array.isArray(rolesByBusinessId)) {
    fail('rolesByBusinessId must be a plain object keyed by Business id')
  }
  const roleKeysOutside = Object.keys(rolesByBusinessId).filter((id) => !visibleBusinessIds.includes(id))
  if (roleKeysOutside.length) {
    fail(`rolesByBusinessId mentions ${roleKeysOutside.join(', ')}, which is not in visibleBusinessIds`)
  }
  for (const [businessId, roleKeys] of Object.entries(rolesByBusinessId)) {
    if (!Array.isArray(roleKeys)) fail(`rolesByBusinessId[${businessId}] must be an array`)
  }
  const permissions = permissionsByBusinessId
    ?? Object.fromEntries(Object.entries(rolesByBusinessId).map(([id, roleKeys]) => [id, permissionsForRoles(roleKeys)]))
  if (typeof permissions !== 'object' || Array.isArray(permissions)) {
    fail('permissionsByBusinessId must be a plain object keyed by Business id')
  }
  const permissionKeysOutside = Object.keys(permissions).filter((id) => !visibleBusinessIds.includes(id))
  if (permissionKeysOutside.length) {
    fail(`permissionsByBusinessId mentions ${permissionKeysOutside.join(', ')}, which is not in visibleBusinessIds`)
  }
  for (const [businessId, roleKeys] of Object.entries(rolesByBusinessId)) {
    const expected = permissionsForRoles(roleKeys)
    if (JSON.stringify(permissions[businessId] || []) !== JSON.stringify(expected)) {
      fail(`permissionsByBusinessId[${businessId}] does not match the registered roles`)
    }
  }

  return {
    principal, role, visibleBusinessIds, ownedBusinessIds, ownedTenantIds,
    domainsByBusinessId: domains,
    visibleDomains,
    rolesByBusinessId,
    permissionsByBusinessId: permissions,
    isPlatform,
    isOperator,
  }
}

/**
 * The installation operator: the platform grant, or the local single-installation
 * session. Owns nothing in particular and may still restore the whole database —
 * which is the point, and why it is a separate factory rather than a flag people
 * remember to set.
 */
export function makeOperatorViewer(over = {}) {
  return makeViewer({ isOperator: true, ...over })
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
