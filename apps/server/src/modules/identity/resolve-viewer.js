import prisma from '@/lib/db'
import { VIEWER_DOMAINS, allDomainsFor, buildDomainsByBusiness } from './viewer-domains'
import { permissionsForRoles, ROLE_PERMISSIONS, ROLE_SCOPE_BUSINESS, ROLE_SCOPE_TENANT } from './rbac'

// @req FR-031 — all future shell visibility starts from one resolved viewer scope.
// @spec ADR-008 §D4, docs/features/FR-031-viewer-gate.md — DEV is a platform grant,
// never a widened business Membership.
// @tested tests/unit/viewer-gate.test.js
// @req FR-038 — MEMBER domain allow-lists are interpreted here, never by a UI checkbox.
// @spec SDD-017 — OWNER and platform DEV remain role-bound all-domain grants.
// Note (T3e): bare `SEC` cited nothing — no PRD-SDD-v1.0.md SEC-xxx currently
// states this discipline, so this is demoted to a plain comment rather than a
// fabricated citation. `role: 'OWNER'` is a per-principal label, not
// per-business authority: a principal who is OWNER of one Business and
// merely MEMBER of another must not gain write authority over the second
// just because it is also in visibleBusinessIds. `ownedBusinessIds` is the
// actual per-Business OWNER grant set; callers guarding a write MUST check
// `ownedBusinessIds.includes(businessId)`, never `role === 'OWNER'` plus
// `visibleBusinessIds` alone.
// @req FR-061 — domain visibility is per Business for the same reason: a
// consumer holding a businessId asks `domainsForBusiness(viewer, businessId)`,
// never the flat `visibleDomains`, which answers "anywhere" and not "here".
// @spec SDD-034 — every branch below fills `domainsByBusinessId`.
// @tested tests/unit/fr061-per-business-domain-visibility.test.js

export { VIEWER_DOMAINS }

const unique = (values) => [...new Set(values.filter(Boolean))]

// @req FR-192 — a tenant-wide grant is the one that says so. `!businessId` was
// the old test, and it was a reading of a null rather than a reading of an
// intent: the same null meant "every Business here" to this resolver and
// "refuse" to `assertMembershipBusinessOwned` (ADR-077 D3). Both columns are
// consulted so a row written before the migration, or by a fixture that predates
// it, still resolves the way it always did.
const isTenantWide = (membership) => membership.scopeType === 'TENANT' || !membership.businessId

// @req FR-191 — an expired grant grants nothing, and expiring writes no row:
// the decision is recomputed per request like every other one (NFR-019).
const isExpired = (membership, now) => Boolean(membership.expiresAt) && new Date(membership.expiresAt).getTime() <= now

// @req FR-061 — the flat field is the UNION across visible Businesses: "may
// this principal see this domain *anywhere*". It is retained because
// `GET /api/entry` publishes it under a strict contract (FR-046) on a surface
// with no Business selected. It is never an authorization input for a
// Business-scoped decision — ask `domainsForBusiness(viewer, businessId)`.
function unionOfDomains(domainsByBusinessId) {
  const seen = new Set(Object.values(domainsByBusinessId).flat())
  return VIEWER_DOMAINS.filter((key) => seen.has(key))
}

async function allBusinessIds(db) {
  const rows = await db.business.findMany({ select: { id: true } })
  return rows.map((business) => business.id)
}

async function resolvePrincipal(db, principalId) {
  const principal = await db.person.findUnique({ where: { id: principalId }, select: { id: true, code: true, displayName: true } })
  if (!principal) throw new Error('Viewer principal was not found')
  return principal
}

// @req FR-076 — active generic role bindings are resolved per Business.
// @spec ADR-033 D3-D5 — binding status, role registry and Tenant/Business
// ancestry are checked server-side; visibility alone never grants authority.
// @tested tests/unit/fr076-product-owner-business-assignment.test.js
//
// @req FR-192/ADR-077 D3 — teaches the resolver the TENANT RoleBinding scope,
// left inert on purpose when `scopeType` was added ("until the resolver is
// taught to expand it"). The smallest change that does it: a TENANT binding is
// read as a SECOND, independent query and expanded to every ACTIVE Business the
// Tenant holds TODAY — mirroring `buildDomainsByBusiness`'s tenant-wide
// Membership expansion, not derived from `visibleBusinessIds` (a TENANT
// RoleBinding is authority granted AT the Tenant, not a widening of whatever
// Membership already made visible). `hasPermission` is untouched: it only ever
// reads `permissionsByBusinessId`, so widening what this function returns is
// the only surface that changes.
async function resolveRoleBindings(db, principalId, visibleBusinessIds) {
  const empty = { rolesByBusinessId: {}, permissionsByBusinessId: {} }
  if (typeof db.roleBinding?.findMany !== 'function') return empty

  const bindings = await db.roleBinding.findMany({
    where: {
      personId: principalId,
      status: 'ACTIVE',
      OR: [
        { scopeType: ROLE_SCOPE_BUSINESS, businessId: { in: visibleBusinessIds } },
        { scopeType: ROLE_SCOPE_TENANT },
      ],
    },
    select: { tenantId: true, businessId: true, roleKey: true, scopeType: true, status: true },
  })
  if (!bindings.length) return empty

  const businessScoped = bindings.filter((binding) => binding.scopeType === ROLE_SCOPE_BUSINESS)
  const tenantScoped = bindings.filter((binding) => binding.scopeType === ROLE_SCOPE_TENANT)

  const businessIds = unique(businessScoped.map((binding) => binding.businessId))
  const businesses = businessIds.length
    ? await db.business.findMany({
        where: { id: { in: businessIds } },
        select: { id: true, tenantId: true, status: true },
      })
    : []
  const businessById = new Map(businesses.map((business) => [business.id, business]))

  const rolesByBusinessId = {}
  const grant = (businessId, roleKey) => {
    rolesByBusinessId[businessId] = unique([...(rolesByBusinessId[businessId] || []), roleKey])
  }

  for (const binding of businessScoped) {
    const business = businessById.get(binding.businessId)
    const valid = visibleBusinessIds.includes(binding.businessId) &&
      binding.status === 'ACTIVE' &&
      binding.scopeType === ROLE_SCOPE_BUSINESS &&
      ROLE_PERMISSIONS[binding.roleKey] &&
      business &&
      business.status === 'ACTIVE' &&
      business.tenantId === binding.tenantId
    if (valid) grant(binding.businessId, binding.roleKey)
  }

  // A TENANT binding expands to every ACTIVE Business the NAMED Tenant holds —
  // deliberately independent of `visibleBusinessIds`, so a test proves it
  // grants on every Business in the Tenant and NONE outside it.
  const tenantIds = unique(tenantScoped.map((binding) => binding.tenantId))
  const tenantBusinesses = tenantIds.length
    ? await db.business.findMany({
        where: { tenantId: { in: tenantIds }, status: 'ACTIVE' },
        select: { id: true, tenantId: true },
      })
    : []
  for (const binding of tenantScoped) {
    if (!ROLE_PERMISSIONS[binding.roleKey]) continue
    for (const business of tenantBusinesses) {
      if (business.tenantId === binding.tenantId) grant(business.id, binding.roleKey)
    }
  }

  return {
    rolesByBusinessId,
    permissionsByBusinessId: Object.fromEntries(
      Object.entries(rolesByBusinessId).map(([businessId, roleKeys]) => [businessId, permissionsForRoles(roleKeys)]),
    ),
  }
}

/**
 * Resolve the authenticated viewer into the access shape
 * consumed by the ADR-008 Home journey and later route guards.
 *
 * `platformGrant` is trusted input from the future auth provider. It is deliberately
 * not derived from Membership, because DEV is cross-tenant while Membership is not.
 *
 * @param {{ principalId?: string, platformGrant?: boolean, db?: import('@prisma/client').PrismaClient }} [input]
 * @returns {Promise<{principal: {id:string,code:string,displayName:string}, role:'OWNER'|'MEMBER'|'DEV', visibleBusinessIds:string[], ownedBusinessIds:string[], domainsByBusinessId:Record<string,string[]>, visibleDomains:string[], rolesByBusinessId:Record<string,string[]>, permissionsByBusinessId:Record<string,string[]>, isPlatform:boolean}>}
 */
export async function resolveViewer({
  principalId = null,
  platformGrant = false,
  superadminGrant = false,
  db = prisma,
  // Injectable so a test can place a grant's expiry on either side of the line
  // without sleeping, the same seam `operator-bootstrap` already uses.
  now = Date.now(),
} = {}) {
  if (!principalId) {
    throw new Error('Viewer principal is required')
  }

  const principal = await resolvePrincipal(db, principalId)

  // @req FR-200 — a separate trusted browser grant, never implied by OPERATOR.
  // @spec ADR-082 — keep existing wire role values and enumerate real ids so
  // scoped guards still deny nonexistent targets. Refresh includes new scopes.
  if (superadminGrant) {
    const [visibleBusinessIds, tenants, portfolios] = await Promise.all([
      allBusinessIds(db),
      db.tenant.findMany({ select: { id: true } }),
      db.portfolio.findMany({ select: { id: true } }),
    ])
    const permissions = [...new Set(Object.values(ROLE_PERMISSIONS).flat())]
    return {
      principal, role: 'OWNER', isSuperadmin: true, isPlatform: true, isOperator: true,
      visibleBusinessIds, ownedBusinessIds: [...visibleBusinessIds],
      ownedTenantIds: tenants.map(({ id }) => id),
      ownedPortfolioIds: portfolios.map(({ id }) => id),
      domainsByBusinessId: allDomainsFor(visibleBusinessIds),
      visibleDomains: [...VIEWER_DOMAINS],
      rolesByBusinessId: {},
      permissionsByBusinessId: Object.fromEntries(visibleBusinessIds.map((id) => [id, [...permissions]])),
    }
  }

  if (platformGrant) {
    // A platform DEV grant is cross-tenant visibility, not per-Business OWNER
    // authority — it is not derived from Membership, so it confers no ownership.
    // requireOwner-style checks and the Overview UI both rely on this staying empty.
    const visibleBusinessIds = await allBusinessIds(db)
    const roleBindings = await resolveRoleBindings(db, principal.id, visibleBusinessIds)
    return {
      principal,
      role: 'DEV',
      visibleBusinessIds,
      ownedBusinessIds: [],
      // @req FR-061 — unrestricted, but still stated per Business (SDD-034):
      // filling the map rather than raising a flag leaves consumers no
      // shortcut to read in place of the scoped question.
      domainsByBusinessId: allDomainsFor(visibleBusinessIds),
      visibleDomains: [...VIEWER_DOMAINS],
      ...roleBindings,
      isPlatform: true,
      // @req FR-074 — a DEV grant confers no ownership at Tenant scope for the
      // same reason it confers none at Business scope: it is not derived from
      // Membership.
      ownedTenantIds: [],
      // @req FR-075 — but it IS the installation-wide capability. A different
      // *scope* of authority, not a larger amount of the ownership above, which
      // is why these two fields sit side by side and disagree.
      isOperator: true,
    }
  }

  // @req FR-067 — deliberately reads `Membership` ONLY. `WorkspaceMembership`
  // (the FR-067 collaboration grant on a Portfolio) is a distinct authority
  // layer (BR-016) and must never be an input here: holding one grants no
  // visibleBusinessIds, no ownedBusinessIds, no ownedTenantIds and no domain —
  // the same discipline that keeps FR-089's TeamMembership out of this resolver.
  // @tested tests/integration/workspace-onboarding-flow.test.js
  //
  // @req FR-191 — a grant is admitted only while it is ACTIVE *and* unexpired.
  // The expiry half is filtered here rather than in SQL because the dev
  // datasource is SQLite and the production one is Postgres; one predicate in
  // JavaScript is one behaviour, where two dialect-specific `where` fragments
  // would be two. Nothing sets `expiresAt` from a surface yet (ADR-077
  // Consequences) — the reader exists so that recertification can be added
  // without a second migration against live authority data.
  // @spec ADR-077 D2, BR-033
  const membershipRows = await db.membership.findMany({
    where: { personId: principal.id, status: 'ACTIVE' },
    select: { tenantId: true, businessId: true, scopeType: true, role: true, status: true, domainKeysJson: true, expiresAt: true, version: true },
  })
  const memberships = membershipRows.filter((membership) => !isExpired(membership, now))
  const tenantWideIds = unique(memberships.filter(isTenantWide).map((membership) => membership.tenantId))
  const tenantBusinesses = tenantWideIds.length
    ? await db.business.findMany({ where: { tenantId: { in: tenantWideIds } }, select: { id: true, tenantId: true } })
    : []
  const visibleBusinessIds = unique([
    ...memberships.map((membership) => membership.businessId),
    ...tenantBusinesses.filter((business) => tenantWideIds.includes(business.tenantId)).map((business) => business.id),
  ])

  // Per-Business OWNER authority, mirroring the tenant-wide expansion above but
  // restricted to OWNER memberships only — this is the actual write-authority set.
  // A MEMBER membership elsewhere must never land here just because `role` above
  // is a global 'OWNER'|'MEMBER' label and that Business is already visible.
  const ownerMemberships = memberships.filter((membership) => membership.role === 'OWNER')
  const ownerTenantWideIds = unique(ownerMemberships.filter(isTenantWide).map((membership) => membership.tenantId))
  const ownedBusinessIds = unique([
    ...ownerMemberships.map((membership) => membership.businessId),
    ...tenantBusinesses.filter((business) => ownerTenantWideIds.includes(business.tenantId)).map((business) => business.id),
  ])

  // @req FR-061 — built from the same rows and the same tenant-wide expansion
  // as the two id sets above, so an OWNER Membership grants every domain on the
  // Businesses it covers and widens nothing elsewhere.
  const domainsByBusinessId = buildDomainsByBusiness({ memberships, tenantBusinesses })
  const roleBindings = await resolveRoleBindings(db, principal.id, visibleBusinessIds)

  return {
    principal,
    role: memberships.some((membership) => membership.role === 'OWNER') ? 'OWNER' : 'MEMBER',
    visibleBusinessIds,
    ownedBusinessIds,
    // @req FR-074 — `ownerTenantWideIds` is the row that already existed and was
    // only ever read on the way to `ownedBusinessIds`. Naming it here is what
    // makes a write *at* Tenant scope answerable; it widens nothing, because the
    // very same memberships already granted every Business beneath each Tenant.
    // Note this is NOT "owns every Business in the Tenant" — a principal owning
    // all of today's Businesses individually still does not own the Tenant that
    // will hold tomorrow's.
    ownedTenantIds: ownerTenantWideIds,
    domainsByBusinessId,
    visibleDomains: unionOfDomains(domainsByBusinessId),
    ...roleBindings,
    isPlatform: false,
    // @req FR-075 — an ordinary authenticated principal is never the
    // installation operator, however much of the installation they own. A
    // restore replaces rows in Tenants they have never seen.
    isOperator: false,
  }
}
