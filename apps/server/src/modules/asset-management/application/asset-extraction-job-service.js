import prisma from '@/lib/db'
import { seesBusiness } from '@/modules/identity/viewer-authority'
import { assertDomainVisible } from '@/modules/identity/viewer-domains'

// @req FR-143 — bounded status projection for preserved historical extraction rows.
// @spec ADR-059 D5, ADR-109 D3
// @tested tests/unit/pipeline-health-service.test.js

function jobError(message, status = 404) {
  return Object.assign(new Error(message), { status })
}

/**
 * Read historical extraction job status for the owning Business.
 * The queue and Edge Device execution port were retired; this query remains
 * for Knowledge pipeline health and does not enqueue or dispatch jobs.
 */
export async function listAssetExtractionJobsForBusiness(businessId, { viewer, limit = 100, db = prisma } = {}) {
  const id = typeof businessId === 'string' ? businessId.trim() : ''
  if (!id || !seesBusiness(viewer, id)) throw jobError('Asset extraction job not found')
  assertDomainVisible(viewer, id, 'assets')
  const take = Math.min(Math.max(Number(limit) || 100, 1), 100)
  return db.assetExtractionJob.findMany({
    where: { businessId: id },
    orderBy: { updatedAt: 'desc' },
    take,
    select: { status: true, updatedAt: true },
  })
}
