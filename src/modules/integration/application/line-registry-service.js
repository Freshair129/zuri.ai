// @req FR-080 — Platform Integration metadata management for LINE channels and contacts
// @spec ADR-032, SEC-016, SDD-044, SEC-001, BR-002
// @tested tests/unit/line-registry-service.test.js, tests/integration/line-registry-scope.test.js

import { z } from 'zod'
import prisma from '@/lib/db'
import { ownsBusiness } from '@/modules/identity/viewer-authority'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'

export const LINE_REGISTRY_TYPES = Object.freeze({
  GROUP: 'LINE_GROUP',
  USER: 'LINE_USER',
})

const LINE_REGISTRY_PURPOSES = Object.freeze([LINE_REGISTRY_TYPES.GROUP, LINE_REGISTRY_TYPES.USER])

// The registry used to upsert its own lowercase `line-oa` provider row while
// the rest of the lane addressed the same channel as `LINE_OA` — two
// identities for one provider, which is exactly what BR-002 forbids. Writes
// were fixed to use the shared constant; reads used to keep tolerating the
// legacy code so rows written before that fix stayed visible.
//
// That tolerance is gone. The merge was applied to production (the ledger in
// docs/runbooks/line-oa-provider-merge.md records it) and
// scripts/migrate-line-oa-provider.mjs re-points any developer SQLite database
// still holding a legacy row, so no row can carry the legacy code from here
// on — reads and the de-dupe lookup below use only `LINE_OA_PROVIDER_CODE`.

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

/**
 * The only authority this service asks about, at every entry point.
 *
 * There used to be an `isPlatformDev || isLocalDev` escape hatch here. Neither
 * field is produced by `resolveViewer` — nor constructible through
 * `tests/factories/viewer.js` — so it granted nothing to any real viewer and
 * only made the guard look conditional. Removed rather than rebound: a DEV
 * grant is cross-tenant *visibility*, never per-Business write authority
 * (.brain/rca/2026-08-16-global-role-is-not-per-business-authority.md).
 *
 * 404 rather than 403, matching `integration-management-service`: a Business a
 * viewer does not own is a Business they are not told exists.
 */
function assertOwned(viewer, businessId) {
  if (!ownsBusiness(viewer, businessId)) {
    const error = new Error('LINE registry entry is outside your owned scope')
    error.status = 404
    throw error
  }
}

function ownedBusinessIdsOf(viewer) {
  return Array.isArray(viewer?.ownedBusinessIds) ? viewer.ownedBusinessIds.filter(Boolean) : []
}

function actorOf(viewer) {
  return viewer?.principal?.id ?? null
}

function safeMeta(json) {
  try {
    const parsed = JSON.parse(json || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * List registered LINE groups and users.
 *
 * Always scoped to the Businesses this viewer OWNS. The unscoped read used to
 * skip its scope check entirely and build a `where` with no tenant or business
 * predicate, so any signed-in viewer could read every tenant's LINE group and
 * user ids (D3-integration-knowledge-document-intake-14 / D4-connector-governance-13).
 */
export async function listLineRegistry({ businessId, type = 'ALL', resolve, db = prisma } = {}) {
  const viewer = await resolve()
  if (businessId) assertOwned(viewer, businessId)

  const scopedBusinessIds = businessId ? [businessId] : ownedBusinessIdsOf(viewer)
  if (scopedBusinessIds.length === 0) return []

  const connections = await db.integrationConnection.findMany({
    where: {
      businessId: { in: scopedBusinessIds },
      provider: { code: LINE_OA_PROVIDER_CODE },
      // Registry rows only. Without this the switch to the shared provider code
      // would drag the LINE_OA *channel* connection (FR-081) into a listing that
      // is about groups and contacts.
      purpose: { in: [...LINE_REGISTRY_PURPOSES] },
    },
    include: {
      tenant: { select: { id: true, name: true, code: true } },
      business: { select: { id: true, name: true, code: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const items = connections.map((conn) => ({
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
    metadata: safeMeta(conn.metadataJson),
    createdAt: conn.createdAt,
    updatedAt: conn.updatedAt,
  }))

  if (type === 'GROUP') return items.filter((it) => it.kind === 'GROUP')
  if (type === 'USER') return items.filter((it) => it.kind === 'USER')
  return items
}

/** The provider row every registry write binds to, addressed by the shared code. */
async function ensureLineProvider(tx) {
  return tx.integrationProvider.upsert({
    where: { code: LINE_OA_PROVIDER_CODE },
    update: {},
    create: {
      code: LINE_OA_PROVIDER_CODE,
      name: 'LINE Official Account',
      status: 'ACTIVE',
    },
  })
}

/**
 * The de-dupe lookup. Keyed on the tenant and the LINE id, under the shared
 * provider code only — a row still carrying the retired legacy code is not
 * treated as the same registration; scripts/migrate-line-oa-provider.mjs is
 * the path for re-pointing such a row on a developer SQLite database.
 */
async function findExistingRegistration(tx, { tenantId, externalAccountId }) {
  return tx.integrationConnection.findFirst({
    where: {
      tenantId,
      externalAccountId,
      provider: { code: LINE_OA_PROVIDER_CODE },
      purpose: { in: [...LINE_REGISTRY_PURPOSES] },
    },
  })
}

/**
 * A registration belongs to the Business it was made under. An owner of another
 * Business in the same Tenant may not silently re-point it at themselves — the
 * lookup was tenant-scoped and the update rewrote `businessId`, which is a
 * cross-Business ownership takeover (D2-domain-integration-verifier-29).
 */
function assertSameBusiness(existing, businessId) {
  if (existing && existing.businessId && existing.businessId !== businessId) {
    const error = new Error('LINE_REGISTRATION_BELONGS_TO_ANOTHER_BUSINESS')
    error.status = 409
    throw error
  }
}

async function loadBusinessTenant(tx, businessId) {
  const business = await tx.business.findUnique({
    where: { id: businessId },
    select: { tenantId: true },
  })
  if (!business) {
    const error = new Error('Business not found')
    error.status = 404
    throw error
  }
  return business.tenantId
}

/**
 * Register or update a LINE Group.
 */
export async function saveLineGroup(payload, { resolve, now = new Date(), db = prisma } = {}) {
  const viewer = await resolve()
  const validated = zSaveLineGroup.parse(payload)
  assertOwned(viewer, validated.businessId)

  const metadata = {
    groupName: validated.name,
    groupId: validated.groupId,
    groupUrl: validated.groupUrl || null,
    departmentType: validated.departmentType,
    automationJobs: validated.automationJobs,
  }

  // Lookup, write and audit in one transaction: the de-dupe decision and the row
  // it writes must not be separated by another writer, and an audit event that
  // can be lost is not an audit event (SEC-003).
  const { connection, created } = await db.$transaction(async (tx) => {
    const tenantId = await loadBusinessTenant(tx, validated.businessId)
    const provider = await ensureLineProvider(tx)
    const existing = await findExistingRegistration(tx, {
      tenantId,
      externalAccountId: validated.groupId,
    })
    assertSameBusiness(existing, validated.businessId)

    const row = existing
      ? await tx.integrationConnection.update({
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
      : await tx.integrationConnection.create({
          data: {
            tenantId,
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

    await recordAudit(tx, {
      entityType: 'IntegrationConnection',
      entityId: row.id,
      action: existing ? 'UPDATE_LINE_GROUP' : 'CREATE_LINE_GROUP',
      actorId: actorOf(viewer),
      payload: {
        tenantId,
        businessId: validated.businessId,
        name: validated.name,
        groupId: validated.groupId,
        departmentType: validated.departmentType,
        status: validated.status,
      },
    })

    return { connection: row, created: !existing }
  })

  return { ok: true, connection, created, metadata }
}

/**
 * Register or update a LINE User.
 */
export async function saveLineUser(payload, { resolve, now = new Date(), db = prisma } = {}) {
  const viewer = await resolve()
  const validated = zSaveLineUser.parse(payload)
  assertOwned(viewer, validated.businessId)

  const metadata = {
    displayName: validated.displayName,
    userId: validated.userId,
    role: validated.role,
    department: validated.department || null,
    personId: validated.personId || null,
    personalAlerts: validated.personalAlerts,
  }

  const { connection, created } = await db.$transaction(async (tx) => {
    const tenantId = await loadBusinessTenant(tx, validated.businessId)
    const provider = await ensureLineProvider(tx)
    const existing = await findExistingRegistration(tx, {
      tenantId,
      externalAccountId: validated.userId,
    })
    assertSameBusiness(existing, validated.businessId)

    const row = existing
      ? await tx.integrationConnection.update({
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
      : await tx.integrationConnection.create({
          data: {
            tenantId,
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

    await recordAudit(tx, {
      entityType: 'IntegrationConnection',
      entityId: row.id,
      action: existing ? 'UPDATE_LINE_USER' : 'CREATE_LINE_USER',
      actorId: actorOf(viewer),
      payload: {
        tenantId,
        businessId: validated.businessId,
        displayName: validated.displayName,
        userId: validated.userId,
        role: validated.role,
        status: validated.status,
      },
    })

    return { connection: row, created: !existing }
  })

  return { ok: true, connection, created, metadata }
}
