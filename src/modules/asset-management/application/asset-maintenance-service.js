// @req FR-133, FR-135 — Preventive maintenance, repair ticketing, and service history (AM-RQ-050..AM-RQ-053).
// @spec SDD-078, SDD-080, BR-023, SEC-023, ADR-055
// @tested tests/unit/asset-maintenance-service.test.js
import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'

function maintError(message, status = 400) {
  const error = new Error(message)
  error.status = status
  return error
}

/**
 * Log a new maintenance request or repair ticket for a registered asset.
 * Transitions asset status to `MAINTENANCE`.
 */
export async function createMaintenanceLog({
  businessId,
  registeredAssetId,
  title,
  issueDescription = '',
  priority = 'NORMAL', // 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
  serviceProvider = '',
  estimatedCost = null,
  scheduledDate = null,
  viewer,
  db = prisma,
} = {}) {
  if (!businessId) throw maintError('Business ID is required', 400)
  if (!registeredAssetId) throw maintError('Registered Asset ID is required', 400)
  if (!title || !title.trim()) throw maintError('Maintenance title/reason is required', 400)

  const asset = await db.registeredAsset.findFirst({
    where: { id: registeredAssetId, businessId, deletedAt: null },
  })

  if (!asset) {
    throw maintError('Registered asset not found in business scope', 404)
  }

  // Update asset status to MAINTENANCE
  await db.registeredAsset.update({
    where: { id: registeredAssetId },
    data: {
      status: 'MAINTENANCE',
      condition: priority === 'URGENT' ? 'DAMAGED' : 'POOR',
      updatedAt: new Date(),
    },
  })

  const maintenancePayload = {
    registeredAssetId,
    assetCode: asset.assetCode,
    title: title.trim(),
    issueDescription: issueDescription.trim(),
    priority,
    serviceProvider: serviceProvider.trim() || null,
    estimatedCost: estimatedCost ? String(estimatedCost) : null,
    scheduledDate: scheduledDate || new Date().toISOString().slice(0, 10),
    status: 'OPEN',
    loggedByPersonId: viewer?.personId || null,
    loggedAt: new Date().toISOString(),
  }

  await recordAudit(db, {
    entityType: 'REGISTERED_ASSET',
    entityId: registeredAssetId,
    action: 'ASSET_MAINTENANCE_LOGGED',
    payloadJson: JSON.stringify(maintenancePayload),
    actorId: viewer?.personId || 'SYSTEM',
  })

  return maintenancePayload
}

/**
 * Complete a maintenance ticket, record resolution, parts/cost, and revert asset status to ACTIVE.
 */
export async function completeMaintenanceLog({
  businessId,
  registeredAssetId,
  resolutionNotes = '',
  actualCost = null,
  newCondition = 'GOOD',
  completedDate = null,
  invoiceRef = '',
  viewer,
  db = prisma,
} = {}) {
  if (!businessId) throw maintError('Business ID is required', 400)
  if (!registeredAssetId) throw maintError('Registered Asset ID is required', 400)

  const asset = await db.registeredAsset.findFirst({
    where: { id: registeredAssetId, businessId, deletedAt: null },
    include: {
      projectAllocations: {
        where: { effectiveTo: null, status: 'ACTIVE' },
      },
    },
  })

  if (!asset) {
    throw maintError('Registered asset not found in business scope', 404)
  }

  // Check if asset still has an active project allocation
  const hasActiveAllocation = asset.projectAllocations.length > 0
  const nextStatus = hasActiveAllocation ? 'IN_USE' : 'ACTIVE'

  await db.registeredAsset.update({
    where: { id: registeredAssetId },
    data: {
      status: nextStatus,
      condition: newCondition || 'GOOD',
      updatedAt: new Date(),
    },
  })

  const completionPayload = {
    registeredAssetId,
    assetCode: asset.assetCode,
    resolutionNotes: resolutionNotes.trim(),
    actualCost: actualCost ? String(actualCost) : null,
    newCondition: newCondition || 'GOOD',
    completedDate: completedDate || new Date().toISOString().slice(0, 10),
    invoiceRef: invoiceRef.trim() || null,
    revertedStatus: nextStatus,
    completedByPersonId: viewer?.personId || null,
    completedAt: new Date().toISOString(),
  }

  await recordAudit(db, {
    entityType: 'REGISTERED_ASSET',
    entityId: registeredAssetId,
    action: 'ASSET_MAINTENANCE_COMPLETED',
    payloadJson: JSON.stringify(completionPayload),
    actorId: viewer?.personId || 'SYSTEM',
  })

  return completionPayload
}

/**
 * List maintenance history logs for a registered asset.
 */
export async function listAssetMaintenanceLogs({
  businessId,
  registeredAssetId = null,
  db = prisma,
} = {}) {
  if (!businessId) throw maintError('Business ID is required', 400)

  const where = {
    entityType: 'REGISTERED_ASSET',
    action: {
      in: ['ASSET_MAINTENANCE_LOGGED', 'ASSET_MAINTENANCE_COMPLETED'],
    },
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
      // Ignore JSON parse errors
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
