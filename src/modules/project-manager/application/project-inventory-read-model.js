import { z } from 'zod'
import prisma from '@/lib/db'
import { seesBusiness } from '@/modules/identity/viewer-authority'
import { requireViewer } from './project-authorization'
import { activeWorkstream } from './active-filters'
import { safeParse } from './audit'
import { projectDependencyGraph, PROJECT_DEPENDENCY_ENDPOINT_TYPES } from './project-dependency-map'
import { calculateWorkstreamProgress } from '../progress/strategies'
import { rollupProject } from '../progress/rollup'

// @req FR-077 — one authorized, read-only Project Inventory DTO across the
// Project's operational entities, separate from GET /api/projects.
// @spec SDD-045, ADR-034, ADR-012, ADR-014, ADR-016, ADR-017
// @tested tests/unit/project-inventory-read-model.test.js, tests/integration/project-inventory.test.js

export const PROJECT_INVENTORY_VERSION = '1.0'
export const INVENTORY_DEFAULT_LIMIT = 100
export const INVENTORY_MAX_LIMIT = 500

const SECTION_STATES = ['READY', 'EMPTY', 'PARTIAL', 'UNAVAILABLE']
const SHARED_SCOPE_TYPES = new Set(['TENANT', 'PORTFOLIO'])
const endpointType = (value) => {
  if (!PROJECT_DEPENDENCY_ENDPOINT_TYPES.includes(value)) throw new Error('Unsupported dependency endpoint type: ' + value)
  return value
}
const PROJECT_ENDPOINT_TYPE = endpointType('PROJECT')
const WORKSTREAM_ENDPOINT_TYPE = endpointType('WORKSTREAM')
const MILESTONE_ENDPOINT_TYPE = endpointType('MILESTONE')
const GATE_ENDPOINT_TYPE = endpointType('GATE')
const WORK_CONTAINER_ENDPOINT_TYPE = endpointType('WORK_CONTAINER')
const WORK_ITEM_ENDPOINT_TYPE = endpointType('WORK_ITEM')

const optionalLimit = z.preprocess(
  (value) => value === '' || value === undefined ? undefined : value,
  z.coerce.number().int().positive().transform((value) => Math.min(value, INVENTORY_MAX_LIMIT)).optional(),
)

const optionalPage = z.preprocess(
  (value) => value === '' || value === undefined ? undefined : value,
  z.coerce.number().int().positive().optional(),
)

export const zProjectInventoryQuery = z.object({
  page: optionalPage,
  limit: optionalLimit,
}).strict()

export function parseProjectInventoryQuery(query = {}) {
  const parsed = zProjectInventoryQuery.parse(query)
  return {
    page: parsed.page ?? 1,
    limit: parsed.limit ?? INVENTORY_DEFAULT_LIMIT,
  }
}

const isoDate = (value) => value == null ? null : new Date(value).toISOString()
const nullableIsoDate = z.string().datetime().nullable()
const zCollectionStatus = z.enum(SECTION_STATES)

const zCollection = (item) => z.object({
  status: zCollectionStatus,
  items: z.array(item),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  truncated: z.boolean(),
  nextPage: z.number().int().positive().nullable(),
  reasonCode: z.string().nullable(),
}).strict()

const zBusinessContext = z.object({ id: z.string().min(1), code: z.string().min(1), name: z.string().min(1) }).strict()
const zWorkspaceContext = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  scopeType: z.string().min(1),
}).strict()

const zWorkstream = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().min(1),
  executionMode: z.string().min(1),
  progressStrategy: z.string().min(1),
  progressWeight: z.number(),
  status: z.string().min(1),
  createdAt: nullableIsoDate,
  updatedAt: nullableIsoDate,
}).strict()

const zContainer = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  workstreamId: z.string().min(1),
  parentId: z.string().nullable(),
  subtype: z.string().min(1),
  title: z.string().min(1),
  status: z.string().min(1),
  startAt: nullableIsoDate,
  targetAt: nullableIsoDate,
  createdAt: nullableIsoDate,
  updatedAt: nullableIsoDate,
}).strict()

const zWorkItem = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  workstreamId: z.string().min(1),
  containerId: z.string().nullable(),
  subtype: z.string().min(1),
  title: z.string().min(1),
  status: z.string().min(1),
  assigneeRef: z.string().nullable(),
  weight: z.number(),
  numericValue: z.number().nullable(),
  probability: z.number().nullable(),
  startAt: nullableIsoDate,
  targetAt: nullableIsoDate,
  createdAt: nullableIsoDate,
  updatedAt: nullableIsoDate,
}).strict()

const zMilestone = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  projectId: z.string().min(1),
  workstreamId: z.string().nullable(),
  title: z.string().min(1),
  status: z.string().min(1),
  weight: z.number(),
  targetAt: nullableIsoDate,
  completedAt: nullableIsoDate,
  createdAt: nullableIsoDate,
  updatedAt: nullableIsoDate,
}).strict()

const zGate = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  projectId: z.string().min(1),
  workstreamId: z.string().nullable(),
  title: z.string().min(1),
  status: z.string().min(1),
  required: z.boolean(),
  evidencePresent: z.boolean(),
  targetAt: nullableIsoDate,
  createdAt: nullableIsoDate,
  updatedAt: nullableIsoDate,
}).strict()

const zDependencyNode = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  entityId: z.string().min(1),
  code: z.string().nullable(),
  title: z.string().min(1),
  status: z.string().nullable(),
}).strict()

const zDependency = z.object({
  id: z.string().min(1),
  source: zDependencyNode,
  target: zDependencyNode,
  dependencyType: z.string().min(1),
  label: z.string().min(1),
}).strict()

const zFile = z.object({
  source: z.enum(['PROJECT_FILE', 'FILE_ASSET']),
  id: z.string().min(1),
  code: z.string().min(1),
  projectId: z.string().min(1),
  workItemId: z.string().nullable(),
  name: z.string().min(1),
  mime: z.string().min(1),
  size: z.number().int().nonnegative(),
  storageKind: z.string().min(1),
  relativePath: z.string().nullable(),
  externalUrl: z.string().nullable(),
  blobRef: z.string().nullable(),
  sha256: z.string().nullable(),
  state: z.string().min(1),
  createdAt: nullableIsoDate,
  updatedAt: nullableIsoDate,
}).strict()

const zRepository = z.object({
  linkId: z.string().min(1),
  projectId: z.string().min(1),
  role: z.string().min(1),
  pathScope: z.string().nullable(),
  branch: z.string().nullable(),
  repo: z.object({
    id: z.string().min(1),
    code: z.string().min(1),
    provider: z.string().min(1),
    fullName: z.string().nullable(),
    url: z.string().nullable(),
    defaultBranch: z.string().nullable(),
    status: z.string().min(1),
  }).strict(),
}).strict()

const zTeamMember = z.object({
  membershipId: z.string().min(1),
  tenantId: z.string().min(1),
  businessId: z.string().nullable(),
  scope: z.enum(['BUSINESS', 'TENANT']),
  role: z.string().min(1),
  readOnly: z.boolean(),
  activeWorkItems: z.number().int().nonnegative(),
  person: z.object({
    id: z.string().min(1),
    code: z.string().min(1),
    displayName: z.string().min(1),
  }).strict(),
}).strict()

const zActivity = z.object({
  id: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  action: z.string().min(1),
  actorType: z.string().min(1),
  occurredAt: z.string().datetime(),
}).strict()

const zProgressRow = z.object({
  workstreamId: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  executionMode: z.string().min(1),
  progressStrategy: z.string().min(1),
  progressWeight: z.number(),
  percent: z.number(),
  evidence: z.record(z.unknown()),
  warnings: z.array(z.string()),
}).strict()

const zProgress = z.object({
  status: zCollectionStatus,
  rollup: z.object({
    percent: z.number(),
    totalWeight: z.number(),
    formula: z.string().nullable(),
    warnings: z.array(z.string()),
  }).strict(),
  workstreams: z.array(zProgressRow),
}).strict()

const zInventorySections = z.object({
  work: z.object({
    status: zCollectionStatus,
    workstreams: zCollection(zWorkstream),
    containers: zCollection(zContainer),
    items: zCollection(zWorkItem),
  }).strict(),
  milestones: zCollection(zMilestone),
  gates: zCollection(zGate),
  dependencies: zCollection(zDependency).extend({
    scope: z.literal('PROJECT_CONTAINED'),
    version: z.string().min(1),
  }).strict(),
  files: zCollection(zFile),
  repositories: zCollection(zRepository),
  team: zCollection(zTeamMember),
  progress: zProgress,
  activity: zCollection(zActivity),
}).strict()

export const zProjectInventoryResponse = z.object({
  readModel: z.literal('PROJECT_INVENTORY'),
  schemaVersion: z.literal(PROJECT_INVENTORY_VERSION),
  project: z.object({
    id: z.string().min(1),
    code: z.string().min(1),
    name: z.string().min(1),
    description: z.string().nullable(),
    type: z.string().min(1),
    status: z.string().min(1),
    businessId: z.string().nullable(),
    workspaceId: z.string().min(1),
    startAt: nullableIsoDate,
    targetAt: nullableIsoDate,
    business: zBusinessContext.nullable(),
    workspace: zWorkspaceContext.nullable(),
  }).strict(),
  sections: zInventorySections,
  summary: z.object({
    counts: z.object({
      workstreams: z.number().int().nonnegative(),
      containers: z.number().int().nonnegative(),
      workItems: z.number().int().nonnegative(),
      milestones: z.number().int().nonnegative(),
      gates: z.number().int().nonnegative(),
      dependencies: z.number().int().nonnegative(),
      files: z.number().int().nonnegative(),
      repositories: z.number().int().nonnegative(),
      team: z.number().int().nonnegative(),
      activity: z.number().int().nonnegative(),
    }).strict(),
    openRequiredGates: z.number().int().nonnegative(),
    incompleteSections: z.array(z.string()),
  }).strict(),
  meta: z.object({
    generatedAt: z.string().datetime(),
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    readScope: z.enum(['BUSINESS', 'TENANT_SHARED', 'PORTFOLIO_SHARED', 'PLATFORM']),
    warnings: z.array(z.string()),
  }).strict(),
}).strict()

function collectionStatus(items, truncated) {
  if (!items.length) return 'EMPTY'
  return truncated ? 'PARTIAL' : 'READY'
}

/**
 * Paginate a complete, already-authorized array. The caller owns ordering;
 * this function only applies the stable page window and disclosure metadata.
 */
export function paginateCollection(items = [], { page = 1, limit = INVENTORY_DEFAULT_LIMIT } = {}) {
  const source = Array.isArray(items) ? items : []
  const start = (page - 1) * limit
  const visible = source.slice(start, start + limit)
  const truncated = start + visible.length < source.length
  return {
    status: collectionStatus(visible, truncated),
    items: visible,
    page,
    limit,
    truncated,
    nextPage: truncated ? page + 1 : null,
    reasonCode: null,
  }
}

function workstreamDto(workstream) {
  return {
    id: workstream.id,
    code: workstream.code,
    projectId: workstream.projectId,
    name: workstream.name,
    executionMode: workstream.executionMode,
    progressStrategy: workstream.progressStrategy,
    progressWeight: Number(workstream.progressWeight),
    status: workstream.status,
    createdAt: isoDate(workstream.createdAt),
    updatedAt: isoDate(workstream.updatedAt),
  }
}

function containerDto(container) {
  return {
    id: container.id,
    code: container.code,
    workstreamId: container.workstreamId,
    parentId: container.parentId ?? null,
    subtype: container.subtype,
    title: container.title,
    status: container.status,
    startAt: isoDate(container.startAt),
    targetAt: isoDate(container.targetAt),
    createdAt: isoDate(container.createdAt),
    updatedAt: isoDate(container.updatedAt),
  }
}

function workItemDto(item) {
  return {
    id: item.id,
    code: item.code,
    workstreamId: item.workstreamId,
    containerId: item.containerId ?? null,
    subtype: item.subtype,
    title: item.title,
    status: item.status,
    assigneeRef: item.assigneeRef ?? null,
    weight: Number(item.weight),
    numericValue: item.numericValue == null ? null : Number(item.numericValue),
    probability: item.probability == null ? null : Number(item.probability),
    startAt: isoDate(item.startAt),
    targetAt: isoDate(item.targetAt),
    createdAt: isoDate(item.createdAt),
    updatedAt: isoDate(item.updatedAt),
  }
}

function milestoneDto(milestone) {
  return {
    id: milestone.id,
    code: milestone.code,
    projectId: milestone.projectId,
    workstreamId: milestone.workstreamId ?? null,
    title: milestone.title,
    status: milestone.status,
    weight: Number(milestone.weight),
    targetAt: isoDate(milestone.targetAt),
    completedAt: isoDate(milestone.completedAt),
    createdAt: isoDate(milestone.createdAt),
    updatedAt: isoDate(milestone.updatedAt),
  }
}

function gateDto(gate) {
  return {
    id: gate.id,
    code: gate.code,
    projectId: gate.projectId,
    workstreamId: gate.workstreamId ?? null,
    title: gate.title,
    status: gate.status,
    required: Boolean(gate.required),
    evidencePresent: Object.keys(safeParse(gate.evidenceJson, {})).length > 0,
    targetAt: isoDate(gate.targetAt),
    createdAt: isoDate(gate.createdAt),
    updatedAt: isoDate(gate.updatedAt),
  }
}

function fileDto(file) {
  return {
    source: file.source,
    id: file.id,
    code: file.code,
    projectId: file.projectId,
    workItemId: file.workItemId ?? null,
    name: file.name,
    mime: file.mime,
    size: Number(file.size),
    storageKind: file.storageKind,
    relativePath: file.relativePath ?? null,
    externalUrl: file.externalUrl ?? null,
    blobRef: file.blobRef ?? null,
    sha256: file.sha256 ?? null,
    state: file.state || 'ACTIVE',
    createdAt: isoDate(file.createdAt),
    updatedAt: isoDate(file.updatedAt),
  }
}

function repositoryDto(link) {
  return {
    linkId: link.id,
    projectId: link.projectId,
    role: link.role,
    pathScope: link.pathScope ?? null,
    branch: link.branch ?? null,
    repo: {
      id: link.repo.id,
      code: link.repo.code,
      provider: link.repo.provider,
      fullName: link.repo.fullName ?? null,
      url: link.repo.url ?? null,
      defaultBranch: link.repo.defaultBranch ?? null,
      status: link.repo.status,
    },
  }
}

function teamDto(member, projectBusinessId) {
  const businessScoped = Boolean(projectBusinessId && member.businessId === projectBusinessId)
  return {
    membershipId: member.id,
    tenantId: member.tenantId,
    businessId: member.businessId ?? null,
    scope: businessScoped ? 'BUSINESS' : 'TENANT',
    role: member.role,
    readOnly: !businessScoped,
    activeWorkItems: Number(member.activeWorkItems || 0),
    person: {
      id: member.person.id,
      code: member.person.code,
      displayName: member.person.displayName,
    },
  }
}

function activityDto(event) {
  return {
    id: event.id,
    entityType: event.entityType,
    entityId: event.entityId,
    action: event.action,
    actorType: event.actorType,
    occurredAt: isoDate(event.occurredAt),
  }
}

function progressFor(workstreams) {
  const rows = workstreams.map((workstream) => {
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
    const result = calculateWorkstreamProgress(workstream.progressStrategy, bundle)
    return {
      workstreamId: workstream.id,
      code: workstream.code,
      name: workstream.name,
      executionMode: workstream.executionMode,
      progressStrategy: workstream.progressStrategy,
      progressWeight: Number(workstream.progressWeight),
      ...result,
    }
  })
  const rollup = rollupProject(rows)
  return {
    status: rows.length ? 'READY' : 'EMPTY',
    rollup: {
      percent: rollup.percent,
      totalWeight: rollup.totalWeight,
      formula: rollup.formula || null,
      warnings: rollup.warnings,
    },
    workstreams: rows,
  }
}

function dependencyDto(graph) {
  const nodes = new Map((graph?.nodes || []).map((node) => [node.id, {
    id: node.id,
    type: node.type,
    entityId: node.id.slice(node.id.indexOf(':') + 1),
    code: node.code ?? null,
    title: node.title,
    status: node.status ?? null,
  }]))
  return (graph?.edges || []).map((edge) => ({
    id: edge.id,
    source: nodes.get(edge.source),
    target: nodes.get(edge.target),
    dependencyType: edge.dependencyType,
    label: edge.label,
  })).filter((edge) => edge.source && edge.target)
}

function sectionNames(sections) {
  return Object.entries(sections)
    .filter(([, value]) => value.status === 'PARTIAL' || value.status === 'UNAVAILABLE')
    .map(([name]) => name)
}

function projectDto(project) {
  return {
    id: project.id,
    code: project.code,
    name: project.name,
    description: project.description ?? null,
    type: project.type,
    status: project.status,
    businessId: project.businessId ?? null,
    workspaceId: project.workspaceId,
    startAt: isoDate(project.startAt),
    targetAt: isoDate(project.targetAt),
    business: project.business
      ? { id: project.business.id, code: project.business.code, name: project.business.name }
      : null,
    workspace: project.workspace
      ? { id: project.workspace.id, code: project.workspace.code, name: project.workspace.name, scopeType: project.workspace.scopeType }
      : null,
  }

}

/**
 * Pure DTO builder. It accepts only already-authorized source rows and never
 * exposes a Prisma object, raw JSON payload, or content field to the UI.
 */
export function buildProjectInventoryReadModel({
  project,
  workstreams = [],
  milestones = [],
  gates = [],
  dependencyGraph = { version: '1.0', nodes: [], edges: [] },
  files = [],
  repositories = [],
  team = [],
  activity = [],
  activityTotal = activity.length,
  readScope = 'BUSINESS',
  page = 1,
  limit = INVENTORY_DEFAULT_LIMIT,
} = {}) {
  const workstreamRows = workstreams.map(workstreamDto)
  const containerRows = workstreams.flatMap((workstream) => (workstream.containers || []).map(containerDto))
  const itemRows = workstreams.flatMap((workstream) => (workstream.items || []).map(workItemDto))
  const milestoneRows = milestones.map(milestoneDto)
  const gateRows = gates.map(gateDto)
  const dependencyRows = dependencyDto(dependencyGraph)
  const fileRows = files.map(fileDto)
  const repositoryRows = repositories.map(repositoryDto)
  const teamRows = team.map((member) => teamDto(member, project.businessId))
  const activityRows = activity.map(activityDto)

  const workstreamsCollection = paginateCollection(workstreamRows, { page, limit })
  const containersCollection = paginateCollection(containerRows, { page, limit })
  const itemsCollection = paginateCollection(itemRows, { page, limit })
  const work = {
    status: [workstreamsCollection, containersCollection, itemsCollection].some((section) => section.status === 'PARTIAL')
      ? 'PARTIAL'
      : [workstreamsCollection, containersCollection, itemsCollection].some((section) => section.status !== 'EMPTY')
        ? 'READY'
        : 'EMPTY',
    workstreams: workstreamsCollection,
    containers: containersCollection,
    items: itemsCollection,
  }
  const sections = {
    work,
    milestones: paginateCollection(milestoneRows, { page, limit }),
    gates: paginateCollection(gateRows, { page, limit }),
    dependencies: {
      ...paginateCollection(dependencyRows, { page, limit }),
      scope: 'PROJECT_CONTAINED',
      version: dependencyGraph.version || '1.0',
    },
    files: paginateCollection(fileRows, { page, limit }),
    repositories: paginateCollection(repositoryRows, { page, limit }),
    team: paginateCollection(teamRows, { page, limit }),
    progress: progressFor(workstreams),
    activity: paginateCollection(activityRows, { page, limit }),
  }
  const openRequiredGates = gates.filter((gate) => gate.required && !['PASSED', 'WAIVED'].includes(gate.status)).length
  const counts = {
    workstreams: workstreamRows.length,
    containers: containerRows.length,
    workItems: itemRows.length,
    milestones: milestoneRows.length,
    gates: gateRows.length,
    dependencies: dependencyRows.length,
    files: fileRows.length,
    repositories: repositoryRows.length,
    team: teamRows.length,
    activity: activityTotal,
  }
  const warnings = sections.progress.rollup.warnings
  return zProjectInventoryResponse.parse({
    readModel: 'PROJECT_INVENTORY',
    schemaVersion: PROJECT_INVENTORY_VERSION,
    project: projectDto(project),
    sections,
    summary: {
      counts,
      openRequiredGates,
      incompleteSections: sectionNames(sections),
    },
    meta: {
      generatedAt: new Date().toISOString(),
      page,
      limit,
      readScope,
      warnings,
    },
  })
}

function notFound() {
  const error = new Error('Project not found')
  error.status = 404
  return error
}

/**
 * Read authority is intentionally weaker than mutation authority. Business
 * members may read their visible Project; ownerless shared Projects are only
 * readable inside an explicit tenant/portfolio scope and remain read-only.
 */
export async function assertProjectReadable(viewer, project, { db = prisma } = {}) {
  requireViewer(viewer, 'assertProjectReadable')
  if (!project) throw notFound()

  if (project.businessId) {
    if (!seesBusiness(viewer, project.businessId)) throw notFound()
    if (project.workspace?.scopeType === 'BUSINESS' && project.workspace.businessId !== project.businessId) throw notFound()
    const tenantId = project.business?.tenantId || project.workspace?.tenantId || null
    if (!tenantId) throw notFound()
    if (project.workspace?.tenantId && project.workspace.tenantId !== tenantId) throw notFound()
    return { readScope: 'BUSINESS', tenantId }
  }

  const workspace = project.workspace
  if (!workspace || !SHARED_SCOPE_TYPES.has(workspace.scopeType) || !workspace.tenantId) throw notFound()
  if (viewer.isPlatform === true) {
    return { readScope: 'PLATFORM', tenantId: workspace.tenantId }
  }
  const visibleBusinessIds = Array.isArray(viewer.visibleBusinessIds) ? viewer.visibleBusinessIds : []
  if (!visibleBusinessIds.length) throw notFound()
  const where = workspace.scopeType === 'TENANT'
    ? { id: { in: visibleBusinessIds }, tenantId: workspace.tenantId }
    : { id: { in: visibleBusinessIds }, tenant: { portfolioId: workspace.portfolioId } }
  const visibleCount = await db.business.count({ where })
  if (!visibleCount) throw notFound()
  return { readScope: `${workspace.scopeType}_SHARED`, tenantId: workspace.tenantId }
}

function endpointKey(type, id) {
  return `${type}:${id}`
}

function endpointDescription(type, record) {
  if (!record) return null
  return {
    code: record.code || null,
    title: record.title || record.name || record.code || `${type} ${record.id}`,
    status: record.status || null,
  }
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

function buildDependencyGraph(project, workstreams, milestones, gates, dependencies) {
  const endpointRecords = new Map()
  endpointRecords.set(endpointKey(PROJECT_ENDPOINT_TYPE, project.id), project)
  for (const workstream of workstreams) {
    endpointRecords.set(endpointKey(WORKSTREAM_ENDPOINT_TYPE, workstream.id), workstream)
    for (const container of workstream.containers || []) endpointRecords.set(endpointKey(WORK_CONTAINER_ENDPOINT_TYPE, container.id), container)
    for (const item of workstream.items || []) endpointRecords.set(endpointKey(WORK_ITEM_ENDPOINT_TYPE, item.id), item)
  }
  for (const milestone of milestones) endpointRecords.set(endpointKey(MILESTONE_ENDPOINT_TYPE, milestone.id), milestone)
  for (const gate of gates) endpointRecords.set(endpointKey(GATE_ENDPOINT_TYPE, gate.id), gate)

  const entityKeys = new Set(endpointRecords.keys())
  const resolved = dependencies.map((dependency) => ({
    ...dependency,
    source: endpointDescription(dependency.sourceType, endpointRecords.get(endpointKey(dependency.sourceType, dependency.sourceId))),
    target: endpointDescription(dependency.targetType, endpointRecords.get(endpointKey(dependency.targetType, dependency.targetId))),
  }))
  return projectDependencyGraph({ projectId: project.id, dependencies: resolved, entityKeys })
}

function normalizeFiles(project, tenantId, legacy, managed) {
  const managedRows = managed
    .filter((file) => file.businessId === project.businessId && file.tenantId === tenantId)
    .map((file) => ({
      source: 'FILE_ASSET',
      id: file.id,
      code: file.code,
      projectId: file.projectId,
      workItemId: file.workItemId,
      name: file.name,
      mime: file.mime,
      size: file.size,
      storageKind: file.storageKind,
      relativePath: file.relativePath,
      externalUrl: file.externalUrl,
      blobRef: file.blobRef,
      sha256: file.sha256,
      state: file.status,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    }))
  const managedIds = new Set(managedRows.map((file) => file.id))
  const legacyRows = legacy
    .filter((file) => !managedIds.has(file.id))
    .map((file) => ({
      source: 'PROJECT_FILE',
      id: file.id,
      code: file.code,
      projectId: file.projectId,
      workItemId: file.workItemId,
      name: file.name,
      mime: file.mime,
      size: file.size,
      storageKind: 'LEGACY_PROJECT_FILE',
      relativePath: null,
      externalUrl: file.url,
      blobRef: file.blobRef,
      sha256: null,
      state: 'ACTIVE',
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    }))
  return [...managedRows, ...legacyRows]
}

function activityWhere(project, workstreams, milestones, gates, files, dependencies) {
  const entityIds = [
    [PROJECT_ENDPOINT_TYPE, project.id],
    ...workstreams.map((row) => [WORKSTREAM_ENDPOINT_TYPE, row.id]),
    ...workstreams.flatMap((row) => (row.containers || []).map((child) => [WORK_CONTAINER_ENDPOINT_TYPE, child.id])),
    ...workstreams.flatMap((row) => (row.items || []).map((child) => [WORK_ITEM_ENDPOINT_TYPE, child.id])),
    ...milestones.map((row) => [MILESTONE_ENDPOINT_TYPE, row.id]),
    ...gates.map((row) => [GATE_ENDPOINT_TYPE, row.id]),
    ...files.map((row) => [row.source, row.id]),
    ...dependencies.map((row) => ['DEPENDENCY', row.id]),
  ]
  return { OR: entityIds.map(([entityType, entityId]) => ({ entityType, entityId })) }
}

async function readInventorySources(db, project, { page, limit, tenantId }) {
  const [workstreams, milestones, gates, legacyFiles, managedFiles, repositories, memberships] = await Promise.all([
    db.workstream.findMany({
      where: { projectId: project.id, ...activeWorkstream() },
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
      include: {
        containers: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        items: { where: { deletedAt: null }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }] },
        milestones: { orderBy: [{ targetAt: 'asc' }, { code: 'asc' }] },
        gates: { orderBy: [{ targetAt: 'asc' }, { code: 'asc' }] },
      },
    }),
    db.milestone.findMany({
      where: { projectId: project.id },
      orderBy: [{ targetAt: 'asc' }, { code: 'asc' }, { id: 'asc' }],
    }),
    db.gate.findMany({
      where: { projectId: project.id },
      orderBy: [{ targetAt: 'asc' }, { code: 'asc' }, { id: 'asc' }],
    }),
    db.projectFile.findMany({ where: { projectId: project.id }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }] }),
    db.fileAsset.findMany({ where: { projectId: project.id, deletedAt: null }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }] }),
    db.projectRepository.findMany({
      where: { projectId: project.id },
      orderBy: [{ role: 'asc' }, { id: 'asc' }],
      include: { repo: true },
    }),
    db.membership.findMany({
      where: project.businessId
        ? { tenantId, OR: [{ businessId: project.businessId }, { businessId: null }] }
        : { tenantId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { person: { select: { id: true, code: true, displayName: true } } },
    }),
  ])

  const team = await Promise.all(memberships.map(async (membership) => ({
    ...membership,
    activeWorkItems: await db.workItem.count({
      where: {
        deletedAt: null,
        assigneeRef: membership.personId,
        workstream: { projectId: project.id, ...activeWorkstream() },
      },
    }),
  })))
  const files = normalizeFiles(project, tenantId, legacyFiles, managedFiles)
  const entityKeys = new Set([
    endpointKey(PROJECT_ENDPOINT_TYPE, project.id),
    ...workstreams.map((row) => endpointKey(WORKSTREAM_ENDPOINT_TYPE, row.id)),
    ...workstreams.flatMap((row) => (row.containers || []).map((child) => endpointKey(WORK_CONTAINER_ENDPOINT_TYPE, child.id))),
    ...workstreams.flatMap((row) => (row.items || []).map((child) => endpointKey(WORK_ITEM_ENDPOINT_TYPE, child.id))),
    ...milestones.map((row) => endpointKey(MILESTONE_ENDPOINT_TYPE, row.id)),
    ...gates.map((row) => endpointKey(GATE_ENDPOINT_TYPE, row.id)),
  ])
  const dependencies = await db.dependency.findMany({
    where: dependencyWhere(entityKeys),
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  const auditScope = activityWhere(project, workstreams, milestones, gates, files, dependencies)
  const [activity, activityTotal] = await Promise.all([
    db.auditEvent.findMany({
      where: auditScope,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: page * limit + 1,
    }),
    db.auditEvent.count({ where: auditScope }),
  ])

  return {
    workstreams,
    milestones,
    gates,
    dependencyGraph: buildDependencyGraph(project, workstreams, milestones, gates, dependencies),
    files,
    repositories,
    team,
    activity,
    activityTotal,
  }
}

export async function getProjectInventory(projectId, {
  db = prisma,
  viewer,
  page = 1,
  limit = INVENTORY_DEFAULT_LIMIT,
} = {}) {
  if (!projectId) throw new Error('projectId is required')
  const query = parseProjectInventoryQuery({ page, limit })
  const read = async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      include: {
        business: { select: { id: true, code: true, name: true, tenantId: true } },
        workspace: { select: { id: true, code: true, name: true, scopeType: true, businessId: true, tenantId: true, portfolioId: true } },
      },
    })
    const scope = await assertProjectReadable(viewer, project, { db: tx })
    const source = await readInventorySources(tx, project, { ...query, tenantId: scope.tenantId })
    return buildProjectInventoryReadModel({ ...source, project, readScope: scope.readScope, ...query })
  }
  return typeof db.$transaction === 'function' ? db.$transaction(read) : read(db)
}
