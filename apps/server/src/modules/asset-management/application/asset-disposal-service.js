// @req FR-133, FR-135 — Decommissioning & Disposal Lifecycle (AM-RQ-070..AM-RQ-073).
// @spec SDD-078, SDD-080, BR-023, SEC-023, ADR-055
// @tested tests/unit/asset-disposal-service.test.js
import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'

function dispError(message, status = 400) {
  const error = new Error(message)
  error.status = status
  return error
}

export const DISPOSAL_METHODS = ['SCRAP', 'SELL', 'DONATE', 'LOSS_THEFT']

/**
 * Request or finalize disposal/decommissioning for a registered asset.
 * Transitions asset status to `DISPOSED` and archives the asset.
 */
export async function finalizeAssetDisposal({
  businessId,
  registeredAssetId,
  method = 'SCRAP', // 'SCRAP' | 'SELL' | 'DONATE' | 'LOSS_THEFT'
  reason,
  salePrice = null,
  buyerOrRecipient = null,
  documentRef = null,
  evidenceFileAssetId = null,
  viewer,
  db = prisma,
} = {}) {
  if (!businessId) throw dispError('Business ID is required', 400)
  if (!registeredAssetId) throw dispError('Registered Asset ID is required', 400)
  if (!reason || !reason.trim()) throw dispError('Disposal reason is required', 400)
  if (!DISPOSAL_METHODS.includes(method)) {
    throw dispError(`Invalid disposal method. Must be one of: ${DISPOSAL_METHODS.join(', ')}`, 400)
  }

  const asset = await db.registeredAsset.findFirst({
    where: { id: registeredAssetId, businessId, deletedAt: null },
    include: {
      projectAllocations: {
        where: { effectiveTo: null, status: 'ACTIVE' },
      },
    },
  })

  if (!asset) {
    throw dispError('Registered asset not found in business scope', 404)
  }

  if (asset.status === 'DISPOSED') {
    throw dispError('Asset is already disposed and cannot be modified', 400)
  }

  if (asset.projectAllocations.length > 0) {
    throw dispError('Cannot dispose asset while it is actively allocated to a project. Return it first.', 400)
  }

  // Update asset status to DISPOSED and condition to DAMAGED or POOR if scrapped/loss
  await db.registeredAsset.update({
    where: { id: registeredAssetId },
    data: {
      status: 'DISPOSED',
      condition: method === 'LOSS_THEFT' ? 'DAMAGED' : method === 'SCRAP' ? 'DAMAGED' : asset.condition,
      updatedAt: new Date(),
    },
  })

  // Close active responsibilities
  await db.assetResponsibility.updateMany({
    where: { registeredAssetId, effectiveTo: null },
    data: { effectiveTo: new Date() },
  })

  const disposalPayload = {
    registeredAssetId,
    assetCode: asset.assetCode,
    name: asset.name,
    method,
    reason: reason.trim(),
    salePrice: salePrice ? String(salePrice) : null,
    buyerOrRecipient: buyerOrRecipient ? String(buyerOrRecipient).trim() : null,
    documentRef: documentRef ? String(documentRef).trim() : null,
    evidenceFileAssetId: evidenceFileAssetId || null,
    disposedByPersonId: viewer?.personId || null,
    disposedAt: new Date().toISOString(),
  }

  await recordAudit(db, {
    entityType: 'REGISTERED_ASSET',
    entityId: registeredAssetId,
    action: 'ASSET_DISPOSED',
    payloadJson: JSON.stringify(disposalPayload),
    actorId: viewer?.personId || 'SYSTEM',
  })

  return disposalPayload
}

/**
 * List disposal records / audit events for a registered asset.
 */
export async function listAssetDisposalLogs({
  businessId,
  registeredAssetId = null,
  db = prisma,
} = {}) {
  if (!businessId) throw dispError('Business ID is required', 400)

  const where = {
    entityType: 'REGISTERED_ASSET',
    action: 'ASSET_DISPOSED',
  }

  if (registeredAssetId) {
    where.entityId = registeredAssetId
  }

  const events = await db.auditEvent.findMany({
    where,
    orderBy: { occurredAt: 'desc' },
    take: 50,
  })

  return events.map((event) => {
    let payload = {}
    try {
      payload = JSON.parse(event.payloadJson || '{}')
    } catch {
      // Ignore JSON parse error
    }

    return {
      id: event.id,
      registeredAssetId: event.entityId,
      action: event.action,
      occurredAt: event.occurredAt,
      actorId: event.actorId,
      ...payload,
    }
  })
}
