import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import {
  assertMarketingReadAccess,
  assertMarketingWriteAccess,
  marketingConflict,
  marketingNotFound,
} from './marketing-authority'
import { readMarketingCampaignExecution as readMarketingCampaignExecutionAdapter } from './marketing-campaign-execution'
import {
  MARKETING_OPERATIONS_STATES,
  zMarketingOperationsActionInput,
  zMarketingOperationsCreateInput,
} from '../domain/marketing-operations-contract'

// @req FR-161 — compose one Business-scoped Operations aggregate and keep
// intake mutations in the Marketing owner service. Calendar and handoff data
// are bounded projections from owner ports; no second work system is written.
// @spec SDD-089, FR-158, FR-159, FR-157, SEC-001, SEC-003
// @tested tests/integration/marketing-operations.test.js,
//   tests/unit/marketing/marketing-operations-service.test.js

const MAX_ROWS = 100
const ENTITY = 'MARKETING_OPERATIONS_INTAKE'
const SHA256 = /^[a-f0-9]{64}$/

const INTAKE_SELECT = {
  id: true,
  tenantId: true,
  businessId: true,
  title: true,
  capability: true,
  objective: true,
  requiredAt: true,
  evidenceReference: true,
  responsibleOwnerId: true,
  status: true,
  version: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
}

const failure = (status, message) => Object.assign(new Error(message), { status })
const actorId = (viewer) => viewer?.principal?.id ?? null
const isText = (value) => typeof value === 'string' && value.trim().length > 0
const iso = (value) => value == null ? null : new Date(value).toISOString()

function parseJson(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function toDate(value) {
  if (value == null || value === '') return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw failure(422, 'MARKETING_OPERATIONS_DATE_INVALID')
  return date
}

function intakeDto(row) {
  return {
    id: row.id,
    businessId: row.businessId,
    title: row.title,
    capability: row.capability,
    objective: row.objective,
    requiredAt: iso(row.requiredAt),
    evidenceReference: row.evidenceReference ?? null,
    responsibleOwnerId: row.responsibleOwnerId ?? null,
    status: row.status,
    version: row.version,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  }
}

function stateFor(rows, { unavailable = false, partial = false, stale = false } = {}) {
  if (unavailable) return 'UNAVAILABLE'
  if (stale) return 'STALE'
  if (partial) return 'PARTIAL'
  return rows.length ? 'READY' : 'EMPTY'
}

function section({ rows, state, source, generatedAt, warnings = [], truncated = false, lastUpdated = null }) {
  if (!MARKETING_OPERATIONS_STATES.includes(state)) throw new Error(`Unknown Marketing Operations state: ${state}`)
  return { state, source, rows, generatedAt, lastUpdated, warnings, truncated }
}

function approvalRow(row, type) {
  const review = row.reviews?.[0] || null
  const decision = row.decisions?.[0] || null
  const title = row.title || row.code || 'Marketing approval'
  const verdict = decision?.verdict || review?.verdict || null
  return {
    id: `${type.toLowerCase()}:${row.id}`,
    sourceType: type,
    sourceId: row.id,
    businessId: row.businessId,
    title,
    status: verdict || (row.status === 'APPROVED' ? 'APPROVED' : 'PENDING'),
    revision: row.currentRevision || 1,
    version: row.version || 1,
    reviewerId: review?.reviewerId || null,
    reviewId: review?.id || null,
    decisionId: decision?.id || null,
    updatedAt: iso(row.updatedAt || decision?.createdAt || review?.createdAt),
  }
}

function safeReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object') return null
  const pm = receipt.pm && typeof receipt.pm === 'object' ? receipt.pm : null
  return {
    status: typeof receipt.status === 'string' ? receipt.status : null,
    planId: isText(receipt.planId) ? receipt.planId : null,
    planVersionId: isText(receipt.planVersionId) ? receipt.planVersionId : null,
    workspaceId: isText(receipt.workspaceId) ? receipt.workspaceId : null,
    projectId: isText(receipt.projectId) ? receipt.projectId : null,
    pm: pm ? {
      status: typeof pm.status === 'string' ? pm.status : null,
      projectId: isText(pm.projectId) ? pm.projectId : null,
      executionRunId: isText(pm.executionRunId) ? pm.executionRunId : null,
      auditEventId: isText(pm.auditEventId) ? pm.auditEventId : null,
    } : null,
  }
}

function roadmapSummary(roadmap) {
  if (!roadmap || typeof roadmap !== 'object') return null
  return {
    project: roadmap.project ? {
      id: roadmap.project.id,
      code: roadmap.project.code,
      name: roadmap.project.name,
      status: roadmap.project.status,
      targetAt: roadmap.project.targetAt ?? null,
      progress: roadmap.project.progress?.percent ?? null,
    } : null,
    plans: (roadmap.plans || []).map((plan) => ({
      planId: plan.planId,
      projectId: plan.projectId,
      name: plan.name,
      status: plan.status,
      targetAt: plan.targetAt,
      progress: plan.progress?.percent ?? null,
    })),
    itemCount: Array.isArray(roadmap.items) ? roadmap.items.length : 0,
    milestoneCount: Array.isArray(roadmap.closure?.gates) ? roadmap.closure.gates.length : 0,
    generatedAt: roadmap.meta?.generatedAt || null,
  }
}

function calendarRowsFromRoadmap(handoff, roadmap) {
  if (!roadmap || typeof roadmap !== 'object') return []
  const rows = []
  const project = roadmap.project
  if (project?.id) rows.push({
    id: `PROJECT:${project.id}`,
    recordType: 'PROJECT',
    recordId: project.id,
    projectId: project.id,
    title: project.name,
    status: project.status,
    startAt: project.startAt,
    targetAt: project.targetAt,
    progress: project.progress?.percent ?? null,
    sourceHandoffId: handoff.id,
  })
  for (const plan of roadmap.plans || []) {
    if (!plan?.planId) continue
    rows.push({
      id: `WORKSTREAM:${plan.planId}`,
      recordType: 'WORKSTREAM',
      recordId: plan.planId,
      projectId: plan.projectId,
      title: plan.name,
      status: plan.status,
      startAt: plan.startAt,
      targetAt: plan.targetAt,
      progress: plan.progress?.percent ?? null,
      sourceHandoffId: handoff.id,
    })
  }
  for (const item of roadmap.items || []) {
    if (!item?.workItemId) continue
    rows.push({
      id: `WORK_ITEM:${item.workItemId}`,
      recordType: 'WORK_ITEM',
      recordId: item.workItemId,
      projectId: item.projectId,
      title: item.title,
      code: item.code,
      status: item.status,
      startAt: item.startAt,
      targetAt: item.targetAt,
      progress: null,
      sourceHandoffId: handoff.id,
    })
  }
  return rows
}

async function loadApprovals(db, businessId) {
  const [plans, briefs] = await Promise.all([
    db.marketingPlan.findMany({
      where: { businessId, deletedAt: null },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: MAX_ROWS + 1,
      select: {
        id: true, businessId: true, title: true, status: true, currentRevision: true, version: true, updatedAt: true,
        reviews: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { id: true, verdict: true, reviewerId: true, createdAt: true } },
        decisions: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { id: true, verdict: true, createdAt: true } },
      },
    }),
    db.marketingContentBrief.findMany({
      where: { businessId, deletedAt: null },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: MAX_ROWS + 1,
      select: {
        id: true, businessId: true, title: true, status: true, currentRevision: true, version: true, updatedAt: true,
        reviews: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { id: true, verdict: true, reviewerId: true, createdAt: true } },
        decisions: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { id: true, verdict: true, createdAt: true } },
      },
    }),
  ])
  const rows = [
    ...plans.map((row) => approvalRow(row, 'STRATEGY_PLAN')),
    ...briefs.map((row) => approvalRow(row, 'CONTENT_BRIEF')),
  ].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  return { rows: rows.slice(0, MAX_ROWS), truncated: rows.length > MAX_ROWS }
}

async function loadHandoffs({ db, viewer, businessId, readExecution }) {
  const rows = await db.marketingHandoff.findMany({
    where: { plan: { businessId, deletedAt: null } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: MAX_ROWS + 1,
    select: {
      id: true,
      planId: true,
      planVersionId: true,
      workspaceId: true,
      projectId: true,
      payloadHash: true,
      envelopeHash: true,
      receiptJson: true,
      createdAt: true,
      plan: { select: { businessId: true, title: true } },
    },
  })
  const output = []
  for (const row of rows.slice(0, MAX_ROWS)) {
    let execution
    try {
      execution = await readExecution({ viewer, businessId, planId: row.planId, handoffId: row.id }, { db })
    } catch (error) {
      execution = { status: 'UNAVAILABLE', reasonCode: error?.status === 404 ? 'PM_EXECUTION_UNAVAILABLE' : 'OWNER_READ_FAILED' }
    }
    const receipt = safeReceipt(parseJson(row.receiptJson))
    output.push({
      id: row.id,
      businessId,
      planId: row.planId,
      planVersionId: row.planVersionId,
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      title: row.plan?.title || 'Marketing handoff',
      status: execution?.status === 'READY' ? 'READY' : 'UNAVAILABLE',
      reasonCode: execution?.status === 'READY' ? null : (execution?.reasonCode || 'OWNER_READ_FAILED'),
      receipt,
      source: 'MARKETING_TO_OWNER_RECEIPT',
      roadmap: execution?.status === 'READY' ? roadmapSummary(execution.roadmap) : null,
      payloadHash: SHA256.test(row.payloadHash) ? row.payloadHash : null,
      createdAt: iso(row.createdAt),
    })
    output[output.length - 1]._roadmap = execution?.status === 'READY' ? execution.roadmap : null
  }
  return { rows: output, truncated: rows.length > MAX_ROWS }
}

function deDuplicateCalendar(handoffs) {
  const byId = new Map()
  for (const handoff of handoffs) {
    for (const row of calendarRowsFromRoadmap(handoff, handoff._roadmap)) {
      if (!byId.has(row.id)) byId.set(row.id, row)
    }
  }
  return [...byId.values()].sort((a, b) => String(a.targetAt || '').localeCompare(String(b.targetAt || '')))
}

function publicHandoff(row) {
  if (!row) return row
  const { _roadmap, ...safe } = row
  return safe
}

export async function listMarketingOperations({ businessId, viewer } = {}, {
  db = prisma,
  now = new Date(),
  readMarketingCampaignExecution = readMarketingCampaignExecutionAdapter,
} = {}) {
  const scope = await assertMarketingReadAccess({ db, viewer, businessId })
  const generatedAt = new Date(now).toISOString()
  const [intakeRows, approvalResult, handoffResult] = await Promise.all([
    db.marketingOperationsIntake.findMany({
      where: { tenantId: scope.scope.tenantId, businessId: scope.scope.businessId, deletedAt: null },
      orderBy: [{ requiredAt: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_ROWS + 1,
      select: INTAKE_SELECT,
    }),
    loadApprovals(db, scope.scope.businessId),
    loadHandoffs({ db, viewer, businessId: scope.scope.businessId, readExecution: readMarketingCampaignExecution }),
  ])
  const intake = intakeRows.slice(0, MAX_ROWS).map(intakeDto)
  const handoffs = handoffResult.rows.map(publicHandoff)
  const readyHandoffs = handoffResult.rows.filter((row) => row.status === 'READY')
  const unavailableHandoffs = handoffResult.rows.filter((row) => row.status !== 'READY')
  const calendar = deDuplicateCalendar(readyHandoffs)
  const warnings = []
  if (unavailableHandoffs.length) warnings.push(`${unavailableHandoffs.length} handoff receipt(s) are unavailable from the owner read port.`)
  if (handoffResult.truncated) warnings.push('Handoff rows are truncated at the Operations response limit.')
  if (intakeRows.length > MAX_ROWS) warnings.push('Intake rows are truncated at the Operations response limit.')
  if (approvalResult.truncated) warnings.push('Approval rows are truncated at the Operations response limit.')
  return {
    readModel: 'MARKETING_OPERATIONS',
    schemaVersion: '1.0',
    businessId: scope.scope.businessId,
    generatedAt,
    canWrite: scope.canWrite,
    intake,
    calendar,
    approvals: approvalResult.rows,
    handoffs,
    sections: {
      intake: section({ rows: intake, state: stateFor(intake), source: 'MARKETING_OPERATIONS_INTAKE', generatedAt, truncated: intakeRows.length > MAX_ROWS, lastUpdated: intake[0]?.updatedAt || null }),
      calendar: section({ rows: calendar, state: stateFor(calendar, { unavailable: readyHandoffs.length === 0 && unavailableHandoffs.length > 0 }), source: 'PROJECT_MANAGER_EXECUTION_ROADMAP', generatedAt, warnings: unavailableHandoffs.length ? ['Some PM receipts could not be read through the owner port.'] : [], truncated: handoffResult.truncated }),
      approvals: section({ rows: approvalResult.rows, state: stateFor(approvalResult.rows), source: 'MARKETING_REVIEW_DECISION_EVIDENCE', generatedAt, truncated: approvalResult.truncated, lastUpdated: approvalResult.rows[0]?.updatedAt || null }),
      handoffs: section({ rows: handoffs, state: stateFor(handoffs, { unavailable: handoffs.length > 0 && readyHandoffs.length === 0, partial: readyHandoffs.length > 0 && unavailableHandoffs.length > 0 }), source: 'MARKETING_TO_OWNER_RECEIPT', generatedAt, warnings: unavailableHandoffs.map((row) => row.reasonCode), truncated: handoffResult.truncated, lastUpdated: handoffs[0]?.createdAt || null }),
    },
    warnings,
  }
}

export async function getMarketingOperationsIntake(id, { businessId, viewer } = {}, { db = prisma } = {}) {
  const scope = await assertMarketingReadAccess({ db, viewer, businessId })
  const row = await db.marketingOperationsIntake.findUnique({ where: { id }, select: INTAKE_SELECT })
  if (!row || row.deletedAt || row.businessId !== scope.scope.businessId || row.tenantId !== scope.scope.tenantId) throw marketingNotFound('Marketing intake not found')
  return { readModel: 'MARKETING_OPERATIONS_INTAKE', businessId: scope.scope.businessId, canWrite: scope.canWrite, intake: intakeDto(row) }
}

async function assertResponsibleOwner(tx, business, ownerId) {
  if (!ownerId) return
  const membership = await tx.membership.findFirst({
    where: { personId: ownerId, tenantId: business.tenantId, businessId: business.id, status: 'ACTIVE' },
    select: { personId: true },
  })
  if (!membership) throw failure(422, 'MARKETING_RESPONSIBLE_OWNER_NOT_IN_BUSINESS')
}

export async function createMarketingOperationsIntake(input, { viewer } = {}, { db = prisma } = {}) {
  const data = zMarketingOperationsCreateInput.parse(input)
  const created = await db.$transaction(async (tx) => {
    const scope = await assertMarketingWriteAccess({ db: tx, viewer, businessId: data.businessId })
    await assertResponsibleOwner(tx, scope.business, data.responsibleOwnerId)
    const row = await tx.marketingOperationsIntake.create({
      data: {
        tenantId: scope.scope.tenantId,
        businessId: scope.scope.businessId,
        title: data.title,
        capability: data.capability,
        objective: data.objective,
        requiredAt: toDate(data.requiredAt),
        evidenceReference: data.evidenceReference ?? null,
        responsibleOwnerId: data.responsibleOwnerId ?? null,
        createdBy: actorId(viewer),
      },
      select: INTAKE_SELECT,
    })
    await recordAudit(tx, {
      entityType: ENTITY,
      entityId: row.id,
      action: 'MARKETING_OPERATIONS_INTAKE_CREATED',
      actorId: actorId(viewer),
      payload: { businessId: row.businessId, title: row.title, capability: row.capability, version: row.version },
    })
    return row
  })
  return { businessId: created.businessId, intake: intakeDto(created) }
}

export async function updateMarketingOperationsIntake(id, input, { viewer } = {}, { db = prisma } = {}) {
  const data = zMarketingOperationsActionInput.parse(input)
  const updated = await db.$transaction(async (tx) => {
    const row = await tx.marketingOperationsIntake.findUnique({ where: { id }, select: INTAKE_SELECT })
    if (!row || row.deletedAt || row.businessId !== data.businessId) throw marketingNotFound('Marketing intake not found')
    const scope = await assertMarketingWriteAccess({ db: tx, viewer, businessId: row.businessId })
    if (row.tenantId !== scope.scope.tenantId) throw marketingNotFound('Marketing intake not found')
    if (row.version !== data.expectedVersion) throw marketingConflict('MARKETING_OPERATIONS_INTAKE_VERSION_CONFLICT')
    if (data.action === 'archive') {
      const result = await tx.marketingOperationsIntake.updateMany({ where: { id: row.id, version: row.version, deletedAt: null }, data: { status: 'ARCHIVED', deletedAt: new Date(), version: { increment: 1 } } })
      if (result.count !== 1) throw marketingConflict('MARKETING_OPERATIONS_INTAKE_VERSION_CONFLICT')
      await recordAudit(tx, { entityType: ENTITY, entityId: row.id, action: 'MARKETING_OPERATIONS_INTAKE_ARCHIVED', actorId: actorId(viewer), payload: { businessId: row.businessId, version: row.version + 1 } })
    } else {
      const fields = data.fields
      if (fields.responsibleOwnerId !== undefined) await assertResponsibleOwner(tx, scope.business, fields.responsibleOwnerId)
      const changes = {}
      for (const key of ['title', 'capability', 'objective', 'status']) if (fields[key] !== undefined) changes[key] = fields[key]
      if (fields.requiredAt !== undefined) changes.requiredAt = toDate(fields.requiredAt)
      if (fields.evidenceReference !== undefined) changes.evidenceReference = fields.evidenceReference ?? null
      if (fields.responsibleOwnerId !== undefined) changes.responsibleOwnerId = fields.responsibleOwnerId ?? null
      const result = await tx.marketingOperationsIntake.updateMany({ where: { id: row.id, version: row.version, deletedAt: null }, data: { ...changes, version: { increment: 1 } } })
      if (result.count !== 1) throw marketingConflict('MARKETING_OPERATIONS_INTAKE_VERSION_CONFLICT')
      await recordAudit(tx, { entityType: ENTITY, entityId: row.id, action: 'MARKETING_OPERATIONS_INTAKE_UPDATED', actorId: actorId(viewer), payload: { businessId: row.businessId, fields: Object.keys(changes), version: row.version + 1 } })
    }
    return tx.marketingOperationsIntake.findUnique({ where: { id: row.id }, select: INTAKE_SELECT })
  })
  return { businessId: updated.businessId, intake: intakeDto(updated) }
}

export async function getMarketingOperationsHandoff(id, { businessId, viewer } = {}, {
  db = prisma,
  readMarketingCampaignExecution = readMarketingCampaignExecutionAdapter,
} = {}) {
  await assertMarketingReadAccess({ db, viewer, businessId })
  const row = await db.marketingHandoff.findUnique({
    where: { id },
    select: { id: true, planId: true, planVersionId: true, workspaceId: true, projectId: true, payloadHash: true, receiptJson: true, createdAt: true, plan: { select: { businessId: true, title: true } } },
  })
  if (!row || row.plan?.businessId !== businessId) throw marketingNotFound('Marketing handoff not found')
  let execution
  try {
    execution = await readMarketingCampaignExecution({ viewer, businessId, planId: row.planId, handoffId: row.id }, { db })
  } catch (error) {
    execution = { status: 'UNAVAILABLE', reasonCode: error?.status === 404 ? 'PM_EXECUTION_UNAVAILABLE' : 'OWNER_READ_FAILED' }
  }
  return {
    readModel: 'MARKETING_OPERATIONS_HANDOFF',
    businessId,
    handoff: {
      id: row.id,
      planId: row.planId,
      planVersionId: row.planVersionId,
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      title: row.plan?.title || 'Marketing handoff',
      status: execution.status === 'READY' ? 'READY' : 'UNAVAILABLE',
      reasonCode: execution.status === 'READY' ? null : execution.reasonCode,
      receipt: safeReceipt(parseJson(row.receiptJson)),
      roadmap: execution.status === 'READY' ? execution.roadmap : null,
      createdAt: iso(row.createdAt),
      payloadHash: SHA256.test(row.payloadHash) ? row.payloadHash : null,
    },
  }
}
