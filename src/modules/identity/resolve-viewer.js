import prisma from '@/lib/db'
import { DOMAINS } from '@/config/domains'

// @req FR-031 — all future shell visibility starts from one resolved viewer scope.
// @spec ADR-008 §D4, docs/features/FR-031-viewer-gate.md — DEV is a platform grant,
// never a widened business Membership; the local fallback exists only in development.
// @tested tests/unit/viewer-gate.test.js
// @req FR-038 — MEMBER domain allow-lists are interpreted here, never by a UI checkbox.
// @spec SDD-017 — OWNER and platform DEV remain role-bound all-domain grants.

const LOCAL_OWNER_CODE = 'PER-OWNER'
export const VIEWER_DOMAINS = DOMAINS.map((domain) => domain.key)

const unique = (values) => [...new Set(values.filter(Boolean))]

function visibleDomainsForMemberships(memberships) {
  if (memberships.some((membership) => membership.role === 'OWNER')) return VIEWER_DOMAINS
  const grants = memberships.flatMap((membership) => {
    try {
      const keys = JSON.parse(membership.domainKeysJson || '[]')
      return Array.isArray(keys) ? keys : []
    } catch {
      return []
    }
  })
  return unique(grants.filter((key) => VIEWER_DOMAINS.includes(key)))
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

/**
 * Resolve the authenticated (or local-development) viewer into the access shape
 * consumed by the ADR-008 Home journey and later route guards.
 *
 * `platformGrant` is trusted input from the future auth provider. It is deliberately
 * not derived from Membership, because DEV is cross-tenant while Membership is not.
 *
 * @param {{ principalId?: string, platformGrant?: boolean, allowDevelopmentFallback?: boolean, db?: import('@prisma/client').PrismaClient }} [input]
 * @returns {Promise<{principal: {id:string,code:string,displayName:string}, role:'OWNER'|'MEMBER'|'DEV', visibleBusinessIds:string[], visibleDomains:string[], isPlatform:boolean}>}
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
    return {
      principal,
      role: 'DEV',
      visibleBusinessIds: await allBusinessIds(db),
      visibleDomains: VIEWER_DOMAINS,
      isPlatform: true,
    }
  }

  // There is no authenticated principal yet, so the local development owner can
  // exercise every shell path. This branch is unavailable to production callers.
  if (!principalId) {
    return {
      principal,
      role: 'OWNER',
      visibleBusinessIds: await allBusinessIds(db),
      visibleDomains: VIEWER_DOMAINS,
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

  return {
    principal,
    role: memberships.some((membership) => membership.role === 'OWNER') ? 'OWNER' : 'MEMBER',
    visibleBusinessIds,
    visibleDomains: visibleDomainsForMemberships(memberships),
    isPlatform: false,
  }
}
