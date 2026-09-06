// @req FR-136 — Asset depreciation candidate computation, persistence, and Finance review preview.
// @spec SDD-080, NFR-021, BR-023, ADR-055
// @tested tests/unit/asset-depreciation.test.js
import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { calculateStraightLineDepreciation } from '../domain/depreciation'

function depError(message, status = 400) {
  const error = new Error(message)
  error.status = status
  return error
}

/**
 * Get or compute a deterministic straight-line depreciation schedule for a registered asset.
 */
export async function getOrCreateAssetDepreciationCandidate({
  businessId,
  registeredAssetId,
  usefulLifeMonths = 36,
  residualValue = '0.00',
  startDate = null,
  recalculate = false,
  viewer,
  db = prisma,
} = {}) {
  if (!businessId) throw depError('Business ID is required', 400)
  if (!registeredAssetId) throw depError('Registered Asset ID is required', 400)

  const asset = await db.registeredAsset.findFirst({
    where: { id: registeredAssetId, businessId, deletedAt: null },
    include: {
      tenant: { select: { id: true } },
    },
  })

  if (!asset) {
    throw depError('Registered asset not found in business scope', 404)
  }

  // Check if candidate already exists
  if (!recalculate) {
    const existing = await db.assetDepreciationCandidate.findFirst({
      where: { registeredAssetId, businessId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    })

    if (existing) {
      return {
        id: existing.id,
        registeredAssetId: existing.registeredAssetId,
        method: existing.method,
        acquisitionAmount: existing.acquisitionAmount,
        residualValue: existing.residualValue,
        currency: existing.currency,
        usefulLifeMonths: existing.usefulLifeMonths,
        startDate: existing.startDate.toISOString().slice(0, 10),
        calculationVersion: existing.calculationVersion,
        status: existing.status,
        schedule: JSON.parse(existing.scheduleJson || '[]'),
        accountingAuthority: false,
        reviewedByPersonId: existing.reviewedByPersonId,
        reviewedAt: existing.reviewedAt,
      }
    }
  }

  const acquisitionAmount = asset.acquisitionAmount || '0.00'
  const currency = asset.currency || 'THB'
  const calcStartDate = startDate || (asset.receivedOn ? asset.receivedOn.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10))

  const calculated = calculateStraightLineDepreciation({
    acquisitionAmount,
    residualValue: String(residualValue || '0.00'),
    usefulLifeMonths: parseInt(usefulLifeMonths, 10) || 36,
    startDate: calcStartDate,
    currency,
  })

  const candidate = await db.assetDepreciationCandidate.create({
    data: {
      tenantId: asset.tenantId,
      businessId: asset.businessId,
      registeredAssetId: asset.id,
      method: calculated.method,
      acquisitionAmount: calculated.acquisitionAmount,
      residualValue: calculated.residualValue,
      currency: calculated.currency,
      usefulLifeMonths: parseInt(usefulLifeMonths, 10) || 36,
      startDate: new Date(`${calcStartDate}T00:00:00.000Z`),
      calculationVersion: calculated.calculationVersion,
      scheduleJson: JSON.stringify(calculated.schedule),
      status: 'PREVIEW',
    },
  })

  await recordAudit(db, {
    entityType: 'REGISTERED_ASSET',
    entityId: asset.id,
    action: 'ASSET_DEPRECIATION_CALCULATED',
    payloadJson: JSON.stringify({
      candidateId: candidate.id,
      method: calculated.method,
      usefulLifeMonths,
      acquisitionAmount: calculated.acquisitionAmount,
      residualValue: calculated.residualValue,
    }),
    actorId: viewer?.personId || 'SYSTEM',
  })

  return {
    id: candidate.id,
    registeredAssetId: candidate.registeredAssetId,
    method: candidate.method,
    acquisitionAmount: candidate.acquisitionAmount,
    residualValue: candidate.residualValue,
    currency: candidate.currency,
    usefulLifeMonths: candidate.usefulLifeMonths,
    startDate: calcStartDate,
    calculationVersion: candidate.calculationVersion,
    status: candidate.status,
    schedule: calculated.schedule,
    accountingAuthority: false,
  }
}
