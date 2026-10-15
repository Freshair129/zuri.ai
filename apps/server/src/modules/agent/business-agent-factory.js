// @req FR-285 — persisted standard Business agent configuration. This module
// creates no provider, running agent, default fallback or dynamic delegation.
import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import {
  BUSINESS_AGENT_CONFIG_VERSION,
  BUSINESS_AGENT_DELEGATION_POLICY,
  BUSINESS_AGENT_SCHEMA_VERSION,
  BUSINESS_AGENT_TEMPLATE_ID,
  BUSINESS_AGENT_TEMPLATE_VERSION,
  buildBusinessAgentTemplate,
  businessAgentSnapshotDigest,
  canonicalJson,
  validateStoredBusinessAgentConfig,
} from './business-agent-template'

function failure(status, code) {
  const error = new Error(code)
  error.status = status
  error.code = code
  return error
}

function requireActor(viewer) {
  const actorId = viewer?.principal?.id
  if (typeof actorId !== 'string' || !actorId) throw failure(401, 'AUTH_REQUIRED')
  return actorId
}

async function authorizedTarget(db, businessId, viewer) {
  const actorId = requireActor(viewer)
  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { id: true, tenantId: true, status: true, tenant: { select: { status: true } } },
  })
  if (!business || business.status !== 'ACTIVE' || business.tenant?.status !== 'ACTIVE') {
    throw failure(404, 'BUSINESS_NOT_FOUND')
  }

  const now = new Date()
  const membership = await db.membership.findFirst({
    where: {
      personId: actorId,
      tenantId: business.tenantId,
      role: 'OWNER',
      status: 'ACTIVE',
      suspendedAt: null,
      revokedAt: null,
      AND: [
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        { OR: [
          { scopeType: 'BUSINESS', businessId: business.id },
          { scopeType: 'TENANT', businessId: null },
        ] },
      ],
    },
    select: { id: true },
  })
  // A caller-provided role or ownedBusinessIds never substitutes for this row.
  if (!membership) throw failure(404, 'BUSINESS_NOT_FOUND')
  return { business: { id: business.id, tenantId: business.tenantId }, actorId }
}

function templateScope(business) {
  return { tenantId: business.tenantId, businessId: business.id }
}

function storedConfig(row, business) {
  const snapshot = validateStoredBusinessAgentConfig(row, templateScope(business))
  return {
    schemaVersion: row.schemaVersion,
    templateId: row.templateId,
    templateVersion: row.templateVersion,
    configVersion: row.version,
    delegationPolicy: row.delegationPolicy,
    scope: snapshot.scope,
    roles: snapshot.roles,
    snapshotDigest: row.snapshotDigest,
    appliedByPersonId: row.appliedByPersonId,
    appliedAt: row.appliedAt,
  }
}

async function createConfigAndAudit(tx, { business, actorId }) {
  if (!business?.id || !business?.tenantId || !actorId) {
    throw failure(500, 'BUSINESS_AGENT_PROVISIONING_CONTEXT_INVALID')
  }
  const snapshot = buildBusinessAgentTemplate({ tenantId: business.tenantId, businessId: business.id })
  const snapshotDigest = businessAgentSnapshotDigest(snapshot)
  const row = await tx.businessAgentConfig.create({
    data: {
      tenantId: business.tenantId,
      businessId: business.id,
      schemaVersion: BUSINESS_AGENT_SCHEMA_VERSION,
      templateId: BUSINESS_AGENT_TEMPLATE_ID,
      templateVersion: BUSINESS_AGENT_TEMPLATE_VERSION,
      version: BUSINESS_AGENT_CONFIG_VERSION,
      delegationPolicy: BUSINESS_AGENT_DELEGATION_POLICY,
      snapshotJson: canonicalJson(snapshot),
      snapshotDigest,
      appliedByPersonId: actorId,
    },
  })
  await recordAudit(tx, {
    entityType: 'BUSINESS',
    entityId: business.id,
    action: 'AGENT_CONFIG_APPLIED',
    actorId,
    tenantId: business.tenantId,
    businessId: business.id,
    payload: {
      source: 'STANDARD_TEMPLATE_V1',
      templateId: BUSINESS_AGENT_TEMPLATE_ID,
      templateVersion: BUSINESS_AGENT_TEMPLATE_VERSION,
      configVersion: BUSINESS_AGENT_CONFIG_VERSION,
      snapshotDigest,
    },
    afterJson: {
      schemaVersion: BUSINESS_AGENT_SCHEMA_VERSION,
      delegationPolicy: BUSINESS_AGENT_DELEGATION_POLICY,
      snapshotDigest,
    },
  })
  return row
}

/** Internal FR-074 creation hook; the caller has already authorized creation. */
export async function provisionBusinessAgentConfig(tx, { business, actorId }) {
  return createConfigAndAudit(tx, { business, actorId })
}

export async function readBusinessAgentConfig({ tenantId, businessId }, { db = prisma } = {}) {
  if (!tenantId || !businessId) throw failure(400, 'BUSINESS_AGENT_SCOPE_REQUIRED')
  const business = await db.business.findFirst({
    where: { id: businessId, tenantId, status: 'ACTIVE', tenant: { is: { status: 'ACTIVE' } } },
    select: { id: true, tenantId: true },
  })
  if (!business) return { status: 'NOT_CONFIGURED', config: null }
  const row = await db.businessAgentConfig.findUnique({ where: { businessId } })
  if (!row) return { status: 'NOT_CONFIGURED', config: null }
  return { status: 'CONFIGURED', config: storedConfig(row, business) }
}

export async function previewBusinessAgentTemplate(businessId, { viewer, db = prisma } = {}) {
  return db.$transaction(async (tx) => {
    const { business } = await authorizedTarget(tx, businessId, viewer)
    const existing = await tx.businessAgentConfig.findUnique({ where: { businessId } })
    const template = buildBusinessAgentTemplate(templateScope(business))
    const snapshotDigest = businessAgentSnapshotDigest(template)
    if (!existing) return { status: 'READY_TO_APPLY', template, snapshotDigest }
    const config = storedConfig(existing, business)
    if (config.snapshotDigest !== snapshotDigest) throw failure(409, 'BUSINESS_AGENT_CONFIG_CONFLICT')
    return { status: 'ALREADY_APPLIED', config }
  })
}

// Local serialization keeps concurrent calls on one server process predictable;
// the unique Business key remains the cross-process database guarantee.
const applyLocks = new Map()
async function serializeApply(businessId, operation) {
  const previous = applyLocks.get(businessId) || Promise.resolve()
  let release
  const current = new Promise((resolve) => { release = resolve })
  applyLocks.set(businessId, current)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (applyLocks.get(businessId) === current) applyLocks.delete(businessId)
  }
}

export async function applyBusinessAgentTemplate(businessId, { viewer, db = prisma } = {}) {
  return serializeApply(businessId, async () => {
    try {
      return await db.$transaction(async (tx) => {
        const { business, actorId } = await authorizedTarget(tx, businessId, viewer)
        const existing = await tx.businessAgentConfig.findUnique({ where: { businessId } })
        if (existing) {
          const config = storedConfig(existing, business)
          const expected = businessAgentSnapshotDigest(buildBusinessAgentTemplate(templateScope(business)))
          if (config.snapshotDigest !== expected) throw failure(409, 'BUSINESS_AGENT_CONFIG_CONFLICT')
          return { status: 'ALREADY_APPLIED', config }
        }
        const row = await createConfigAndAudit(tx, { business, actorId })
        return { status: 'APPLIED', config: storedConfig(row, business) }
      })
    } catch (error) {
      if (error?.code !== 'P2002') throw error
      // A concurrent writer may have won the unique Business constraint. Read
      // its committed value and report success only for the exact v1 snapshot.
      return db.$transaction(async (tx) => {
        const { business } = await authorizedTarget(tx, businessId, viewer)
        const existing = await tx.businessAgentConfig.findUnique({ where: { businessId } })
        if (!existing) throw error
        const config = storedConfig(existing, business)
        const expected = businessAgentSnapshotDigest(buildBusinessAgentTemplate(templateScope(business)))
        if (config.snapshotDigest !== expected) throw failure(409, 'BUSINESS_AGENT_CONFIG_CONFLICT')
        return { status: 'ALREADY_APPLIED', config }
      })
    }
  })
}

export function refuseUnsupportedBusinessAgentOperation(operation) {
  const supported = ['CUSTOMIZE', 'UPGRADE', 'ROLLBACK', 'BACKFILL', 'DELEGATE', 'PROVIDER_PROVISIONING']
  if (!supported.includes(operation)) throw failure(400, 'UNKNOWN_AGENT_FACTORY_OPERATION')
  throw failure(operation === 'DELEGATE' ? 403 : 409, `AGENT_FACTORY_${operation}_UNSUPPORTED`)
}

export function createDynamicSubagent() {
  throw failure(403, 'DYNAMIC_DELEGATION_DENIED')
}
