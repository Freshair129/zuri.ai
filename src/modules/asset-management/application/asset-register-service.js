// @req FR-133, FR-135 — physical asset register authority and temporal lifecycle queries.
// @spec SDD-078, SDD-080, BR-023, SEC-023, ADR-055
// @tested tests/unit/asset-register-service.test.js
import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { assertAssetIntakeWrite } from './asset-authority'

function registerError(message, status = 400) {
  const error = new Error(message)
  error.status = status
  return error
}

/**
 * Generate a sequential, Business-scoped Asset Code: AST-YYYY-XXXXX
 */
export async function generateNextAssetCode(businessId, { db = prisma, year = new Date().getFullYear() } = {}) {
  const prefix = `AST-${year}-`
  const lastAsset = await db.registeredAsset.findFirst({
    where: {
      businessId,
      assetCode: { startsWith: prefix },
    },
    orderBy: { assetCode: 'desc' },
    select: { assetCode: true },
  })

  let sequence = 1
  if (lastAsset?.assetCode) {
    const lastSeqStr = lastAsset.assetCode.replace(prefix, '')
    const parsed = parseInt(lastSeqStr, 10)
    if (!isNaN(parsed)) {
      sequence = parsed + 1
    }
  }

  return `${prefix}${String(sequence).padStart(5, '0')}`
}

/**
 * List registered assets with active responsibility, current location, project allocation, and lot metadata.
 */
export async function listRegisteredAssets({
  businessId,
  search = '',
  categoryCode = '',
  status = '',
  branchId = '',
  limit = 50,
  cursor = null,
  db = prisma,
} = {}) {
  if (!businessId) throw registerError('Business ID is required', 400)

  const where = {
    businessId,
    deletedAt: null,
  }

  if (categoryCode) {
    where.categoryCode = categoryCode
  }

  if (status) {
    where.status = status
  }

  if (branchId) {
    where.locations = {
      some: {
        branchId,
        effectiveTo: null,
      },
    }
  }

  if (search && search.trim()) {
    const term = search.trim()
    where.OR = [
      { assetCode: { contains: term } },
      { name: { contains: term } },
      { serialNumber: { contains: term } },
      { brand: { contains: term } },
      { model: { contains: term } },
    ]
  }

  const take = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100)
  const queryArgs = {
    where,
    take: take + 1,
    orderBy: [{ registeredAt: 'desc' }, { createdAt: 'desc' }],
    include: {
      lot: { select: { id: true, lotCode: true, expiresOn: true, status: true } },
      responsibilities: {
        where: { effectiveTo: null },
        include: {
          person: { select: { id: true, displayName: true, email: true } },
        },
      },
      locations: {
        where: { effectiveTo: null },
        include: {
          branch: { select: { id: true, code: true, name: true } },
        },
      },
      projectAllocations: {
        where: { effectiveTo: null },
        include: {
          project: { select: { id: true, code: true, name: true } },
          workstream: { select: { id: true, name: true } },
        },
      },
      _count: {
        select: {
          evidence: true,
          procurementRefs: true,
          depreciationCandidates: true,
        },
      },
    },
  }

  if (cursor) {
    queryArgs.cursor = { id: cursor }
    queryArgs.skip = 1
  }

  const rows = await db.registeredAsset.findMany(queryArgs)
  let nextCursor = null
  if (rows.length > take) {
    const nextItem = rows.pop()
    nextCursor = nextItem.id
  }

  // Format active pointers for consumption
  const items = rows.map((asset) => {
    const accountable = asset.responsibilities.find((r) => r.role === 'ACCOUNTABLE')
    const custodian = asset.responsibilities.find((r) => r.role === 'CUSTODIAN')
    const users = asset.responsibilities.filter((r) => r.role === 'USER')
    const primaryLocation = asset.locations.find((l) => l.isPrimary) || asset.locations[0] || null
    const activeAllocation = asset.projectAllocations[0] || null

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
      createdAt: asset.createdAt,
      accountablePerson: accountable?.person || null,
      custodianPerson: custodian?.person || null,
      actualUsers: users.map((u) => u.person),
      currentLocation: primaryLocation
        ? {
            locationCode: primaryLocation.locationCode,
            locationName: primaryLocation.locationName,
            branch: primaryLocation.branch,
          }
        : null,
      currentProjectAllocation: activeAllocation
        ? {
            project: activeAllocation.project,
            workstream: activeAllocation.workstream,
            effectiveFrom: activeAllocation.effectiveFrom,
          }
        : null,
      lot: asset.lot,
      counts: asset._count,
    }
  })

  // Aggregate stats
  const totalCount = await db.registeredAsset.count({ where: { businessId, deletedAt: null } })
  const activeCount = await db.registeredAsset.count({ where: { businessId, status: 'ACTIVE', deletedAt: null } })
  const inUseCount = await db.registeredAsset.count({ where: { businessId, status: 'IN_USE', deletedAt: null } })
  const maintenanceCount = await db.registeredAsset.count({ where: { businessId, status: 'MAINTENANCE', deletedAt: null } })

  return {
    items,
    nextCursor,
    stats: {
      total: totalCount,
      active: activeCount,
      inUse: inUseCount,
      maintenance: maintenanceCount,
    },
  }
}

/**
 * Get full registered asset detail including complete temporal histories.
 */
export async function getRegisteredAssetById({ businessId, id, db = prisma } = {}) {
  if (!businessId || !id) throw registerError('Business ID and Asset ID are required', 400)

  const asset = await db.registeredAsset.findFirst({
    where: { id, businessId, deletedAt: null },
    include: {
      lot: true,
      intake: {
        select: {
          id: true,
          intakeCode: true,
          sourceChannel: true,
          origin: true,
          submittedAt: true,
          approvedAt: true,
        },
      },
      evidence: {
        include: {
          fileAsset: {
            select: {
              id: true,
              filename: true,
              mimeType: true,
              sizeBytes: true,
              sha256: true,
            },
          },
        },
      },
      procurementRefs: true,
      responsibilities: {
        orderBy: [{ effectiveTo: 'asc' }, { effectiveFrom: 'desc' }],
        include: {
          person: { select: { id: true, displayName: true, email: true } },
        },
      },
      locations: {
        orderBy: [{ effectiveTo: 'asc' }, { effectiveFrom: 'desc' }],
        include: {
          branch: { select: { id: true, code: true, name: true } },
        },
      },
      projectAllocations: {
        orderBy: [{ effectiveTo: 'asc' }, { effectiveFrom: 'desc' }],
        include: {
          project: { select: { id: true, code: true, name: true } },
          workstream: { select: { id: true, name: true } },
        },
      },
      depreciationCandidates: {
        orderBy: { createdAt: 'desc' },
      },
    },
  })

  if (!asset) throw registerError('Registered asset not found', 404)

  return asset
}

/**
 * Transactionally promote an AssetIntake in READY_FOR_REGISTRATION to a RegisteredAsset.
 */
export async function registerAssetFromIntake({
  businessId,
  intakeId,
  customAssetCode = null,
  viewer,
  db = prisma,
} = {}) {
  assertAssetIntakeWrite(viewer, businessId)
  if (!businessId || !intakeId) throw registerError('Business ID and Intake ID are required', 400)

  const intake = await db.assetIntake.findFirst({
    where: { id: intakeId, businessId, deletedAt: null },
    include: {
      evidence: true,
      procurementRefs: true,
    },
  })

  if (!intake) throw registerError('Asset intake not found', 404)
  if (intake.status !== 'READY_FOR_REGISTRATION') {
    throw registerError(`Asset intake is not ready for registration (current status: ${intake.status})`, 400)
  }

  // Parse envelope for item details
  let envelope = {}
  try {
    envelope = JSON.parse(intake.normalizedEnvelopeJson || '{}')
  } catch {
    throw registerError('Corrupted normalized envelope', 500)
  }

  const item = envelope.item || {}
  const location = envelope.location || null
  const responsibility = envelope.responsibility || null
  const financial = envelope.financial || null
  const now = new Date()

  return await db.$transaction(async (tx) => {
    // Generate or validate asset code
    let assetCode = customAssetCode?.trim()
    if (!assetCode) {
      assetCode = await generateNextAssetCode(businessId, { db: tx })
    } else {
      const existing = await tx.registeredAsset.findUnique({
        where: { businessId_assetCode: { businessId, assetCode } },
      })
      if (existing) throw registerError(`Asset code "${assetCode}" already exists in this Business`, 409)
    }

    // Create RegisteredAsset
    const registeredAsset = await tx.registeredAsset.create({
      data: {
        tenantId: intake.tenantId,
        businessId: intake.businessId,
        intakeId: intake.id,
        assetCode,
        name: item.name || 'Untitled Asset',
        categoryCode: item.categoryCode || 'GENERAL',
        description: item.description || null,
        brand: item.brand || null,
        model: item.model || null,
        serialNumber: item.serialNumber || null,
        status: 'ACTIVE',
        condition: item.condition || 'GOOD',
        acquisitionAmount: financial?.acquisitionAmount || null,
        currency: financial?.currency || 'THB',
        receivedOn: financial?.receivedOn ? new Date(financial.receivedOn) : now,
        registeredAt: now,
      },
    })

    // Link evidence to registeredAsset
    if (intake.evidence.length > 0) {
      await tx.assetEvidence.updateMany({
        where: { intakeId: intake.id },
        data: { registeredAssetId: registeredAsset.id },
      })
    }

    // Link procurement refs to registeredAsset
    if (intake.procurementRefs.length > 0) {
      await tx.assetProcurementRef.updateMany({
        where: { intakeId: intake.id },
        data: { registeredAssetId: registeredAsset.id },
      })
    }

    // Create initial location history if provided
    if (location?.locationCode || location?.branchId) {
      await tx.assetLocationHistory.create({
        data: {
          tenantId: intake.tenantId,
          businessId: intake.businessId,
          registeredAssetId: registeredAsset.id,
          branchId: location.branchId || null,
          locationCode: location.locationCode || 'DEFAULT',
          locationName: location.locationName || 'Main Location',
          isPrimary: true,
          effectiveFrom: now,
        },
      })
    }

    // Create initial responsibilities if provided
    if (responsibility?.accountablePersonId) {
      await tx.assetResponsibility.create({
        data: {
          tenantId: intake.tenantId,
          businessId: intake.businessId,
          registeredAssetId: registeredAsset.id,
          role: 'ACCOUNTABLE',
          personId: responsibility.accountablePersonId,
          effectiveFrom: now,
        },
      })
    }

    if (responsibility?.custodianPersonId && responsibility.custodianPersonId !== responsibility.accountablePersonId) {
      await tx.assetResponsibility.create({
        data: {
          tenantId: intake.tenantId,
          businessId: intake.businessId,
          registeredAssetId: registeredAsset.id,
          role: 'CUSTODIAN',
          personId: responsibility.custodianPersonId,
          effectiveFrom: now,
        },
      })
    }

    // Update intake status to REGISTERED
    await tx.assetIntake.update({
      where: { id: intake.id },
      data: {
        status: 'REGISTERED',
        approvedByPersonId: viewer?.principal?.id || null,
        approvedAt: now,
      },
    })

    // Record Audit Event
    await recordAudit(tx, {
      entityType: 'REGISTERED_ASSET',
      entityId: registeredAsset.id,
      action: 'ASSET_REGISTERED',
      actorId: viewer?.principal?.id || 'system',
      payload: {
        assetCode: registeredAsset.assetCode,
        intakeId: intake.id,
        categoryCode: registeredAsset.categoryCode,
        name: registeredAsset.name,
      },
    })

    return registeredAsset
  })
}
