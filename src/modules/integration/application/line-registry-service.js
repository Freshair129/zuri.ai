// @req FR-080 — Platform Integration metadata management for LINE channels and contacts
// @spec ADR-032, SEC-016, SDD-044
// @tested tests/unit/line-registry-service.test.js

import { z } from 'zod'
import prisma from '@/lib/db'
import { ownsBusiness } from '@/modules/identity/viewer-authority'
import { recordAudit } from '@/modules/project-manager/application/audit'

export const LINE_REGISTRY_TYPES = Object.freeze({
  GROUP: 'LINE_GROUP',
  USER: 'LINE_USER',
})

const zAutomationJob = z.object({
  jobId: z.string().default(() => `job-${Date.now()}`),
  name: z.string().min(1),
  schedule: z.string().min(1), // e.g. "0 9 * * *"
  action: z.string().min(1),   // e.g. "PUSH_DAILY_SALES_REPORT"
  template: z.string().optional(),
  enabled: z.boolean().default(true),
})

const zSaveLineGroup = z.object({
  businessId: z.string().min(1),
  name: z.string().min(1),
  groupId: z.string().startsWith('C', 'LINE Group ID must start with C'),
  groupUrl: z.string().url().or(z.literal('')).optional(),
  departmentType: z.enum(['SALES_TEAM', 'EXECUTIVE', 'OPERATIONS', 'SUPPORT', 'GENERAL']).default('GENERAL'),
  status: z.enum(['ACTIVE', 'PAUSED', 'DRAFT']).default('ACTIVE'),
  automationJobs: z.array(zAutomationJob).default([]),
})

const zSaveLineUser = z.object({
  businessId: z.string().min(1),
  displayName: z.string().min(1),
  userId: z.string().startsWith('U', 'LINE User ID must start with U'),
  role: z.string().min(1).default('MEMBER'),
  department: z.string().optional(),
  personId: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  personalAlerts: z.array(z.string()).default([]),
})

function assertScope(viewer, businessId) {
  if (viewer?.isPlatformDev || viewer?.isLocalDev) return
  if (!ownsBusiness(viewer, businessId)) {
    const error = new Error('Access denied: outside owned business scope')
    error.status = 403
    throw error
  }
}

/**
 * List registered LINE groups and users.
 */
export async function listLineRegistry({ businessId, type = 'ALL', resolve } = {}) {
  const viewer = await resolve()
  if (businessId) assertScope(viewer, businessId)

  const where = {
    provider: { code: 'line-oa' },
    ...(businessId ? { businessId } : {}),
  }

  const connections = await prisma.integrationConnection.findMany({
    where,
    include: {
      tenant: { select: { id: true, name: true, code: true } },
      business: { select: { id: true, name: true, code: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const items = connections.map((conn) => {
    let meta = {}
    try {
      meta = JSON.parse(conn.metadataJson || '{}')
    } catch {
      meta = {}
    }
    return {
      id: conn.id,
      tenantId: conn.tenantId,
      tenantCode: conn.tenant?.code,
      tenantName: conn.tenant?.name,
      businessId: conn.businessId,
      businessCode: conn.business?.code,
      businessName: conn.business?.name,
      name: conn.name,
      purpose: conn.purpose,
      role: conn.role,
      status: conn.status,
      externalAccountId: conn.externalAccountId,
      kind: conn.purpose === LINE_REGISTRY_TYPES.USER ? 'USER' : 'GROUP',
      metadata: meta,
      createdAt: conn.createdAt,
      updatedAt: conn.updatedAt,
    }
  })

  if (type === 'GROUP') {
    return items.filter((it) => it.kind === 'GROUP')
  }
  if (type === 'USER') {
    return items.filter((it) => it.kind === 'USER')
  }
  return items
}

/**
 * Register or update a LINE Group.
 */
export async function saveLineGroup(payload, { resolve, now = new Date() } = {}) {
  const viewer = await resolve()
  const validated = zSaveLineGroup.parse(payload)
  assertScope(viewer, validated.businessId)

  // Find or create the line-oa provider
  const provider = await prisma.integrationProvider.upsert({
    where: { code: 'line-oa' },
    update: {},
    create: {
      code: 'line-oa',
      name: 'LINE Official Account',
      category: 'CHANNEL',
      authType: 'SECRET_MANAGER',
    },
  })

  const tenant = await prisma.business.findUnique({
    where: { id: validated.businessId },
    select: { tenantId: true },
  })
  if (!tenant) throw new Error('Business not found')

  const metadata = {
    groupName: validated.name,
    groupId: validated.groupId,
    groupUrl: validated.groupUrl || null,
    departmentType: validated.departmentType,
    automationJobs: validated.automationJobs,
  }

  const existing = await prisma.integrationConnection.findFirst({
    where: {
      tenantId: tenant.tenantId,
      providerId: provider.id,
      externalAccountId: validated.groupId,
    },
  })

  let result
  if (existing) {
    result = await prisma.integrationConnection.update({
      where: { id: existing.id },
      data: {
        name: validated.name,
        businessId: validated.businessId,
        status: validated.status,
        purpose: LINE_REGISTRY_TYPES.GROUP,
        metadataJson: JSON.stringify(metadata),
        updatedAt: now,
      },
    })
  } else {
    result = await prisma.integrationConnection.create({
      data: {
        tenantId: tenant.tenantId,
        businessId: validated.businessId,
        providerId: provider.id,
        name: validated.name,
        externalAccountId: validated.groupId,
        purpose: LINE_REGISTRY_TYPES.GROUP,
        role: 'SECONDARY',
        status: validated.status,
        metadataJson: JSON.stringify(metadata),
        createdAt: now,
        updatedAt: now,
      },
    })
  }

  await recordAudit({
    tenantId: tenant.tenantId,
    businessId: validated.businessId,
    actorId: viewer.personId || viewer.id,
    action: existing ? 'UPDATE_LINE_GROUP' : 'CREATE_LINE_GROUP',
    entityType: 'IntegrationConnection',
    entityId: result.id,
    changes: { name: validated.name, groupId: validated.groupId, departmentType: validated.departmentType },
    now,
  }).catch(() => {})

  return { ok: true, connection: result, metadata }
}

/**
 * Register or update a LINE User.
 */
export async function saveLineUser(payload, { resolve, now = new Date() } = {}) {
  const viewer = await resolve()
  const validated = zSaveLineUser.parse(payload)
  assertScope(viewer, validated.businessId)

  const provider = await prisma.integrationProvider.upsert({
    where: { code: 'line-oa' },
    update: {},
    create: {
      code: 'line-oa',
      name: 'LINE Official Account',
      category: 'CHANNEL',
      authType: 'SECRET_MANAGER',
    },
  })

  const tenant = await prisma.business.findUnique({
    where: { id: validated.businessId },
    select: { tenantId: true },
  })
  if (!tenant) throw new Error('Business not found')

  const metadata = {
    displayName: validated.displayName,
    userId: validated.userId,
    role: validated.role,
    department: validated.department || null,
    personId: validated.personId || null,
    personalAlerts: validated.personalAlerts,
  }

  const existing = await prisma.integrationConnection.findFirst({
    where: {
      tenantId: tenant.tenantId,
      providerId: provider.id,
      externalAccountId: validated.userId,
    },
  })

  let result
  if (existing) {
    result = await prisma.integrationConnection.update({
      where: { id: existing.id },
      data: {
        name: validated.displayName,
        businessId: validated.businessId,
        status: validated.status,
        purpose: LINE_REGISTRY_TYPES.USER,
        metadataJson: JSON.stringify(metadata),
        updatedAt: now,
      },
    })
  } else {
    result = await prisma.integrationConnection.create({
      data: {
        tenantId: tenant.tenantId,
        businessId: validated.businessId,
        providerId: provider.id,
        name: validated.displayName,
        externalAccountId: validated.userId,
        purpose: LINE_REGISTRY_TYPES.USER,
        role: 'SECONDARY',
        status: validated.status,
        metadataJson: JSON.stringify(metadata),
        createdAt: now,
        updatedAt: now,
      },
    })
  }

  await recordAudit({
    tenantId: tenant.tenantId,
    businessId: validated.businessId,
    actorId: viewer.personId || viewer.id,
    action: existing ? 'UPDATE_LINE_USER' : 'CREATE_LINE_USER',
    entityType: 'IntegrationConnection',
    entityId: result.id,
    changes: { displayName: validated.displayName, userId: validated.userId },
    now,
  }).catch(() => {})

  return { ok: true, connection: result, metadata }
}
