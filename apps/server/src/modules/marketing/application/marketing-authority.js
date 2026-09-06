import { ownsBusiness, seesBusiness } from '@/modules/identity/viewer-authority'
import { assertDomainVisible } from '@/modules/identity/viewer-domains'

// @req FR-159 — every Marketing plan read/write resolves the trusted Business
// and growth-domain grant before the repository receives a tenant scope.
// @spec SDD-086, BR-001, SEC-001, SEC-008
// @tested tests/unit/marketing/marketing-authority.test.js,
//   tests/integration/marketing-plan.test.js

function errorWithStatus(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

export function marketingNotFound(message = 'Business not found') {
  return errorWithStatus(404, message)
}

export function marketingConflict(message) {
  return errorWithStatus(409, message)
}

export function requireMarketingViewer(viewer, context = 'Marketing authorization') {
  if (!viewer || typeof viewer !== 'object') {
    throw new Error(`${context}: viewer is required`)
  }
}

function requireBusinessId(businessId) {
  if (typeof businessId !== 'string' || !businessId.trim()) {
    throw marketingNotFound()
  }
  return businessId
}

/**
 * Resolve the Business first, then apply the same Business-local domain gate
 * used by the other scoped surfaces. Every refusal is 404-shaped so a caller
 * cannot distinguish a missing Business, a hidden Business, or a hidden domain.
 */
export async function resolveMarketingScope({ db, viewer, businessId, write = false } = {}) {
  requireMarketingViewer(viewer, 'resolveMarketingScope')
  if (!db?.business?.findUnique) {
    throw new Error('resolveMarketingScope requires a Prisma client with a Business model')
  }

  const requestedBusinessId = requireBusinessId(businessId)
  const business = await db.business.findUnique({
    where: { id: requestedBusinessId },
    select: { id: true, tenantId: true, status: true },
  })

  if (!business || !seesBusiness(viewer, requestedBusinessId)) {
    throw marketingNotFound()
  }

  // `growth` is the stable Marketing domain key in the shell registry. The
  // server gate is intentionally evaluated for every request; a URL is never
  // a grant and a previously opened Business cannot carry authority forward.
  assertDomainVisible(viewer, requestedBusinessId, 'growth')

  if (write && (business.status !== 'ACTIVE' || !ownsBusiness(viewer, requestedBusinessId))) {
    throw marketingNotFound()
  }

  return {
    business,
    scope: { tenantId: business.tenantId, businessId: business.id },
    canWrite: business.status === 'ACTIVE' && ownsBusiness(viewer, requestedBusinessId),
  }
}

export async function assertMarketingReadAccess(args = {}) {
  return resolveMarketingScope({ ...args, write: false })
}

export async function assertMarketingWriteAccess(args = {}) {
  return resolveMarketingScope({ ...args, write: true })
}

/**
 * This is safe to call only after `assertMarketingReadAccess`; it deliberately
 * does not query or infer authority from a global role label.
 */
export function canWriteMarketing(viewer, businessId) {
  requireMarketingViewer(viewer, 'canWriteMarketing')
  return ownsBusiness(viewer, businessId)
}
