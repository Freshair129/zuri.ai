// @req FR-133, FR-135 — fast QR token lookup, physical asset identification, and stocktake verification.
// @spec SDD-078, SDD-080, BR-023, SEC-023, ADR-055
// @tested tests/unit/asset-lookup-service.test.js
import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { relocateAsset } from './asset-lifecycle-service'

function lookupError(message, status = 400) {
  const error = new Error(message)
  error.status = status
  return error
}

/**
 * Parse an asset code from raw text, QR payload URI, or deep link.
 * Examples:
 * - "AST-2026-00001"
 * - "zuri://assets/biz-123/AST-2026-00001?v=1"
 * - "https://app.zuri.ai/assets/lookup?b=biz-123&code=AST-2026-00001"
 * - "https://app.zuri.ai/assets/register/ast-uuid-123"
 */
export function parseAssetCodeOrId(rawInput) {
  if (!rawInput || typeof rawInput !== 'string') return ''
  const trimmed = rawInput.trim()

  // Match raw AST-YYYY-XXXXX
  const codeMatch = trimmed.match(/AST-\d{4}-\d{5}/i)
  if (codeMatch) {
    return codeMatch[0].toUpperCase()
  }

  // Check URL params (?code=AST-...)
  try {
    const url = new URL(trimmed.startsWith('http') || trimmed.startsWith('zuri') ? trimmed : `https://dummy/${trimmed}`)
    const codeParam = url.searchParams.get('code') || url.searchParams.get('assetCode')
    if (codeParam) {
      const match = codeParam.match(/AST-\d{4}-\d{5}/i)
      if (match) return match[0].toUpperCase()
      return codeParam.trim()
    }
  } catch {
    // Ignore URL parse failures for simple strings
  }

  return trimmed
}

/**
 * Lookup an asset by QR code, assetCode, or internal ID within the trusted Business scope.
 */
export async function lookupAssetByQrOrCode({
  businessId,
  codeOrToken,
  db = prisma,
} = {}) {
  if (!businessId) throw lookupError('Business ID is required', 400)
  if (!codeOrToken) throw lookupError('Asset code or QR token is required', 400)

  const identifier = parseAssetCodeOrId(codeOrToken)

  // Search by exact assetCode first, then by UUID id, then by serialNumber
  const asset = await db.registeredAsset.findFirst({
    where: {
      businessId,
      deletedAt: null,
      OR: [
        { assetCode: identifier },
        { id: identifier },
        { serialNumber: identifier },
      ],
    },
    include: {
      lot: {
        select: { id: true, lotCode: true, expiresOn: true, status: true },
      },
      responsibilities: {
        where: { effectiveTo: null },
        include: {
          person: { select: { id: true, displayName: true, email: true } },
        },
      },
      locations: {
        where: { effectiveTo: null },
        include: {
          branch: { select: { id: true, name: true, code: true } },
        },
      },
      projectAllocations: {
        where: { effectiveTo: null, status: 'ACTIVE' },
        include: {
          project: { select: { id: true, name: true, code: true } },
          workstream: { select: { id: true, name: true } },
        },
      },
      evidence: {
        where: { deletedAt: null },
        include: {
          fileAsset: { select: { id: true, name: true, mimeType: true, sizeBytes: true } },
        },
      },
    },
  })

  if (!asset) {
    throw lookupError(`Asset not found for identifier: ${identifier}`, 404)
  }

  // Format active pointers for instant client consumption
  const activeAccountable = asset.responsibilities.find((r) => r.role === 'ACCOUNTABLE') || null
  const activeCustodian = asset.responsibilities.find((r) => r.role === 'CUSTODIAN') || null
  const activeUser = asset.responsibilities.find((r) => r.role === 'USER') || null
  const activeLocation = asset.locations.find((l) => l.isPrimary) || asset.locations[0] || null
  const activeAllocation = asset.projectAllocations[0] || null

  const photoEvidence = asset.evidence.find((e) => e.role === 'ASSET_PHOTO') || null

  return {
    id: asset.id,
    assetCode: asset.assetCode,
    name: asset.name,
    categoryCode: asset.categoryCode,
    description: asset.description,
    brand: asset.brand,
    model: asset.model,
    serialNumber: asset.serialNumber,
    status: asset.status,
    condition: asset.condition,
    acquisitionAmount: asset.acquisitionAmount,
    currency: asset.currency,
    receivedOn: asset.receivedOn,
    registeredAt: asset.registeredAt,
    qrPayload: `zuri://assets/${businessId}/${asset.assetCode}?v=1`,
    activeAccountable: activeAccountable ? {
      id: activeAccountable.personId,
      name: activeAccountable.person?.displayName || 'Unknown',
      email: activeAccountable.person?.email || null,
      effectiveFrom: activeAccountable.effectiveFrom,
    } : null,
    activeCustodian: activeCustodian ? {
      id: activeCustodian.personId,
      name: activeCustodian.person?.displayName || 'Unknown',
      email: activeCustodian.person?.email || null,
      effectiveFrom: activeCustodian.effectiveFrom,
    } : null,
    activeUser: activeUser ? {
      id: activeUser.personId,
      name: activeUser.person?.displayName || 'Unknown',
      effectiveFrom: activeUser.effectiveFrom,
    } : null,
    currentLocation: activeLocation ? {
      id: activeLocation.id,
      branchId: activeLocation.branchId,
      branchName: activeLocation.branch?.name || null,
      locationCode: activeLocation.locationCode,
      locationName: activeLocation.locationName,
      effectiveFrom: activeLocation.effectiveFrom,
    } : null,
    activeAllocation: activeAllocation ? {
      id: activeAllocation.id,
      projectId: activeAllocation.projectId,
      projectName: activeAllocation.project?.name || 'Project',
      projectCode: activeAllocation.project?.code || null,
      workstreamId: activeAllocation.workstreamId,
      workstreamName: activeAllocation.workstream?.name || null,
      effectiveFrom: activeAllocation.effectiveFrom,
    } : null,
    lot: asset.lot || null,
    photoEvidence: photoEvidence ? {
      id: photoEvidence.id,
      fileAssetId: photoEvidence.fileAssetId,
      fileName: photoEvidence.fileAsset?.name,
    } : null,
    verifiedAt: new Date().toISOString(),
  }
}

/**
 * Record a physical stocktake/audit observation for a registered asset.
 */
export async function verifyAssetObservation({
  businessId,
  registeredAssetId,
  observedBranchId = null,
  observedLocationName = '',
  observedLocationCode = '',
  condition = null,
  notes = '',
  relocateIfMismatch = false,
  viewer,
  db = prisma,
} = {}) {
  if (!businessId) throw lookupError('Business ID is required', 400)
  if (!registeredAssetId) throw lookupError('Registered Asset ID is required', 400)

  const asset = await db.registeredAsset.findFirst({
    where: { id: registeredAssetId, businessId, deletedAt: null },
    include: {
      locations: {
        where: { effectiveTo: null },
      },
    },
  })

  if (!asset) {
    throw lookupError('Registered asset not found in business scope', 404)
  }

  const currentLocation = asset.locations.find((l) => l.isPrimary) || asset.locations[0] || null
  const locationMatches =
    (!observedLocationName && !observedBranchId) ||
    (currentLocation &&
      currentLocation.locationName === observedLocationName &&
      (!observedBranchId || currentLocation.branchId === observedBranchId))

  let relocated = false
  if (relocateIfMismatch && !locationMatches && (observedLocationName || observedBranchId)) {
    await relocateAsset({
      businessId,
      registeredAssetId,
      branchId: observedBranchId,
      locationCode: observedLocationCode || 'STOCKTAKE-LOC',
      locationName: observedLocationName || 'Updated during stocktake',
      viewer,
      db,
    })
    relocated = true
  }

  if (condition && condition !== asset.condition) {
    await db.registeredAsset.update({
      where: { id: registeredAssetId },
      data: {
        condition,
        updatedAt: new Date(),
      },
    })
  }

  const observationResult = {
    registeredAssetId,
    assetCode: asset.assetCode,
    scannedByPersonId: viewer?.personId || null,
    scannedAt: new Date().toISOString(),
    locationMatches,
    relocated,
    previousLocation: currentLocation ? {
      branchId: currentLocation.branchId,
      locationName: currentLocation.locationName,
    } : null,
    observedLocation: {
      branchId: observedBranchId,
      locationName: observedLocationName,
    },
    condition: condition || asset.condition,
    notes,
  }

  await recordAudit(db, {
    entityType: 'REGISTERED_ASSET',
    entityId: registeredAssetId,
    action: 'ASSET_PHYSICALLY_VERIFIED',
    payloadJson: JSON.stringify(observationResult),
    actorId: viewer?.personId || 'SYSTEM',
  })

  return observationResult
}
