import prisma from '@/lib/db'
import { assertMarketingReadAccess } from './marketing-authority'
import {
  buildPlanEnvelope,
  hashCanonical,
} from './marketing-pm-handoff-service'
import {
  hashMarketingPlanContent,
  parseMarketingPlanVersionPayload,
} from '../domain/marketing-plan-contract'
import { normalizePlanEnvelope } from '@/modules/project-manager/import/plan-schema'
import { getProjectRoadmap } from '@/modules/project-manager/application/project-roadmap-read-model'

// @req FR-160 — expose a selected, receipt-bound Marketing execution roadmap
// without creating a second Project/Workstream/WorkItem read model.
// @spec SDD-087, SEC-001, SEC-003 — Marketing scope, immutable version/hash
// binding, persisted PM receipt provenance and PM-owned read authorization.
// @tested tests/integration/marketing-campaign-execution.test.js

const SHA256 = /^[a-f0-9]{64}$/

function unavailable(reasonCode) {
  return {
    status: 'UNAVAILABLE',
    reasonCode,
    handoff: null,
    roadmap: null,
  }
}

function isText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isHash(value) {
  return typeof value === 'string' && SHA256.test(value)
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseJson(value) {
  if (isObject(value)) return value
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return isObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isNotFound(error) {
  return error?.status === 404
}

function invalidBinding(reasonCode = 'MARKETING_RECEIPT_INVALID') {
  return unavailable(reasonCode)
}

async function loadPlan(db, planId) {
  return db.marketingPlan.findUnique({
    where: { id: planId },
    select: {
      id: true,
      tenantId: true,
      businessId: true,
      code: true,
      title: true,
      currentRevision: true,
      version: true,
      deletedAt: true,
    },
  })
}

async function loadVersion(db, versionId) {
  return db.marketingPlanVersion.findUnique({
    where: { id: versionId },
    select: {
      id: true,
      planId: true,
      revision: true,
      payloadJson: true,
      payloadHash: true,
      createdBy: true,
      createdAt: true,
    },
  })
}

function validateVersion(version) {
  if (!version || !version.id || !version.planId || !isHash(version.payloadHash)) return null
  try {
    const content = parseMarketingPlanVersionPayload(version.payloadJson)
    if (hashMarketingPlanContent(content) !== version.payloadHash) return null
    return content
  } catch {
    return null
  }
}

function validateReceiptRow(row, receipt, plan, version, businessId) {
  if (!row || !receipt || !isObject(receipt)) return false
  return receipt.status === 'SUCCEEDED' &&
    receipt.handoffId === row.id &&
    row.planId === plan.id &&
    row.planVersionId === version.id &&
    receipt.planId === plan.id &&
    receipt.businessId === businessId &&
    receipt.planVersionId === version.id &&
    receipt.workspaceId === row.workspaceId &&
    receipt.projectId === row.projectId &&
    row.payloadHash === version.payloadHash &&
    receipt.payloadHash === version.payloadHash &&
    isHash(row.envelopeHash) &&
    receipt.envelopeHash === row.envelopeHash &&
    Number.isInteger(receipt.expectedVersion) &&
    receipt.expectedVersion > 0 &&
    isText(receipt.previewHash) &&
    SHA256.test(receipt.previewHash)
}

function validatePmReceipt(receipt, pmReceipt, audit, project, envelopeHash, workspace) {
  const pm = receipt?.pm
  const expectedIdempotencyKey = `marketing.handoff:${receipt.planVersionId}:${workspace.id}`
  const expectedCorrelationId = `marketing.handoff:${receipt.planId}:${receipt.planVersionId}:${workspace.id}`
  if (!isObject(pm) ||
    pm.status !== 'SUCCEEDED' ||
    pm.projectId !== project.id ||
    !isText(pm.executionRunId) ||
    !isText(pm.auditEventId) ||
    !pmReceipt ||
    pmReceipt.idempotencyKey !== expectedIdempotencyKey ||
    pmReceipt.status !== 'SUCCEEDED' ||
    pmReceipt.projectId !== project.id ||
    pmReceipt.payloadHash !== envelopeHash ||
    pmReceipt.correlationId !== expectedCorrelationId ||
    pmReceipt.schemaVersion !== '1.2' ||
    pmReceipt.executionRunId !== pm.executionRunId ||
    pmReceipt.auditEventId !== pm.auditEventId ||
    !audit ||
    audit.entityType !== 'PROJECT' ||
    audit.entityId !== project.id ||
    audit.action !== 'PLAN_IMPORTED') {
    return false
  }

  const auditPayload = parseJson(audit.payloadJson)
  return auditPayload?.idempotencyKey === expectedIdempotencyKey &&
    auditPayload?.executionRunId === pmReceipt.executionRunId &&
    auditPayload?.projectCode === project.code
}

function buildEnvelopeForVersion({ plan, version, content, business, workspace, envelope }) {
  if (!isObject(envelope?.project) || !isText(envelope.project.status) ||
    !isObject(envelope.scope) || !isText(envelope.scope.businessCode) || !isText(envelope.scope.workspaceCode)) return null
  try {
    const expected = buildPlanEnvelope({
      plan: { ...plan, title: content.title },
      version: { ...version, payload: content.payload },
      payload: content.payload,
      // Business/Workspace codes are display values captured in the immutable
      // envelope. Reusing them here validates the signed payload and UUID
      // binding without making a historical receipt depend on a later rename.
      business: { ...business, code: envelope.scope.businessCode },
      workspace: { ...workspace, code: envelope.scope.workspaceCode },
      existingProject: { status: envelope.project.status },
    })
    return hashCanonical(expected)
  } catch {
    return null
  }
}

/**
 * Resolve a selected Marketing handoff into the PM-owned execution read model.
 *
 * Every identity used for the PM lookup comes from persisted, mutually bound
 * rows. The function deliberately does not open a transaction: callers may
 * pass an interactive transaction client, and getProjectRoadmap already uses
 * that client without opening a nested transaction.
 */
export async function readMarketingCampaignExecution({
  viewer,
  businessId,
  planId,
  handoffId,
  currentPlanVersionId,
} = {}, { db = prisma } = {}) {
  if (!isText(businessId) || !isText(planId) || !isText(handoffId)) {
    return unavailable('MARKETING_EXECUTION_NOT_BOUND')
  }

  let scope
  try {
    scope = await assertMarketingReadAccess({ db, viewer, businessId })
  } catch (error) {
    if (isNotFound(error)) return unavailable('MARKETING_SCOPE_UNAVAILABLE')
    throw error
  }

  const plan = await loadPlan(db, planId)
  if (!plan || plan.deletedAt || plan.businessId !== businessId || plan.tenantId !== scope.scope.tenantId) {
    return unavailable('MARKETING_PLAN_UNAVAILABLE')
  }

  const currentVersion = await db.marketingPlanVersion.findUnique({
    where: { planId_revision: { planId: plan.id, revision: plan.currentRevision } },
    select: {
      id: true,
      planId: true,
      revision: true,
      payloadJson: true,
      payloadHash: true,
      createdBy: true,
      createdAt: true,
    },
  })
  if (!currentVersion || currentVersion.planId !== plan.id) {
    return unavailable('MARKETING_CURRENT_REVISION_UNAVAILABLE')
  }
  if (!validateVersion(currentVersion)) {
    return unavailable('MARKETING_CURRENT_REVISION_UNAVAILABLE')
  }
  if (currentPlanVersionId !== undefined && currentPlanVersionId !== currentVersion.id) {
    return unavailable('MARKETING_CURRENT_REVISION_UNAVAILABLE')
  }

  const handoff = await db.marketingHandoff.findUnique({
    where: { id: handoffId },
    select: {
      id: true,
      planId: true,
      planVersionId: true,
      workspaceId: true,
      projectId: true,
      payloadHash: true,
      envelopeHash: true,
      receiptJson: true,
    },
  })
  if (!handoff || handoff.planId !== plan.id) return unavailable('MARKETING_HANDOFF_UNAVAILABLE')

  const version = handoff.planVersionId === currentVersion.id
    ? currentVersion
    : await loadVersion(db, handoff.planVersionId)
  if (!version || version.planId !== plan.id) return unavailable('MARKETING_VERSION_UNAVAILABLE')
  const content = validateVersion(version)
  if (!content || handoff.payloadHash !== version.payloadHash) return invalidBinding()

  const receipt = parseJson(handoff.receiptJson)
  if (!validateReceiptRow(handoff, receipt, plan, version, businessId)) return invalidBinding()
  if (!isObject(receipt.envelope) || hashCanonical(receipt.envelope) !== handoff.envelopeHash) return invalidBinding()

  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { id: true, code: true, name: true, tenantId: true },
  })
  if (!business || business.id !== plan.businessId || business.tenantId !== plan.tenantId || business.tenantId !== scope.scope.tenantId) {
    return unavailable('MARKETING_SCOPE_UNAVAILABLE')
  }

  const workspace = await db.workspace.findUnique({
    where: { id: handoff.workspaceId },
    select: { id: true, code: true, name: true, scopeType: true, businessId: true, tenantId: true, status: true },
  })
  if (!workspace || workspace.scopeType !== 'BUSINESS' || workspace.businessId !== business.id ||
    (workspace.tenantId && workspace.tenantId !== business.tenantId)) {
    return unavailable('MARKETING_WORKSPACE_UNAVAILABLE')
  }

  const expectedEnvelopeHash = buildEnvelopeForVersion({ plan, version, content, business, workspace, envelope: receipt.envelope })
  if (!expectedEnvelopeHash || expectedEnvelopeHash !== handoff.envelopeHash) return invalidBinding()
  if (receipt.envelope.trace?.idempotencyKey !== `marketing.handoff:${version.id}:${workspace.id}` ||
    receipt.envelope.trace?.correlationId !== `marketing.handoff:${plan.id}:${version.id}:${workspace.id}` ||
    receipt.envelope.schemaVersion !== '1.2') {
    return invalidBinding()
  }

  const project = await db.project.findUnique({
    where: { id: handoff.projectId },
    select: { id: true, code: true, businessId: true, workspaceId: true, status: true, deletedAt: true },
  })
  if (!project || project.deletedAt || project.businessId !== business.id || project.workspaceId !== workspace.id) {
    return unavailable('MARKETING_PROJECT_UNAVAILABLE')
  }
  if (project.code !== receipt.envelope.project?.code || (receipt.pm?.projectCode && receipt.pm.projectCode !== project.code)) {
    return invalidBinding()
  }

  const idempotencyKey = `marketing.handoff:${version.id}:${workspace.id}`
  const pmReceipt = await db.planImportReceipt.findUnique({ where: { idempotencyKey } })
  const audit = pmReceipt?.auditEventId
    ? await db.auditEvent.findUnique({ where: { id: pmReceipt.auditEventId } })
    : null
  let normalizedEnvelopeHash
  try {
    normalizedEnvelopeHash = hashCanonical(normalizePlanEnvelope(receipt.envelope))
  } catch {
    return invalidBinding('MARKETING_PM_RECEIPT_INVALID')
  }
  if (!validatePmReceipt(receipt, pmReceipt, audit, project, normalizedEnvelopeHash, workspace)) {
    return invalidBinding('MARKETING_PM_RECEIPT_INVALID')
  }

  let roadmap
  try {
    roadmap = await getProjectRoadmap(project.id, { db, viewer })
  } catch (error) {
    if (isNotFound(error)) return unavailable('PM_EXECUTION_UNAVAILABLE')
    throw error
  }

  return {
    status: 'READY',
    reasonCode: null,
    handoff: {
      id: handoff.id,
      planVersionId: version.id,
      revision: version.revision,
      payloadHash: version.payloadHash,
      workspaceId: workspace.id,
      projectId: project.id,
      isCurrentRevision: version.id === currentVersion.id,
    },
    roadmap,
  }
}
