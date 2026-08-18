import { z } from 'zod'
import prisma from '@/lib/db'
import { seesBusiness } from '@/modules/identity/viewer-authority'
import { requireViewer } from './project-authorization'
import { activeWorkstream } from './active-filters'
import { safeParse } from './audit'
import { projectDependencyGraph } from './project-dependency-map'
import { calculateWorkstreamProgress } from '../progress/strategies'
import { rollupProject } from '../progress/rollup'
import { WORK_STATUSES } from '@/lib/validation/enums'

// @req FR-068, FR-070 — one authorized, read-only Human Execution Roadmap over the
// existing Project/Workstream/WorkContainer/WorkItem graph, including Business Goals.
// @spec SDD-039, ADR-028, ADR-029, FR-070
// @tested tests/unit/project-roadmap-read-model.test.js, tests/integration/project-roadmap.test.js

export const EXECUTION_ROADMAP_VERSION = '1.0'

const EXECUTION_CONTRACT_IDS = Object.freeze({
  SOFTWARE_SPRINT: 'EXC-SOFTWARE-SPRINT-V1',
  DATA_MIGRATION: 'EXC-DATA-MIGRATION-V1',
  B2B_SALES: 'EXC-B2B-SALES-V1',
  B2C_CAMPAIGN: 'EXC-B2C-CAMPAIGN-V1',
  PRODUCT_LAUNCH: 'EXC-PRODUCT-LAUNCH-V1',
  OPERATIONS: 'EXC-OPERATIONS-V1',
  BUSINESS_EXPANSION: 'EXC-BUSINESS-EXPANSION-V1',
})

const MODE_VOCABULARY = Object.freeze({
  SOFTWARE_SPRINT: { containers: ['Release', 'Sprint', 'Epic'], items: ['Task', 'Bug'] },
  DATA_MIGRATION: { containers: ['Stage', 'Batch/Run'], items: ['Dataset', 'Validation', 'Reconciliation'] },
  B2B_SALES: { containers: ['Pipeline', 'Stage'], items: ['Account', 'Deal', 'Activity'] },
  B2C_CAMPAIGN: { containers: ['Campaign', 'Wave', 'Channel'], items: ['Creative', 'Audience', 'Experiment'] },
  PRODUCT_LAUNCH: { containers: ['Launch Phase'], items: ['Deliverable'] },
  OPERATIONS: { containers: ['Period', 'Process'], items: ['Checklist Item', 'Issue', 'SLA'] },
  BUSINESS_EXPANSION: { containers: ['Initiative', 'Site'], items: ['Setup Action', 'Approval'] },
})

const CONTAINER_TYPED_IDS = Object.freeze({
  RELEASE: 'releaseId',
  SPRINT: 'sprintId',
  EPIC: 'epicId',
  MIGRATION_STAGE: 'stageId',
  MIGRATION_BATCH: 'batchId',
  SALES_PIPELINE: 'pipelineId',
  SALES_STAGE: 'stageId',
  CAMPAIGN: 'campaignId',
  CAMPAIGN_WAVE: 'waveId',
  CHANNEL: 'channelId',
  LAUNCH_PHASE: 'phaseId',
  OPS_PERIOD: 'periodId',
  OPS_PROCESS: 'processId',
  EXPANSION_INITIATIVE: 'initiativeId',
  EXPANSION_SITE: 'siteId',
})

const ITEM_TYPED_IDS = Object.freeze({
  TASK: 'taskId',
  BUG: 'bugId',
  DATASET: 'datasetId',
  VALIDATION: 'validationId',
  RECONCILIATION: 'reconciliationId',
  ACCOUNT: 'accountId',
  DEAL: 'dealId',
  ACTIVITY: 'activityId',
  CREATIVE: 'creativeId',
  AUDIENCE: 'audienceId',
  EXPERIMENT: 'experimentId',
  DELIVERABLE: 'deliverableId',
  CHECKLIST_ITEM: 'checklistItemId',
  ISSUE: 'issueId',
  SLA: 'slaId',
  SETUP_ACTION: 'setupActionId',
  APPROVAL: 'approvalId',
})

const STATUS_VALUES = ['READY', 'EMPTY', 'UNAVAILABLE']
const zDate = z.string().datetime().nullable()
const zUnavailable = z.object({
  status: z.literal('UNAVAILABLE'),
  reasonCode: z.string().min(1),
}).strict()
const zProgress = z.object({
  percent: z.number(),
  totalWeight: z.number(),
  formula: z.string().nullable(),
  evidence: z.record(z.unknown()),
  warnings: z.array(z.string()),
}).strict()
const zGoal = z.object({
  id: z.string().min(1),
  businessId: z.string().min(1),
  code: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable(),
  status: z.string().min(1),
  priority: z.string().min(1),
  progress: z.number(),
  startAt: zDate,
  targetAt: zDate,
}).strict()
const zAssignee = z.union([
  zUnavailable,
  z.object({
    status: z.literal('READY'),
    personId: z.string().min(1),
    displayName: z.string().min(1),
    role: z.string().min(1),
  }).strict(),
])
const zPlan = z.object({
  projectId: z.string().min(1),
  planId: z.string().min(1),
  planCode: z.string().min(1),
  name: z.string().min(1),
  executionModeId: z.string().min(1),
  executionContractId: z.string().min(1).nullable(),
  displayVocabulary: z.object({ containers: z.array(z.string()), items: z.array(z.string()) }).strict(),
  progressStrategy: z.string().min(1),
  progressWeight: z.number(),
  status: z.string().min(1),
  startAt: zDate,
  targetAt: zDate,
  currentContainerId: z.string().nullable(),
  progress: zProgress,
}).strict()
const zContainer = z.object({
  projectId: z.string().min(1),
  planId: z.string().min(1),
  containerId: z.string().min(1),
  typedId: z.object({ key: z.string().min(1), value: z.string().min(1) }).strict(),
  parentContainerId: z.string().nullable(),
  subtype: z.string().min(1),
  code: z.string().min(1),
  title: z.string().min(1),
  startAt: zDate,
  targetAt: zDate,
  status: z.string().min(1),
  progressEvidence: zUnavailable,
  closure: z.object({
    completed: z.number().int().nonnegative(),
    open: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
    carryOver: z.number().int().nonnegative().nullable(),
  }).strict(),
}).strict()
const zItem = z.object({
  projectId: z.string().min(1),
  planId: z.string().min(1),
  containerId: z.string().nullable(),
  workItemId: z.string().min(1),
  typedId: z.object({ key: z.string().min(1), value: z.string().min(1) }).strict(),
  subtype: z.string().min(1),
  code: z.string().min(1),
  title: z.string().min(1),
  status: z.string().min(1),
  assignee: zAssignee,
  tags: zUnavailable,
  startAt: zDate,
  targetAt: zDate,
  criteria: zUnavailable,
  evidence: zUnavailable,
}).strict()
const zEndpoint = z.object({
  endpointType: z.string().min(1),
  endpointId: z.string().min(1),
  code: z.string().nullable(),
  title: z.string().min(1),
  status: z.string().nullable(),
}).strict()
const zDependency = z.object({
  id: z.string().min(1),
  source: zEndpoint,
  target: zEndpoint,
  dependencyType: z.string().min(1),
  blockedReason: z.string().nullable(),
  blockingOwner: zUnavailable,
  affectedItemId: z.string().nullable(),
}).strict()
const zSummary = z.object({
  total: z.number().int().nonnegative(),
  backlog: z.number().int().nonnegative(),
  open: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
  deadlineState: z.enum(['NO_DEADLINE', 'ON_TRACK', 'OVERDUE']),
}).strict()

export const zProjectRoadmapResponse = z.object({
  readModel: z.literal('EXECUTION_ROADMAP'),
  schemaVersion: z.literal(EXECUTION_ROADMAP_VERSION),
  project: z.object({
    id: z.string().min(1),
    code: z.string().min(1),
    name: z.string().min(1),
    outcome: z.string().nullable(),
    businessId: z.string().nullable(),
    goalIds: z.array(z.string().min(1)),
    riskIds: z.array(z.string().min(1)),
    status: z.string().min(1),
    startAt: zDate,
    targetAt: zDate,
    accountableOwner: zUnavailable,
    progress: zProgress,
  }).strict(),
  goals: z.array(zGoal),
  risks: z.object({ status: z.literal('UNAVAILABLE'), items: z.array(z.unknown()), reasonCode: z.string().min(1) }).strict(),
  plans: z.array(zPlan),
  containers: z.array(zContainer),
  items: z.array(zItem),
  dependencies: z.object({
    status: z.enum(STATUS_VALUES),
    items: z.array(zDependency),
    reasonCode: z.string().nullable(),
  }).strict(),
  roster: z.object({
    status: z.enum(STATUS_VALUES),
    items: z.array(z.object({
      personId: z.string().min(1),
      displayName: z.string().min(1),
      role: z.string().min(1),
    }).strict()),
    reasonCode: z.string().nullable(),
  }).strict(),
  sources: zUnavailable,
  closure: z.object({
    status: z.literal('READY'),
    summary: z.object({ completed: z.number().int().nonnegative(), open: z.number().int().nonnegative(), blocked: z.number().int().nonnegative(), carryOver: z.number().int().nonnegative().nullable() }).strict(),
    decision: zUnavailable,
    gates: z.array(z.object({
      id: z.string().min(1),
      code: z.string().min(1),
      title: z.string().min(1),
      status: z.string().min(1),
      required: z.boolean(),
      evidencePresent: z.boolean(),
      targetAt: zDate,
    }).strict()),
  }).strict(),
  identityRefs: zUnavailable,
  summary: zSummary,
  meta: z.object({
    generatedAt: z.string().datetime(),
    readScope: z.enum(['BUSINESS', 'TENANT_SHARED', 'PORTFOLIO_SHARED', 'PLATFORM']),
    warnings: z.array(z.string()),
  }).strict(),
}).strict()

const isoDate = (value) => value == null ? null : new Date(value).toISOString()
const unavailable = (reasonCode) => ({ status: 'UNAVAILABLE', reasonCode })
const COMPLETED_WORK_STATUSES = new Set(WORK_STATUSES.filter((status) => status === 'DONE'))
COMPLETED_WORK_STATUSES.add('COMPLETED')
const BACKLOG_WORK_STATUSES = new Set(WORK_STATUSES.filter((status) => ['PLANNED', 'READY'].includes(status)))
const CANCELLED_WORK_STATUS = WORK_STATUSES.find((status) => status === 'CANCELLED')
const BLOCKED_WORK_STATUS = WORK_STATUSES.find((status) => status === 'BLOCKED')

function statusCounts(items = []) {
  const active = items.filter((item) => !item.deletedAt && item.status !== CANCELLED_WORK_STATUS)
  const completed = active.filter((item) => COMPLETED_WORK_STATUSES.has(item.status)).length
  const blocked = active.filter((item) => item.status === BLOCKED_WORK_STATUS).length
  const backlog = active.filter((item) => BACKLOG_WORK_STATUSES.has(item.status)).length
  return { total: active.length, backlog, open: active.length - completed, completed, blocked }
}

function deadlineState(targetAt, now, status) {
  if (!targetAt) return 'NO_DEADLINE'
  if (COMPLETED_WORK_STATUSES.has(status) || status === 'ARCHIVED') return 'ON_TRACK'
  return new Date(targetAt).getTime() < new Date(now).getTime() ? 'OVERDUE' : 'ON_TRACK'
}

function progressFor(workstream) {
  const bundle = {
    workstream,
    viewConfig: safeParse(workstream.viewConfigJson, {}),
    items: (workstream.items || [])
      .filter((item) => !item.deletedAt)
      .map((item) => ({
        ...item,
        metrics: safeParse(item.metricDataJson, {}),
        metadata: safeParse(item.metadataJson, {}),
      })),
    containers: workstream.containers || [],
    milestones: workstream.milestones || [],
    gates: (workstream.gates || []).map((gate) => ({ ...gate, evidence: safeParse(gate.evidenceJson, {}) })),
  }
  return {
    workstreamId: workstream.id,
    code: workstream.code,
    name: workstream.name,
    executionMode: workstream.executionMode,
    progressStrategy: workstream.progressStrategy,
    progressWeight: Number(workstream.progressWeight),
    ...calculateWorkstreamProgress(workstream.progressStrategy, bundle),
  }
}

function endpointFromNode(node) {
  const separator = node.id.indexOf(':')
  return {
    endpointType: node.type,
    endpointId: node.entityId || node.id.slice(separator + 1),
    code: node.code ?? null,
    title: node.title,
    status: node.status ?? null,
  }
}

function dependencyRows(graph) {
  const nodes = new Map((graph?.nodes || []).map((node) => [node.id, node]))
  return (graph?.edges || []).map((edge) => {
    const source = nodes.get(edge.source)
    const target = nodes.get(edge.target)
    if (!source || !target) return null
    return {
      id: edge.id,
      source: endpointFromNode(source),
      target: endpointFromNode(target),
      dependencyType: edge.dependencyType,
      blockedReason: edge.dependencyType === 'BLOCKS' ? edge.label : null,
      blockingOwner: unavailable('BLOCKER_OWNER_NOT_RESOLVED'),
      affectedItemId: target.type === 'WORK_ITEM' ? endpointFromNode(target).endpointId : null,
    }
  }).filter(Boolean)
}

function assigneeDto(item, roster) {
  const member = (roster || []).find((row) => row.person?.id === item.assigneeRef)
  if (!member) return unavailable(item.assigneeRef ? 'ASSIGNEE_NOT_RESOLVED' : 'NO_ASSIGNEE')
  return {
    status: 'READY',
    personId: member.person.id,
    displayName: member.person.displayName,
    role: member.role,
  }
}

function currentContainer(workstream) {
  return (workstream.containers || [])
    .filter((container) => !['DONE', 'ARCHIVED'].includes(container.status))
    .sort((a, b) => String(a.targetAt || a.createdAt || '').localeCompare(String(b.targetAt || b.createdAt || '')))[0]?.id || null
}

function containerClosure(container, items) {
  const counts = statusCounts(items.filter((item) => item.containerId === container.id))
  return { completed: counts.completed, open: counts.open, blocked: counts.blocked, carryOver: null }
}

function gateDto(gate) {
  return {
    id: gate.id,
    code: gate.code,
    title: gate.title,
    status: gate.status,
    required: Boolean(gate.required),
    evidencePresent: Object.keys(safeParse(gate.evidenceJson, {})).length > 0,
    targetAt: isoDate(gate.targetAt),
  }
}

function buildDependencyGraph(project, workstreams, milestones, gates, dependencies) {
  const endpointRecords = new Map()
  endpointRecords.set(`PROJECT:${project.id}`, project)
  for (const workstream of workstreams) {
    endpointRecords.set(`WORKSTREAM:${workstream.id}`, workstream)
    for (const container of workstream.containers || []) endpointRecords.set(`WORK_CONTAINER:${container.id}`, container)
    for (const item of workstream.items || []) endpointRecords.set(`WORK_ITEM:${item.id}`, item)
  }
  for (const milestone of milestones) endpointRecords.set(`MILESTONE:${milestone.id}`, milestone)
  for (const gate of gates) endpointRecords.set(`GATE:${gate.id}`, gate)
  const entityKeys = new Set(endpointRecords.keys())
  const resolved = dependencies.map((dependency) => ({
    ...dependency,
    source: endpointRecords.get(`${dependency.sourceType}:${dependency.sourceId}`),
    target: endpointRecords.get(`${dependency.targetType}:${dependency.targetId}`),
  }))
  return projectDependencyGraph({ projectId: project.id, dependencies: resolved, entityKeys })
}

function dependencyWhere(entityKeys) {
  const pairs = []
  for (const key of entityKeys) {
    const separator = key.indexOf(':')
    const type = key.slice(0, separator)
    const id = key.slice(separator + 1)
    pairs.push({ sourceType: type, sourceId: id }, { targetType: type, targetId: id })
  }
  return { OR: pairs }
}

function projectNotFound() {
  const error = new Error('Project not found')
  error.status = 404
  return error
}

/**
 * Pure DTO builder. All input rows must already be authorized by the caller.
 * Business Goals are projections of BusinessGoal rows linked through ProjectGoal;
 * the Project Manager never becomes their owner.
 */
export function buildProjectRoadmapReadModel({
  project,
  goals = [],
  workstreams = [],
  gates = [],
  dependencyGraph = { version: '1.0', nodes: [], edges: [] },
  roster = [],
  readScope = 'BUSINESS',
  now = new Date(),
} = {}) {
  const authorizedGoals = goals.filter((goal) => !project.businessId || goal.businessId === project.businessId)
  const progressRows = workstreams.map(progressFor)
  const rollup = rollupProject(progressRows)
  const progressByWorkstream = new Map(progressRows.map((row) => [row.workstreamId, row]))
  const itemRows = workstreams.flatMap((workstream) => (workstream.items || [])
    .filter((item) => !item.deletedAt)
    .map((item) => ({
      projectId: project.id,
      planId: workstream.id,
      containerId: item.containerId ?? null,
      workItemId: item.id,
      typedId: { key: ITEM_TYPED_IDS[item.subtype] || 'workItemId', value: item.id },
      subtype: item.subtype,
      code: item.code,
      title: item.title,
      status: item.status,
      assignee: assigneeDto(item, roster),
      tags: unavailable('TAGS_NOT_MODELED'),
      startAt: isoDate(item.startAt),
      targetAt: isoDate(item.targetAt),
      criteria: unavailable('CRITERIA_NOT_MODELED'),
      evidence: unavailable('ITEM_EVIDENCE_NOT_MODELED'),
    })))
  const containerRows = workstreams.flatMap((workstream) => (workstream.containers || []).map((container) => ({
    projectId: project.id,
    planId: workstream.id,
    containerId: container.id,
    typedId: { key: CONTAINER_TYPED_IDS[container.subtype] || 'containerId', value: container.id },
    parentContainerId: container.parentId ?? null,
    subtype: container.subtype,
    code: container.code,
    title: container.title,
    startAt: isoDate(container.startAt),
    targetAt: isoDate(container.targetAt),
    status: container.status,
    progressEvidence: unavailable('CONTAINER_PROGRESS_NOT_MODELED'),
    closure: containerClosure(container, itemRows),
  })))
  const plans = workstreams.map((workstream) => {
    const progress = progressByWorkstream.get(workstream.id)
    const vocabulary = MODE_VOCABULARY[workstream.executionMode] || { containers: [], items: [] }
    return {
      projectId: project.id,
      planId: workstream.id,
      planCode: workstream.code,
      name: workstream.name,
      executionModeId: workstream.executionMode,
      executionContractId: EXECUTION_CONTRACT_IDS[workstream.executionMode] || null,
      displayVocabulary: vocabulary,
      progressStrategy: workstream.progressStrategy,
      progressWeight: Number(workstream.progressWeight),
      status: workstream.status,
      startAt: isoDate(workstream.startAt),
      targetAt: isoDate(workstream.targetAt),
      currentContainerId: currentContainer(workstream),
      progress: {
        percent: progress?.percent ?? 0,
        totalWeight: Number(workstream.progressWeight),
        formula: progress?.evidence?.formula || null,
        evidence: progress?.evidence || {},
        warnings: progress?.warnings || [],
      },
    }
  })
  const allItems = workstreams.flatMap((workstream) => (workstream.items || []))
  const counts = statusCounts(allItems)
  const dependencyItems = dependencyRows(dependencyGraph)
  const gateRows = gates.length ? gates : workstreams.flatMap((workstream) => workstream.gates || [])
  const deadline = deadlineState(project.targetAt, now, project.status)
  const summary = { ...counts, deadlineState: deadline }

  return zProjectRoadmapResponse.parse({
    readModel: 'EXECUTION_ROADMAP',
    schemaVersion: EXECUTION_ROADMAP_VERSION,
    project: {
      id: project.id,
      code: project.code,
      name: project.name,
      outcome: project.description ?? null,
      businessId: project.businessId ?? null,
      goalIds: authorizedGoals.map((goal) => goal.id),
      riskIds: [],
      status: project.status,
      startAt: isoDate(project.startAt),
      targetAt: isoDate(project.targetAt),
      accountableOwner: unavailable('PROJECT_ACCOUNTABILITY_NOT_MODELED'),
      progress: {
        percent: rollup.percent,
        totalWeight: rollup.totalWeight,
        formula: rollup.formula || null,
        evidence: { workstreams: progressRows.map((row) => row.workstreamId) },
        warnings: rollup.warnings,
      },
    },
    goals: authorizedGoals.map((goal) => ({
      id: goal.id,
      businessId: goal.businessId,
      code: goal.code,
      title: goal.title,
      description: goal.description ?? null,
      status: goal.status,
      priority: goal.priority,
      progress: Number(goal.progress),
      startAt: isoDate(goal.startAt),
      targetAt: isoDate(goal.targetAt),
    })),
    risks: { status: 'UNAVAILABLE', items: [], reasonCode: 'RISK_MODEL_NOT_AVAILABLE' },
    plans,
    containers: containerRows,
    items: itemRows,
    dependencies: {
      status: dependencyItems.length ? 'READY' : 'EMPTY',
      items: dependencyItems,
      reasonCode: null,
    },
    roster: {
      status: roster.length ? 'READY' : 'EMPTY',
      items: roster.map((row) => ({ personId: row.person.id, displayName: row.person.displayName, role: row.role })),
      reasonCode: null,
    },
    sources: unavailable('NO_APPROVED_SOURCE'),
    closure: {
      status: 'READY',
      summary: { completed: counts.completed, open: counts.open, blocked: counts.blocked, carryOver: null },
      decision: unavailable('CLOSURE_DECISION_NOT_MODELED'),
      gates: gateRows.map(gateDto),
    },
    identityRefs: unavailable('SUPPORTING_IDENTITIES_NOT_MODELED'),
    summary,
    meta: {
      generatedAt: new Date(now).toISOString(),
      readScope,
      warnings: [
        'Business Goals are read-only projections owned by Business Strategy.',
        'Risk, tags, criteria, source and closure decision data are explicit unavailable fields until their owning contracts exist.',
      ],
    },
  })
}

export async function assertProjectRoadmapReadable(viewer, project, { db = prisma } = {}) {
  requireViewer(viewer, 'assertProjectRoadmapReadable')
  if (!project || project.deletedAt) throw projectNotFound()
  if (project.businessId) {
    if (!seesBusiness(viewer, project.businessId)) throw projectNotFound()
    if (project.workspace?.scopeType === 'BUSINESS' && project.workspace.businessId !== project.businessId) throw projectNotFound()
    const tenantId = project.business?.tenantId || project.workspace?.tenantId || null
    if (!tenantId || (project.workspace?.tenantId && project.workspace.tenantId !== tenantId)) throw projectNotFound()
    return { readScope: 'BUSINESS', tenantId }
  }
  const workspace = project.workspace
  if (!workspace || !['TENANT', 'PORTFOLIO'].includes(workspace.scopeType) || !workspace.tenantId) throw projectNotFound()
  if (viewer.isPlatform === true) return { readScope: 'PLATFORM', tenantId: workspace.tenantId }
  const visibleBusinessIds = Array.isArray(viewer.visibleBusinessIds) ? viewer.visibleBusinessIds : []
  if (!visibleBusinessIds.length) throw projectNotFound()
  const where = workspace.scopeType === 'TENANT'
    ? { id: { in: visibleBusinessIds }, tenantId: workspace.tenantId }
    : { id: { in: visibleBusinessIds }, tenant: { portfolioId: workspace.portfolioId } }
  if (!(await db.business.count({ where }))) throw projectNotFound()
  return { readScope: `${workspace.scopeType}_SHARED`, tenantId: workspace.tenantId }
}

export async function getProjectRoadmap(projectId, { db = prisma, viewer, now = new Date() } = {}) {
  if (!projectId) throw new Error('projectId is required')
  const read = async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      include: {
        business: { select: { id: true, tenantId: true } },
        workspace: { select: { id: true, scopeType: true, businessId: true, tenantId: true, portfolioId: true } },
        goalLinks: {
          orderBy: { createdAt: 'asc' },
          include: { goal: true },
        },
      },
    })
    const scope = await assertProjectRoadmapReadable(viewer, project, { db: tx })
    const workstreams = await tx.workstream.findMany({
      where: { projectId, ...activeWorkstream() },
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
      include: {
        containers: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        items: { where: { deletedAt: null }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }] },
        milestones: { orderBy: [{ targetAt: 'asc' }, { code: 'asc' }] },
        gates: { orderBy: [{ targetAt: 'asc' }, { code: 'asc' }] },
      },
    })
    const [milestones, gates] = await Promise.all([
      tx.milestone.findMany({
        where: { projectId },
        orderBy: [{ targetAt: 'asc' }, { code: 'asc' }],
      }),
      tx.gate.findMany({
        where: { projectId },
        orderBy: [{ targetAt: 'asc' }, { code: 'asc' }],
      }),
    ])
    const memberships = await tx.membership.findMany({
      where: project.businessId
        ? { tenantId: scope.tenantId, OR: [{ businessId: project.businessId }, { businessId: null }] }
        : { tenantId: scope.tenantId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { person: { select: { id: true, displayName: true } } },
    })
    const entityKeys = new Set([
      `PROJECT:${project.id}`,
      ...workstreams.map((row) => `WORKSTREAM:${row.id}`),
      ...workstreams.flatMap((row) => (row.containers || []).map((child) => `WORK_CONTAINER:${child.id}`)),
      ...workstreams.flatMap((row) => (row.items || []).map((child) => `WORK_ITEM:${child.id}`)),
      ...milestones.map((row) => `MILESTONE:${row.id}`),
      ...gates.map((row) => `GATE:${row.id}`),
    ])
    const dependencies = await tx.dependency.findMany({
      where: dependencyWhere(entityKeys),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    const dependencyGraph = buildDependencyGraph(project, workstreams, milestones, gates, dependencies)
    return buildProjectRoadmapReadModel({
      project,
      goals: project.goalLinks.map((link) => link.goal),
      workstreams,
      gates,
      dependencyGraph,
      roster: memberships,
      readScope: scope.readScope,
      now,
    })
  }
  return typeof db.$transaction === 'function' ? db.$transaction(read) : read(db)
}
