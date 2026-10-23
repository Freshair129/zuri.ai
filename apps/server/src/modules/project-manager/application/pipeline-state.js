import { PIPELINE_ORDERING_DEPENDENCY_TYPES } from '@/lib/validation/enums'
// @req FR-084 — provider-neutral state, complete read sets and shared graph rules.
// @spec ADR-035, BR-017, SDD-046
// @tested tests/integration/plan-delta.test.js
import { Prisma } from '@prisma/client'
import { createHash } from 'node:crypto'
import { canonicalJSON, entityHash, handoffHash, handoffContractState, readStoredHandoff } from './handoff-contract'
import { pipelineError } from './pipeline-transaction'
import { wouldCreateCycle } from './dependency-service'
import { calculateWorkstreamProgress } from '../progress/strategies'
import { rollupProject } from '../progress/rollup'

export const PIPELINE_MODELS = Object.freeze({ PROJECT: 'project', WORKSTREAM: 'workstream', WORK_CONTAINER: 'workContainer', WORK_ITEM: 'workItem', MILESTONE: 'milestone', GATE: 'gate', DEPENDENCY: 'dependency' })
export const pipelineKey = (type, id) => type + ':' + id
export const orderPipelineRows = (a, b) => a.type < b.type ? -1 : a.type > b.type ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
export const clonePipelineValue = value => JSON.parse(canonicalJSON(value))

export function assertPipelineProgress(state, projectIds) {
  const rows = [...state.values()]
  const parse = value => { try { return JSON.parse(value || '{}') } catch { return {} } }
  for (const projectId of projectIds) {
    const results = []
    for (const entry of rows.filter(entry => entry.type === 'WORKSTREAM' && entry.row.projectId === projectId && !entry.row.deletedAt && entry.row.status !== 'ARCHIVED')) {
      const ws = entry.row
      const children = type => rows.filter(entry => entry.type === type && entry.row.workstreamId === ws.id && !entry.row.deletedAt).map(entry => entry.row)
      const result = calculateWorkstreamProgress(ws.progressStrategy, {
        workstream: ws, viewConfig: parse(ws.viewConfigJson),
        items: children('WORK_ITEM').map(row => ({ ...row, metrics: parse(row.metricDataJson), metadata: parse(row.metadataJson) })),
        containers: children('WORK_CONTAINER'), milestones: children('MILESTONE'),
        gates: children('GATE').map(row => ({ ...row, evidence: parse(row.evidenceJson) })),
      }, { strictFinite: true })
      results.push({ ...ws, percent: result.percent })
    }
    rollupProject(results, { strictFinite: true })
  }
}
export function pipelineUUID(name) {
  const bytes = createHash('sha1').update(Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex')).update(name).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 15) | 80
  bytes[8] = (bytes[8] & 63) | 128
  const hex = bytes.toString('hex')
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
}
export function pipelineProposedRow(type, data) {
  const name = PIPELINE_MODELS[type]
  const model = Prisma.dmmf.datamodel.models.find(model => model.name.toLowerCase() === name.toLowerCase())
  const row = {}
  for (const field of model.fields.filter(field => field.kind !== 'object')) {
    if (Object.hasOwn(data, field.name)) row[field.name] = data[field.name]
    else if (!field.isRequired || field.type === 'DateTime' || (field.default && typeof field.default === 'object')) row[field.name] = null
    else if (field.hasDefaultValue) row[field.name] = field.default
    else throw pipelineError('INVALID_ENVELOPE', 400)
  }
  return row
}
export async function readPipelineState(tx) {
  const result = new Map()
  for (const [type, delegate] of Object.entries(PIPELINE_MODELS)) {
    for (const row of await tx[delegate].findMany({ orderBy: { id: 'asc' } })) result.set(pipelineKey(type, row.id), { type, id: row.id, row: clonePipelineValue(row) })
  }
  return result
}
export function pipelineRecord(state, reference) {
  const record = reference && state.get(pipelineKey(reference.type, reference.id))
  if (!record || record.row.deletedAt) throw pipelineError('SCOPE_UNAVAILABLE', 404)
  return record.row
}
export function pipelineProjectId(state, reference) {
  const row = pipelineRecord(state, reference)
  if (reference.type === 'PROJECT') return row.id
  if (row.projectId) return row.projectId
  return pipelineRecord(state, { type: 'WORKSTREAM', id: row.workstreamId }).projectId
}
export function pipelineDescendants(state, reference) {
  const root = pipelineRecord(state, reference)
  const result = []
  for (const entry of state.values()) {
    if (entry.type === 'DEPENDENCY' || entry.type === 'PROJECT' || entry.row.deletedAt || entry.id === root.id) continue
    let included = false
    if (reference.type === 'PROJECT') {
      try { included = pipelineProjectId(state, entry) === root.id } catch { continue }
    }
    if (reference.type === 'WORKSTREAM') included = entry.row.workstreamId === root.id
    if (reference.type === 'WORK_CONTAINER') {
      let parent = entry.type === 'WORK_CONTAINER' ? entry.row.parentId : entry.type === 'WORK_ITEM' ? entry.row.containerId : null
      const visited = new Set()
      while (parent) {
        if (visited.has(parent)) throw pipelineError('INVALID_PARENT')
        visited.add(parent)
        if (parent === root.id) { included = true; break }
        parent = state.get(pipelineKey('WORK_CONTAINER', parent))?.row.parentId
      }
    }
    if (included) result.push(entry)
  }
  return result.sort(orderPipelineRows)
}
export function pipelineSubtreeHash(state, reference) {
  const root = pipelineRecord(state, reference)
  return handoffHash('pm-subtree:v1', { root: { type: reference.type, id: root.id, hash: entityHash(reference.type, root) }, descendants: pipelineDescendants(state, reference).map(entry => ({ type: entry.type, id: entry.id, hash: entityHash(entry.type, entry.row) })) })
}

export function pipelineReadRows(state, projectIds, proposedContracts = new Map()) {
  const keys = new Set()
  const add = reference => {
    if (!reference) return
    const key = pipelineKey(reference.type, reference.id), entry = state.get(key)
    if (!entry || keys.has(key)) return
    keys.add(key)
    const row = entry.row
    if (reference.type !== 'PROJECT' && reference.type !== 'DEPENDENCY') {
      if (row.workstreamId) add({ type: 'WORKSTREAM', id: row.workstreamId })
      if (row.projectId) add({ type: 'PROJECT', id: row.projectId })
      if (row.containerId || row.parentId) add({ type: 'WORK_CONTAINER', id: row.containerId || row.parentId })
    }
  }
  for (const id of projectIds) {
    add({ type: 'PROJECT', id })
    try { for (const entry of pipelineDescendants(state, { type: 'PROJECT', id })) add(entry) } catch { /* new Bundle project */ }
  }
  for (const entry of state.values()) {
    if (entry.type !== 'DEPENDENCY') continue
    const direction = pipelineOrdering(entry.row)
    if (direction) for (const reference of [direction.predecessor, direction.successor]) {
      add(reference)
      try { for (const item of pipelineItems(state, reference)) add({ type: 'WORK_ITEM', id: item.id }) } catch { /* dangling requires audit locator */ }
    }
    const contract = proposedContracts.get(entry.id) || readStoredHandoff(entry.row.contractJson)
    if (contract?.acceptance.kind === 'GATE' && direction) { try { if (projectIds.includes(pipelineProjectId(state,direction.successor))) add({type:'GATE',id:contract.acceptance.gateId}) } catch { /* no authorized acceptance read */ } }
  }
  for (const contract of proposedContracts.values()) if (contract.acceptance.kind === 'GATE') add({ type: 'GATE', id: contract.acceptance.gateId })
  return [...state.values()].filter(entry => entry.type === 'DEPENDENCY' || keys.has(pipelineKey(entry.type, entry.id)))
}

export function pipelineReleaseScopes(state, projectIds) {
  const scopes = []
  for (const entry of state.values()) {
    if (entry.type !== 'DEPENDENCY' || entry.row.contractJson === null) continue
    const direction = pipelineOrdering(entry.row)
    if (!direction) continue
    try {
      const predecessorProjectId = pipelineProjectId(state, direction.predecessor), successorProjectId = pipelineProjectId(state, direction.successor)
      if (!projectIds.includes(predecessorProjectId) || !projectIds.includes(successorProjectId)) continue
      scopes.push({ dependencyId: entry.id, predecessorProjectId, successorProjectId, predecessor: direction.predecessor, successor: direction.successor, successorItemIds: pipelineItems(state, direction.successor).map(row => row.id).sort() })
    } catch { /* preserve the last accepted locator; never replace it with an empty one */ }
  }
  return scopes.sort((a, b) => a.dependencyId.localeCompare(b.dependencyId))
}

export async function assertPipelineEndpointRetained(tx, reference) {
  const state = await readPipelineState(tx)
  const references = [reference, ...pipelineDescendants(state, reference)]
  const keys = new Set(references.map(entry => pipelineKey(entry.type, entry.id)))
  if ([...state.values()].some(entry => entry.type === 'DEPENDENCY' && entry.row.contractJson !== null && (keys.has(pipelineKey(entry.row.sourceType, entry.row.sourceId)) || keys.has(pipelineKey(entry.row.targetType, entry.row.targetId))))) throw pipelineError('CONTRACT_CONFLICT', 409)
}
export function pipelineItems(state, reference) {
  const row = pipelineRecord(state, reference)
  if (reference.type === 'WORK_ITEM') return [row]
  if (reference.type === 'GATE' || reference.type === 'MILESTONE') reference = row.workstreamId ? { type: 'WORKSTREAM', id: row.workstreamId } : { type: 'PROJECT', id: row.projectId }
  return pipelineDescendants(state, reference).filter(entry => entry.type === 'WORK_ITEM').map(entry => entry.row)
}
export function pipelineOrdering(edge) {
  let predecessor = { type: edge.sourceType, id: edge.sourceId }, successor = { type: edge.targetType, id: edge.targetId }
  if (edge.dependencyType === 'REQUIRES') [predecessor, successor] = [successor, predecessor]
  return PIPELINE_ORDERING_DEPENDENCY_TYPES.includes(edge.dependencyType) ? { predecessor, successor } : null
}
export async function validatePipelineGraph(before, after, changed) {
  const edges = [...after.values()].filter(entry => entry.type === 'DEPENDENCY').map(entry => entry.row)
  for (const change of changed.filter(change => change.type === 'DEPENDENCY' && change.action === 'CREATE')) {
    const edge = after.get(pipelineKey('DEPENDENCY', change.id)).row
    if (edge.sourceType === edge.targetType && edge.sourceId === edge.targetId) throw pipelineError('SELF_DEPENDENCY')
    if (await wouldCreateCycle(edge.sourceType, edge.sourceId, edge.targetType, edge.targetId, { edges: edges.filter(row => row.id !== edge.id) })) throw pipelineError('CYCLE')
  }
  // Each ordering edge is a virtual scope node. source-item -> scope -> target-item
  // is exactly the Cartesian precedence relation, with linear memory instead of
  // materializing |source| * |target| rows. Reuse the owning reachability checker.
  const adjacency = new Map(), checks = []
  const add = (a, b) => { if (!adjacency.has(a)) adjacency.set(a, []); adjacency.get(a).push(b) }
  for (const edge of edges) {
    const direction = pipelineOrdering(edge)
    if (!direction) continue
    let source, target
    try { source = pipelineItems(after, direction.predecessor); target = pipelineItems(after, direction.successor) } catch { continue }
    let previousSource=[],previousTarget=[]
    try { previousSource=pipelineItems(before,direction.predecessor);previousTarget=pipelineItems(before,direction.successor) } catch { /* newly resolved scope */ }
    const ids = rows => rows.map(row=>row.id).sort().join(',')
    const affected = changed.some(change => change.id === edge.id) || ids(source)!==ids(previousSource) || ids(target)!==ids(previousTarget)
    const targetIds = new Set(target.map(row => row.id))
    if (source.some(row => targetIds.has(row.id))) {
      if (affected) throw pipelineError('REFLEXIVE_SCOPE')
      continue
    }
    if (affected && new Set([...source, ...target].map(row => row.id)).size > 2000) throw pipelineError('GRAPH_LIMIT')
    const virtual = 'PIPELINE_SCOPE:' + edge.id
    for (const row of source) add('WORK_ITEM:' + row.id, virtual)
    for (const row of target) add(virtual, 'WORK_ITEM:' + row.id)
    if (affected) checks.push({ edge, target })
  }
  for (const { edge, target } of checks) for (const row of target) {
    if (await wouldCreateCycle('PIPELINE_SCOPE', edge.id, 'WORK_ITEM', row.id, { adjacency })) throw pipelineError('CYCLE')
  }
}

export async function pipelineReleaseState(state, itemId, { tx, allowedProjectIds, audits = [], proposedContracts = new Map(), protectedStatus } = {}) {
  const blockers = []
  for (const entry of state.values()) {
    if (entry.type !== 'DEPENDENCY') continue
    const edge = entry.row, direction = pipelineOrdering(edge)
    if (!direction || edge.contractJson === null || (protectedStatus && protectedStatus !== 'DONE' && edge.dependencyType === 'FINISH_BEFORE')) continue
    let successors
    try { successors = pipelineItems(state, direction.successor) } catch {
      const locator = [...audits].sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt)).flatMap(audit => { try { return JSON.parse(audit.payloadJson).releaseScopes || [] } catch { return [] } }).find(scope => scope.dependencyId === edge.id)
      if (locator?.successorItemIds.includes(itemId) || (direction.successor.type === 'WORK_ITEM' && direction.successor.id === itemId)) return { held: true, blockers: [], truncated: false, restricted: true }
      continue
    }
    if (!successors.some(row => row.id === itemId)) continue
    let predecessor
    try {
      if (!allowedProjectIds.includes(pipelineProjectId(state, direction.predecessor))) return { held: true, blockers: [], truncated: false, restricted: true }
      predecessor = pipelineRecord(state, direction.predecessor)
    } catch { return { held: true, blockers: [], truncated: false, restricted: true } }
    const contract = readStoredHandoff(edge.contractJson)
    const acceptance = contract?.acceptance
    const gate = acceptance?.kind === 'GATE' ? state.get(pipelineKey('GATE', acceptance.gateId))?.row : null
    const actor = acceptance?.kind === 'MANUAL' ? await tx.person.findUnique({ where: { id: acceptance.actorPersonId } }) : null
    const audit = acceptance?.kind === 'MANUAL' ? audits.find(row => row.id === acceptance.decisionAuditEventId) : null
    const proposed = proposedContracts.get(edge.id)
    let status = proposed?.acceptance.kind === 'MANUAL'
      ? proposed.acceptance.satisfied ? 'SATISFIED' : 'DECLARED'
      : handoffContractState(edge.contractJson, { gate, actor, audit, dependency: edge })
    if (acceptance?.kind === 'GATE' && gate && (gate.projectId !== pipelineProjectId(state, direction.predecessor) || (gate.workstreamId && predecessor.workstreamId !== gate.workstreamId && !(direction.predecessor.type === 'WORKSTREAM' && predecessor.id === gate.workstreamId)))) status = 'INVALID'
    if (audit) {
      let validBusiness = false
      const endpointProjects=[pipelineProjectId(state,{type:edge.sourceType,id:edge.sourceId}),pipelineProjectId(state,{type:edge.targetType,id:edge.targetId})]
      for (const id of endpointProjects) { const project=state.get(pipelineKey('PROJECT',id))?.row; const businessId=project?.businessId || (project?.workspaceId && (await tx.workspace.findUnique({where:{id:project.workspaceId}}))?.businessId); if (businessId === audit.businessId) validBusiness=true }
      if (!validBusiness) status='INVALID'
    }
    if (status === 'DECLARED' || status === 'INVALID') blockers.push({ dependencyId: edge.id, predecessor: { ...direction.predecessor, label: predecessor.title || predecessor.name || predecessor.code, href: '/projects/' + pipelineProjectId(state, direction.predecessor) + '/board' }, state: status, reason: status === 'INVALID' ? 'EVIDENCE_UNAVAILABLE' : 'UNSATISFIED' })
  }
  blockers.sort((a, b) => a.dependencyId.localeCompare(b.dependencyId))
  return { held: blockers.length > 0, blockers: blockers.slice(0, 100), truncated: blockers.length > 100, restricted: false }
}
