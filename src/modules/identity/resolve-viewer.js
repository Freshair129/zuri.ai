import prisma from '@/lib/db'
import { VIEWER_DOMAINS, allDomainsFor, buildDomainsByBusiness } from './viewer-domains'
import { permissionsForRoles, ROLE_PERMISSIONS, ROLE_SCOPE_BUSINESS } from './rbac'

// @req FR-031 — all future shell visibility starts from one resolved viewer scope.
// @spec ADR-008 §D4, docs/features/FR-031-viewer-gate.md — DEV is a platform grant,
// never a widened business Membership; the local fallback exists only in development.
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

const LOCAL_OWNER_CODE = 'PER-OWNER'
export { VIEWER_DOMAINS }

const unique = (values) => [...new Set(values.filter(Boolean))]

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
  const where = principalId ? { id: principalId } : { code: LOCAL_OWNER_CODE }
  const principal = await db.person.findUnique({ where, select: { id: true, code: true, displayName: true } })
  if (!principal) throw new Error(principalId ? 'Viewer principal was not found' : 'Local development owner was not found')
  return principal
}

// @req FR-076 — active generic role bindings are resolved per Business.
// @spec ADR-033 D3-D5 — binding status, role registry and Tenant/Business
// ancestry are checked server-side; visibility alone never grants authority.
// @tested tests/unit/fr076-product-owner-business-assignment.test.js
async function resolveRoleBindings(db, principalId, visibleBusinessIds) {
  const empty = { rolesByBusinessId: {}, permissionsByBusinessId: {} }
  if (typeof db.roleBinding?.findMany !== 'function') return empty

  const bindings = await db.roleBinding.findMany({
    where: {
      personId: principalId,
      status: 'ACTIVE',
      scopeType: ROLE_SCOPE_BUSINESS,
      businessId: { in: visibleBusinessIds },
    },
    select: { tenantId: true, businessId: true, roleKey: true, scopeType: true, status: true },
  })
  if (!bindings.length) return empty

  const businessIds = unique(bindings.map((binding) => binding.businessId))
  const businesses = businessIds.length
    ? await db.business.findMany({
        where: { id: { in: businessIds } },
        select: { id: true, tenantId: true, status: true },
      })
    : []
  const businessById = new Map(businesses.map((business) => [business.id, business]))
  const rolesByBusinessId = {}
  for (const binding of bindings) {
    const business = businessById.get(binding.businessId)
    const valid = visibleBusinessIds.includes(binding.businessId) &&
      binding.status === 'ACTIVE' &&
      binding.scopeType === ROLE_SCOPE_BUSINESS &&
      ROLE_PERMISSIONS[binding.roleKey] &&
      business &&
      business.status === 'ACTIVE' &&
      business.tenantId === binding.tenantId
    if (valid) {
      rolesByBusinessId[binding.businessId] = unique([
        ...(rolesByBusinessId[binding.businessId] || []),
        binding.roleKey,
      ])
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
 * Resolve the authenticated (or local-development) viewer into the access shape
 * consumed by the ADR-008 Home journey and later route guards.
 *
 * `platformGrant` is trusted input from the future auth provider. It is deliberately
 * not derived from Membership, because DEV is cross-tenant while Membership is not.
 *
 * @param {{ principalId?: string, platformGrant?: boolean, allowDevelopmentFallback?: boolean, db?: import('@prisma/client').PrismaClient }} [input]
 * @returns {Promise<{principal: {id:string,code:string,displayName:string}, role:'OWNER'|'MEMBER'|'DEV', visibleBusinessIds:string[], ownedBusinessIds:string[], domainsByBusinessId:Record<string,string[]>, visibleDomains:string[], rolesByBusinessId:Record<string,string[]>, permissionsByBusinessId:Record<string,string[]>, isPlatform:boolean}>}
 */
export async function resolveViewer({
  principalId = null,
  platformGrant = false,
  allowDevelopmentFallback = process.env.NODE_ENV !== 'production',
  db = prisma,
} = {}) {
  if (!principalId && !allowDevelopmentFallback) {
    throw new Error('Viewer principal is required')
  }

  const principal = await resolvePrincipal(db, principalId)

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
    }
  }

  // There is no authenticated principal yet, so the local development owner can
  // exercise every shell path. This branch is unavailable to production callers.
  if (!principalId) {
    const businessIds = await allBusinessIds(db)
    const roleBindings = await resolveRoleBindings(db, principal.id, businessIds)
    // Two independently owned arrays, not the same object twice: no consumer
    // mutates either today, but sharing one array between visibleBusinessIds
    // and ownedBusinessIds is an invisible coupling — a future mutation of
    // one would silently corrupt the other.
    return {
      principal,
      role: 'OWNER',
      visibleBusinessIds: [...businessIds],
      ownedBusinessIds: [...businessIds],
      domainsByBusinessId: allDomainsFor(businessIds),
      visibleDomains: [...VIEWER_DOMAINS],
      ...roleBindings,
      isPlatform: false,
    }
  }

  const memberships = await db.membership.findMany({
    where: { personId: principal.id },
    select: { tenantId: true, businessId: true, role: true, domainKeysJson: true },
  })
  const tenantWideIds = unique(memberships.filter((membership) => !membership.businessId).map((membership) => membership.tenantId))
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
  const ownerTenantWideIds = unique(ownerMemberships.filter((membership) => !membership.businessId).map((membership) => membership.tenantId))
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
    domainsByBusinessId,
    visibleDomains: unionOfDomains(domainsByBusinessId),
    ...roleBindings,
    isPlatform: false,
  }
}
