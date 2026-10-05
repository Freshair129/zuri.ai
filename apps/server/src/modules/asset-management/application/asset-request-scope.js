// @req FR-137, FR-138, FR-139 — server-derived Business/domain/role scope before work.
// @spec SEC-024, ADR-056
// @tested tests/unit/asset-evidence-route-schema-contract.test.js
// @req FR-133, FR-135 — lifecycle mutations ('manage': dispose, maintenance, verify) need
// the same exact-Business write authority as intake; an unknown capability fails closed.
// @spec SEC-023
// @tested tests/unit/asset-request-scope-capability.test.js
import prisma from '@/lib/db'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { seesBusiness } from '@/modules/identity/viewer-authority'
import { domainsForBusiness } from '@/modules/identity/viewer-domains'
import { isDomainVisible } from '@/config/domains'
import { assertAssetIntakeWrite, assertAssetEvidenceReview } from './asset-authority'

function scopeError(message, status) {
  const error = new Error(message)
  error.status = status
  return error
}

const CAPABILITIES = new Set(['read', 'write', 'manage', 'review'])

export async function resolveAssetRequestScope(request, businessId, { db = prisma, capability = 'read', viewer: trustedViewer = null } = {}) {
  // A misspelt or new capability must never silently degrade to read access.
  if (!CAPABILITIES.has(capability)) throw scopeError(`Unknown asset capability: ${capability}`, 500)
  const viewer = trustedViewer || await resolveRequestViewer(request)
  if (!seesBusiness(viewer, businessId)) throw scopeError('Business not found', 404)
  if (!isDomainVisible('assets', domainsForBusiness(viewer, businessId))) {
    throw scopeError('Asset Management is not enabled for this Business', 403)
  }
  if (capability === 'write' || capability === 'manage') assertAssetIntakeWrite(viewer, businessId)
  if (capability === 'review') assertAssetEvidenceReview(viewer, businessId)
  const business = await db.business.findUnique({ where: { id: businessId }, select: { id: true, tenantId: true } })
  if (!business) throw scopeError('Business not found', 404)
  return { viewer, business }
}
