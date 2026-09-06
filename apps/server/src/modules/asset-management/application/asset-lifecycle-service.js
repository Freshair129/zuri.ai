// @req FR-135 — temporal asset responsibility, location history, and project allocation.
// @spec SDD-080, BR-023, SEC-023, ADR-055
// @tested tests/unit/asset-lifecycle-service.test.js
import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { ASSET_RESPONSIBILITY_ROLES } from '@/lib/validation/enums'
import { assertAssetIntakeWrite } from './asset-authority'

function lifecycleError(message, status = 400) {
  const error = new Error(message)
  error.status = status
  return error
}

/**
 * Transfer custody or change responsibility for a registered asset.
 * Closes the active interval for the given role and opens a new one.
 */
export async function transferAssetResponsibility({
  registeredAssetId,
  businessId,
  role = 'CUSTODIAN',
  personId,
  orgUnitRef = null,
  orgUnitSystem = null,
  effectiveFrom = new Date(),
  note = '',
  viewer,
  db = prisma,
}) {
  if (!businessId || !registeredAssetId) {
    throw lifecycleError('businessId and registeredAssetId are required', 400)
  }
  if (!personId) {
    throw lifecycleError('personId is required for responsibility transfer', 400)
  }
  if (viewer) {
    assertAssetIntakeWrite(viewer, businessId)
  }

  const effectiveDate = new Date(effectiveFrom)
  if (isNaN(effectiveDate.getTime())) {
    throw lifecycleError('Invalid effectiveFrom date', 400)
  }

  if (!ASSET_RESPONSIBILITY_ROLES.includes(role)) {
    throw lifecycleError(`Invalid responsibility role: ${role}. Expected one of: ${ASSET_RESPONSIBILITY_ROLES.join(', ')}`, 400)
  }

  return db.$transaction(async (tx) => {
    const asset = await tx.registeredAsset.findFirst({
      where: { id: registeredAssetId, businessId, deletedAt: null },
    })
    if (!asset) {
      throw lifecycleError('Registered asset not found', 404)
    }

    const person = await tx.person.findFirst({
      where: { id: personId },
    })
    if (!person) {
      throw lifecycleError('Person not found', 404)
    }

    // Close any currently active responsibility for this asset + role
    await tx.assetResponsibility.updateMany({
      where: {
        registeredAssetId,
        businessId,
        role,
        effectiveTo: null,
      },
      data: {
        effectiveTo: effectiveDate,
      },
    })

    // Create the new responsibility interval
    const newResponsibility = await tx.assetResponsibility.create({
      data: {
        tenantId: asset.tenantId,
        businessId,
        registeredAssetId,
        role,
        personId,
        orgUnitRef: orgUnitRef || null,
        orgUnitSystem: orgUnitSystem || null,
        effectiveFrom: effectiveDate,
        effectiveTo: null,
      },
      include: {
        person: {
          select: { id: true, name: true, email: true },
        },
      },
    })

    await recordAudit(tx, {
      entityType: 'ASSET_RESPONSIBILITY',
      entityId: newResponsibility.id,
      action: 'TRANSFERRED',
      payload: {
        registeredAssetId,
        assetCode: asset.assetCode,
        role,
        personId,
        personName: person.name,
        orgUnitRef,
        note,
        effectiveFrom: effectiveDate.toISOString(),
      },
      actorId: viewer?.principal?.id || 'system',
    })

    return newResponsibility
  })
}

/**
 * Relocate a registered asset (change room, branch, or site).
 * Closes the active primary location interval and opens a new one.
 */
export async function relocateAsset({
  registeredAssetId,
  businessId,
  branchId = null,
  locationCode,
  locationName,
  isPrimary = true,
  effectiveFrom = new Date(),
  note = '',
  viewer,
  db = prisma,
}) {
  if (!businessId || !registeredAssetId) {
    throw lifecycleError('businessId and registeredAssetId are required', 400)
  }
  if (!locationCode || !locationName) {
    throw lifecycleError('locationCode and locationName are required', 400)
  }
  if (viewer) {
    assertAssetIntakeWrite(viewer, businessId)
  }

  const effectiveDate = new Date(effectiveFrom)
  if (isNaN(effectiveDate.getTime())) {
    throw lifecycleError('Invalid effectiveFrom date', 400)
  }

  return db.$transaction(async (tx) => {
    const asset = await tx.registeredAsset.findFirst({
      where: { id: registeredAssetId, businessId, deletedAt: null },
    })
    if (!asset) {
      throw lifecycleError('Registered asset not found', 404)
    }

    if (branchId) {
      const branch = await tx.branch.findFirst({
        where: { id: branchId, businessId },
      })
      if (!branch) {
        throw lifecycleError('Branch not found in current business', 404)
      }
    }

    // If setting a primary location, close any existing active primary locations
    if (isPrimary) {
      await tx.assetLocationHistory.updateMany({
        where: {
          registeredAssetId,
          businessId,
          isPrimary: true,
          effectiveTo: null,
        },
        data: {
          effectiveTo: effectiveDate,
        },
      })
    }

    const newLocation = await tx.assetLocationHistory.create({
      data: {
        tenantId: asset.tenantId,
        businessId,
        registeredAssetId,
        branchId: branchId || null,
        locationCode,
        locationName,
        isPrimary,
        effectiveFrom: effectiveDate,
        effectiveTo: null,
      },
      include: {
        branch: {
          select: { id: true, code: true, name: true },
        },
      },
    })

    await recordAudit(tx, {
      entityType: 'ASSET_LOCATION',
      entityId: newLocation.id,
      action: 'CHANGED',
      payload: {
        registeredAssetId,
        assetCode: asset.assetCode,
        branchId,
        locationCode,
        locationName,
        isPrimary,
        note,
        effectiveFrom: effectiveDate.toISOString(),
      },
      actorId: viewer?.principal?.id || 'system',
    })

    return newLocation
  })
}

/**
 * Allocate an asset to a Project or Workstream.
 */
export async function allocateAssetToProject({
  registeredAssetId,
  businessId,
  projectId,
  workstreamId = null,
  quantity = 1,
  exclusive = true,
  effectiveFrom = new Date(),
  purpose = '',
  viewer,
  db = prisma,
}) {
  if (!businessId || !registeredAssetId || !projectId) {
    throw lifecycleError('businessId, registeredAssetId, and projectId are required', 400)
  }
  if (viewer) {
    assertAssetIntakeWrite(viewer, businessId)
  }

  const effectiveDate = new Date(effectiveFrom)
  if (isNaN(effectiveDate.getTime())) {
    throw lifecycleError('Invalid effectiveFrom date', 400)
  }

  return db.$transaction(async (tx) => {
    const asset = await tx.registeredAsset.findFirst({
      where: { id: registeredAssetId, businessId, deletedAt: null },
    })
    if (!asset) {
      throw lifecycleError('Registered asset not found', 404)
    }

    // Verify project belongs to the same business
    const project = await tx.project.findFirst({
      where: {
        id: projectId,
        workspace: {
          businessId,
        },
      },
    })
    if (!project) {
      throw lifecycleError('Project not found in current business', 404)
    }

    // If exclusive allocation, check and close any active existing allocation
    if (exclusive) {
      await tx.assetProjectAllocation.updateMany({
        where: {
          registeredAssetId,
          businessId,
          status: 'ACTIVE',
          effectiveTo: null,
        },
        data: {
          status: 'REPLACED',
          effectiveTo: effectiveDate,
        },
      })
    }

    const allocation = await tx.assetProjectAllocation.create({
      data: {
        tenantId: asset.tenantId,
        businessId,
        registeredAssetId,
        projectId,
        workstreamId: workstreamId || null,
        quantity,
        exclusive,
        status: 'ACTIVE',
        effectiveFrom: effectiveDate,
        effectiveTo: null,
      },
      include: {
        registeredAsset: {
          select: { id: true, assetCode: true, name: true },
        },
      },
    })

    // Update RegisteredAsset status to IN_USE if currently ACTIVE
    if (asset.status === 'ACTIVE') {
      await tx.registeredAsset.update({
        where: { id: registeredAssetId },
        data: { status: 'IN_USE' },
      })
    }

    await recordAudit(tx, {
      entityType: 'ASSET_PROJECT_ALLOCATION',
      entityId: allocation.id,
      action: 'ALLOCATED',
      payload: {
        registeredAssetId,
        assetCode: asset.assetCode,
        projectId,
        projectTitle: project.title,
        workstreamId,
        quantity,
        exclusive,
        purpose,
        effectiveFrom: effectiveDate.toISOString(),
      },
      actorId: viewer?.principal?.id || 'system',
    })

    return allocation
  })
}

/**
 * Return an asset from a project allocation, recording the return condition.
 */
export async function returnAssetFromProject({
  allocationId,
  registeredAssetId,
  businessId,
  returnCondition = 'GOOD',
  effectiveTo = new Date(),
  note = '',
  viewer,
  db = prisma,
}) {
  if (!businessId || !registeredAssetId) {
    throw lifecycleError('businessId and registeredAssetId are required', 400)
  }
  if (viewer) {
    assertAssetIntakeWrite(viewer, businessId)
  }

  const returnDate = new Date(effectiveTo)
  if (isNaN(returnDate.getTime())) {
    throw lifecycleError('Invalid effectiveTo date', 400)
  }

  return db.$transaction(async (tx) => {
    const asset = await tx.registeredAsset.findFirst({
      where: { id: registeredAssetId, businessId, deletedAt: null },
    })
    if (!asset) {
      throw lifecycleError('Registered asset not found', 404)
    }

    // Find active allocation (either by allocationId or registeredAssetId)
    const where = {
      registeredAssetId,
      businessId,
      status: 'ACTIVE',
    }
    if (allocationId) {
      where.id = allocationId
    }

    const allocation = await tx.assetProjectAllocation.findFirst({
      where,
      orderBy: { effectiveFrom: 'desc' },
    })

    if (!allocation) {
      throw lifecycleError('Active project allocation not found for this asset', 404)
    }

    const updatedAllocation = await tx.assetProjectAllocation.update({
      where: { id: allocation.id },
      data: {
        status: 'RETURNED',
        effectiveTo: returnDate,
      },
    })

    // Check if there are other active allocations remaining
    const remainingActive = await tx.assetProjectAllocation.count({
      where: {
        registeredAssetId,
        businessId,
        status: 'ACTIVE',
        effectiveTo: null,
      },
    })

    // Update asset condition and revert status to ACTIVE if no active allocations remain
    const assetUpdateData = { condition: returnCondition }
    if (remainingActive === 0 && asset.status === 'IN_USE') {
      assetUpdateData.status = 'ACTIVE'
    }

    await tx.registeredAsset.update({
      where: { id: registeredAssetId },
      data: assetUpdateData,
    })

    await recordAudit(tx, {
      entityType: 'ASSET_PROJECT_ALLOCATION',
      entityId: updatedAllocation.id,
      action: 'RETURNED',
      payload: {
        registeredAssetId,
        assetCode: asset.assetCode,
        projectId: allocation.projectId,
        returnCondition,
        note,
        effectiveTo: returnDate.toISOString(),
      },
      actorId: viewer?.principal?.id || 'system',
    })

    return updatedAllocation
  })
}
