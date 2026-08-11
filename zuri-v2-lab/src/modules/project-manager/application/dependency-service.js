import prisma from '@/lib/db'
import { zDependencyInput } from '@/lib/validation/entities'
import { recordAudit } from './audit'

// @req FR-007 — dependencies with self/cycle rejection + blocked evaluation
// @tested tests/integration/project-core.test.js
// Dependencies link domain objects by stable internal IDs.
// Endpoint types: PROJECT, WORKSTREAM, MILESTONE, GATE, WORK_CONTAINER, WORK_ITEM.

const ENDPOINT_MODEL = {
  PROJECT: 'project',
  WORKSTREAM: 'workstream',
  MILESTONE: 'milestone',
  GATE: 'gate',
  WORK_CONTAINER: 'workContainer',
  WORK_ITEM: 'workItem',
}

async function assertEndpointExists(type, id) {
  const model = ENDPOINT_MODEL[type]
  if (!model) throw new Error(`Unsupported dependency endpoint type: ${type}`)
  const found = await prisma[model].findUnique({ where: { id } })
  if (!found) throw new Error(`Dependency endpoint not found: ${type} ${id}`)
  return found
}

const nodeKey = (type, id) => `${type}:${id}`

/**
 * Cycle detection: would adding source -> target create a directed cycle
 * among existing dependency edges? (DFS from target looking for source.)
 */
export async function wouldCreateCycle(sourceType, sourceId, targetType, targetId) {
  const all = await prisma.dependency.findMany({
    select: { sourceType: true, sourceId: true, targetType: true, targetId: true },
  })
  const edges = new Map()
  for (const d of all) {
    const from = nodeKey(d.sourceType, d.sourceId)
    if (!edges.has(from)) edges.set(from, [])
    edges.get(from).push(nodeKey(d.targetType, d.targetId))
  }
  const start = nodeKey(targetType, targetId)
  const goal = nodeKey(sourceType, sourceId)
  const seen = new Set()
  const stack = [start]
  while (stack.length) {
    const node = stack.pop()
    if (node === goal) return true
    if (seen.has(node)) continue
    seen.add(node)
    for (const next of edges.get(node) || []) stack.push(next)
  }
  return false
}

export async function createDependency(input) {
  const data = zDependencyInput.parse(input)
  if (data.sourceType === data.targetType && data.sourceId === data.targetId) {
    throw new Error('Self-dependency is not allowed')
  }
  await assertEndpointExists(data.sourceType, data.sourceId)
  await assertEndpointExists(data.targetType, data.targetId)
  if (await wouldCreateCycle(data.sourceType, data.sourceId, data.targetType, data.targetId)) {
    throw new Error('Dependency would create a cycle')
  }
  const dependency = await prisma.dependency.create({ data })
  await recordAudit(prisma, {
    entityType: 'DEPENDENCY',
    entityId: dependency.id,
    action: 'CREATED',
    payload: data,
  })
  return dependency
}

export async function deleteDependency(id) {
  const dependency = await prisma.dependency.delete({ where: { id } })
  await recordAudit(prisma, { entityType: 'DEPENDENCY', entityId: id, action: 'DELETED' })
  return dependency
}

async function resolveEndpoint(type, id) {
  const model = ENDPOINT_MODEL[type]
  if (!model) return null
  const record = await prisma[model].findUnique({ where: { id } })
  if (!record) return { type, id, code: '(deleted)', title: '(deleted)', status: null }
  return {
    type,
    id,
    code: record.code || null,
    title: record.title || record.name || record.code,
    status: record.status || null,
  }
}

export async function listDependencies({ projectId } = {}) {
  const deps = await prisma.dependency.findMany({ orderBy: { createdAt: 'asc' } })
  const resolved = []
  for (const d of deps) {
    const [source, target] = await Promise.all([
      resolveEndpoint(d.sourceType, d.sourceId),
      resolveEndpoint(d.targetType, d.targetId),
    ])
    resolved.push({ ...d, source, target })
  }
  if (!projectId) return resolved
  // Project filter: keep edges where either endpoint belongs to the project.
  const belongs = await projectEntityIds(projectId)
  return resolved.filter(
    (d) => belongs.has(nodeKey(d.sourceType, d.sourceId)) || belongs.has(nodeKey(d.targetType, d.targetId))
  )
}

async function projectEntityIds(projectId) {
  const [workstreams, milestones, gates] = await Promise.all([
    prisma.workstream.findMany({ where: { projectId }, select: { id: true } }),
    prisma.milestone.findMany({ where: { projectId }, select: { id: true } }),
    prisma.gate.findMany({ where: { projectId }, select: { id: true } }),
  ])
  const wsIds = workstreams.map((w) => w.id)
  const [containers, items] = await Promise.all([
    prisma.workContainer.findMany({ where: { workstreamId: { in: wsIds } }, select: { id: true } }),
    prisma.workItem.findMany({ where: { workstreamId: { in: wsIds } }, select: { id: true } }),
  ])
  const set = new Set([nodeKey('PROJECT', projectId)])
  for (const w of workstreams) set.add(nodeKey('WORKSTREAM', w.id))
  for (const m of milestones) set.add(nodeKey('MILESTONE', m.id))
  for (const g of gates) set.add(nodeKey('GATE', g.id))
  for (const c of containers) set.add(nodeKey('WORK_CONTAINER', c.id))
  for (const i of items) set.add(nodeKey('WORK_ITEM', i.id))
  return set
}

/**
 * Blocked/ready evaluation: an entity is blocked when it is the TARGET of a
 * BLOCKS edge whose source is not DONE/PASSED/WAIVED, or the SOURCE of a
 * REQUIRES edge whose target is not DONE/PASSED/WAIVED.
 */
const SATISFIED_STATUSES = new Set(['DONE', 'PASSED', 'WAIVED', 'COMPLETED'])

export async function evaluateBlocked(type, id) {
  const [asTarget, asSource] = await Promise.all([
    prisma.dependency.findMany({ where: { targetType: type, targetId: id, dependencyType: 'BLOCKS' } }),
    prisma.dependency.findMany({ where: { sourceType: type, sourceId: id, dependencyType: 'REQUIRES' } }),
  ])
  const blockers = []
  for (const d of asTarget) {
    const source = await resolveEndpoint(d.sourceType, d.sourceId)
    if (source && !SATISFIED_STATUSES.has(source.status)) blockers.push(source)
  }
  for (const d of asSource) {
    const target = await resolveEndpoint(d.targetType, d.targetId)
    if (target && !SATISFIED_STATUSES.has(target.status)) blockers.push(target)
  }
  return { blocked: blockers.length > 0, blockers }
}
