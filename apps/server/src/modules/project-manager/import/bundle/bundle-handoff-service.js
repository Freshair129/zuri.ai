import { isPipelineReceiptConflict } from '../../application/pipeline-writer'
import { PIPELINE_PROTECTED_WORK_STATUSES } from '@/lib/validation/enums'
import { resolveEntityIdentity } from '../external-ref'
// @req FR-084 — Bundle1.1 preserves the existing bundle receipt and full-plan lane.
// @spec ADR-035, SDD-046, BR-017
// @tested tests/integration/pipeline-bundle-handoff.test.js
import prisma from '@/lib/db'
import { randomUUID } from 'node:crypto'
import { zHandoffExecutionPlanBundle } from './bundle-schema'
import { dryRunLegacyBundle } from './bundle-dry-run'
import { commitLegacyBundle } from './bundle-commit-service'
import { commitPlan } from '../plan-import-service'
import { createPipelinePreviewDb } from '../pipeline-preview-db'
import { catalogue, checkCatalogue, pipelineChanges, pipelineAggregateHash, validatePipelineHandoff, requirePipelineHash } from '../plan-delta-operations'
import { pipelineFailure, invalidPipelineEnvelope } from '../plan-delta-service'
import { withPipelineTransaction, resolvePipelineBusinessAuthority, resolvePipelineAuthority, pipelineError, pipelineTransactionFacade } from '../../application/pipeline-transaction'
import { canonicalJSON, handoffHash, readStoredHandoff, entityHash, persistHandoffContract } from '../../application/handoff-contract'
import { readPipelineState, pipelineReadRows, pipelineReleaseState, pipelineKey, pipelineUUID, clonePipelineValue, validatePipelineGraph, assertPipelineProgress } from '../../application/pipeline-state'

const typeByKind = { project: 'PROJECT', workstream: 'WORKSTREAM', container: 'WORK_CONTAINER', item: 'WORK_ITEM', milestone: 'MILESTONE', gate: 'GATE' }
const codeEntries = plan => [{ type: 'PROJECT', entity: plan.project }, ...plan.workstreams.flatMap(ws => [{ type: 'WORKSTREAM', entity: ws }, ...(ws.containers || []).map(entity => ({ type: 'WORK_CONTAINER', entity })), ...(ws.items || []).map(entity => ({ type: 'WORK_ITEM', entity })), ...(ws.milestones || []).map(entity => ({ type: 'MILESTONE', entity })), ...(ws.gates || []).map(entity => ({ type: 'GATE', entity }))])]
const clientShape = contract => contract?.acceptance.kind === 'MANUAL' ? { ...contract, acceptance: { kind: 'MANUAL', satisfied: contract.acceptance.satisfied } } : contract
function parse(raw) {
  if (Buffer.byteLength(JSON.stringify(raw) || '') > 1024 * 1024) throw pipelineError('PAYLOAD_LIMIT', 413)
  const parsed = zHandoffExecutionPlanBundle.safeParse(raw)
  if (!parsed.success) throw invalidPipelineEnvelope(parsed.error)
  return parsed.data
}
function bundlePayloadHash(bundle, actorPersonId) {
  const { expectedPreviewHash, ...normalized } = bundle
  return handoffHash('pm-bundle-payload:v1', { actorPersonId, bundle: normalized })
}
async function authorize(tx, bundle, viewer, settings) {
  const code = bundle?.scope?.businessCode
  if (typeof code !== 'string' || !code) throw pipelineError('SCOPE_UNAVAILABLE', 404)
  const business = await tx.business.findUnique({ where: { code } })
  if (!business) throw pipelineError('SCOPE_UNAVAILABLE', 404)
  return resolvePipelineBusinessAuthority(tx, business.id, viewer, settings)
}
async function prepare(tx, bundle, authority) {
  // Every nested 1.2 plan claims the same global receipt namespace as its root.
  const keys = [bundle.trace.idempotencyKey, ...bundle.projects.filter(entry => entry.plan.schemaVersion === '1.2').map(entry => entry.plan.trace?.idempotencyKey).filter(Boolean)]
  if (new Set(keys).size !== keys.length) throw pipelineError('IDEMPOTENCY_CONFLICT', 409)
  checkCatalogue()
  const base = await dryRunLegacyBundle(bundle, { db: tx, viewer: authority.viewer })
  if (!base.valid) throw pipelineError(base.errors.some(error => String(error).includes('CONTRACT_REQUIRED')) ? 'CONTRACT_REQUIRED' : 'INVALID_ENVELOPE')
  const before = await readPipelineState(tx)
  const state = new Map([...before].map(([key, entry]) => [key, clonePipelineValue(entry)]))
  const virtual = createPipelinePreviewDb(tx, state), allocations = {}, projectIdsByRef = {}, resolutions = [], seen = new Set()
  const actor = authority.viewer.principal.id, idempotency = bundle.trace.idempotencyKey
  for (const entry of bundle.projects) {
    const perProject = {}
    for (const { type, entity } of codeEntries(entry.plan)) {
      const key = type + ':' + entity.code
      if (seen.has(key)) throw pipelineError('INVALID_ENVELOPE', 400)
      seen.add(key)
      const decided = base.projects.find(project => project.bundleProjectRef === entry.bundleProjectRef)
      const kind = Object.keys(typeByKind).find(kind => typeByKind[kind] === type)
      const identity = await resolveEntityIdentity({ kind, code: entity.code, externalRefs: entity.externalRefs }, tx)
      const existing = identity.entityId ? before.get(pipelineKey(type, identity.entityId)) : [...before.values()].find(row => row.type === type && row.row.code === entity.code)
      const encoded = Buffer.from(canonicalJSON({ bundleProjectRef: entry.bundleProjectRef, type, code: entity.code })).toString('base64url')
      const id = existing?.id || pipelineUUID(type === 'PROJECT' ? `zuri.pm.bundle.v1/${actor}/${idempotency}/${entry.bundleProjectRef}` : `zuri.pm.bundle.entity.v1/${actor}/${idempotency}/${encoded}`)
      perProject[key] = id
      resolutions.push({ type, code: entity.code, id: existing?.id || null })
      if (type === 'PROJECT') projectIdsByRef[entry.bundleProjectRef] = id
      if (!decided?.valid) throw pipelineError('SCOPE_UNAVAILABLE', 404)
    }
    allocations[entry.bundleProjectRef] = perProject
    const result = await commitPlan(entry.plan, { db: virtual, viewer: authority.viewer, workspaceId: base.projects.find(project => project.bundleProjectRef === entry.bundleProjectRef).workspaceId, allocatedEntityIds: perProject, traceSourceKind: 'BUNDLE' })
    if (!result.committed) throw pipelineError('INVALID_ENVELOPE', 400)
  }
  const projectIds = Object.values(projectIdsByRef).sort(), edges = new Map(), proposedContracts = new Map(), tuples = new Set()
  for (const dependency of bundle.dependencies) {
    const tuple = { sourceProjectRef: dependency.sourceProjectRef, targetProjectRef: dependency.targetProjectRef, relation: dependency.relation }
    const encoded = Buffer.from(canonicalJSON(tuple)).toString('base64url')
    if (tuples.has(encoded)) throw pipelineError('INVALID_ENVELOPE', 400)
    tuples.add(encoded)
    const row = { id: pipelineUUID(`zuri.pm.bundle.edge.v1/${actor}/${idempotency}/${encoded}`), sourceType: 'PROJECT', sourceId: projectIdsByRef[dependency.sourceProjectRef], targetType: 'PROJECT', targetId: projectIdsByRef[dependency.targetProjectRef], dependencyType: dependency.relation, createdAt: null, contractJson: null }
    if (!row.sourceId || !row.targetId || row.sourceId === row.targetId) throw pipelineError('INVALID_ENVELOPE', 400)
    if (dependency.contract.acceptance.kind === 'GATE' && !before.has(pipelineKey('GATE', dependency.contract.acceptance.gateId))) throw pipelineError('INVALID_CONTRACT')
    const contract = validatePipelineHandoff(dependency.contract, row, state, projectIds)
    const existing = [...before.values()].find(entry => entry.type === 'DEPENDENCY' && ['sourceType', 'sourceId', 'targetType', 'targetId', 'dependencyType'].every(key => entry.row[key] === row[key]))
    if (existing) {
      const stored=readStoredHandoff(existing.row.contractJson)
      if (existing.row.contractJson !== null && (!stored || canonicalJSON(clientShape(stored)) !== canonicalJSON(contract))) throw pipelineError('CONTRACT_CONFLICT', 409)
      if (existing.row.contractJson === null) {
        const preview=base.preview.dependencies.find(row=>row.sourceProjectRef===dependency.sourceProjectRef && row.targetProjectRef===dependency.targetProjectRef && row.relation===dependency.relation)
        preview.description=[preview.description,'Preserved legacy: contract UNDECLARED'].filter(Boolean).join(' · ')
      }
      edges.set(encoded, { row: existing.row, existed: true })
    } else {
      row.contractJson = canonicalJSON(contract)
      state.set(pipelineKey('DEPENDENCY', row.id), { type: 'DEPENDENCY', id: row.id, row })
      edges.set(encoded, { row, existed: false })
      proposedContracts.set(row.id, contract)
    }
  }
  const changes = pipelineChanges(before, state)
  if (changes.length > 2000 || Buffer.byteLength(canonicalJSON(changes.map(change => ({ before: before.get(pipelineKey(change.type, change.id))?.row || null, after: state.get(pipelineKey(change.type, change.id))?.row || null })))) > 4 * 1024 * 1024) throw pipelineError('GRAPH_LIMIT')
  assertPipelineProgress(state, projectIds)
  await validatePipelineGraph(before, state, changes)
  const all = pipelineReadRows(before, projectIds, proposedContracts)
  const firstProject = state.get(pipelineKey('PROJECT', projectIds[0])).row
  const workspace = await tx.workspace.findUnique({ where: { id: firstProject.workspaceId } })
  const referenced = [...new Set(all.filter(entry => entry.type === 'DEPENDENCY').map(entry => readStoredHandoff(entry.row.contractJson)?.acceptance.decisionAuditEventId).filter(Boolean))]
  const evidence = await tx.auditEvent.findMany({ where: { id: { in: referenced } }, orderBy: { id: 'asc' } })
  for (const change of changes.filter(change=>change.type==='WORK_ITEM')) {
    const row=state.get(pipelineKey(change.type,change.id))?.row, old=before.get(pipelineKey(change.type,change.id))?.row
    if (!row || row.deletedAt || !PIPELINE_PROTECTED_WORK_STATUSES.includes(row.status)) continue
    if (old && old.status===row.status && old.workstreamId===row.workstreamId && old.containerId===row.containerId) continue
    const release=await pipelineReleaseState(state,row.id,{tx,allowedProjectIds:projectIds,audits:evidence,proposedContracts,protectedStatus:row.status})
    if (release.held) throw pipelineError('RELEASE_HELD',409)
  }
  const readSet = { scope: { tenantId: authority.tenant.id, businessId: authority.business.id, workspaceId: workspace.id, projectId: projectIds[0] }, authorityHash: handoffHash('pm-authority:v1', authority.rows), catalogueHash: handoffHash('pm-execution-catalog:v1', catalogue), graph: all.filter(entry => entry.type === 'DEPENDENCY').map(entry => ({ id: entry.id, hash: entityHash(entry.type, entry.row) })), entities: all.filter(entry => !['DEPENDENCY', 'GATE'].includes(entry.type)).map(entry => ({ type: entry.type, id: entry.id, hash: entityHash(entry.type, entry.row) })).sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id)), gates: all.filter(entry => entry.type === 'GATE').map(entry => ({ id: entry.id, hash: entityHash(entry.type, entry.row) })), evidence: evidence.map(row => ({ id: row.id, hash: entityHash('AUDIT_EVENT', clonePipelineValue(row)) })), resolutions: resolutions.sort((a, b) => a.type.localeCompare(b.type) || a.code.localeCompare(b.code)) }
  const payloadHash = bundlePayloadHash(bundle, actor), beforeHash = pipelineAggregateHash(changes, 'before'), proposedAfterHash = pipelineAggregateHash(changes, 'after')
  const previewHash = handoffHash('pm-bundle-preview:v1', { payloadHash, readSetHash: handoffHash('pm-readset:v1', readSet), beforeHash, proposedAfterHash, changes })
  return { base, before, state, allocations, projectIds, projectIdsByRef, edges, proposedContracts, payloadHash, beforeHash, changes, previewHash }
}
export async function dryRunHandoffBundle(raw, { viewer, db = prisma } = {}) {
  try {
    return await withPipelineTransaction(db, async (tx, settings) => {
      const authority = await authorize(tx, raw, viewer, settings)
      const bundle = parse(raw)
      if (bundle.expectedPreviewHash !== null) throw pipelineError('INVALID_ENVELOPE', 400)
      const prepared = await prepare(tx, bundle, authority)
      return { ...prepared.base, previewHash: prepared.previewHash }
    }, { write: false })
  } catch (error) { return pipelineFailure(error, true) }
}
export async function commitHandoffBundle(raw, { viewer, db = prisma } = {}, receiptOnly = false) {
  try {
    return await withPipelineTransaction(db, async (tx, settings) => {
      const authority = await authorize(tx, raw, viewer, { ...settings, write: true })
      const bundle = parse(raw)
      if (!bundle.expectedPreviewHash) throw pipelineError('INVALID_ENVELOPE', 400)
      const payloadHash = bundlePayloadHash(bundle, authority.viewer.principal.id)
      const existing = await tx.planImportReceipt.findUnique({ where: { idempotencyKey: bundle.trace.idempotencyKey } })
      if (existing) {
        if (existing.schemaVersion !== '1.1' || existing.stepKey !== 'bundle.import.commit' || existing.payloadHash !== payloadHash) throw pipelineError('IDEMPOTENCY_CONFLICT', 409)
        const event = await tx.auditEvent.findUnique({ where: { id: existing.auditEventId } })
        let receipt
        try { receipt = JSON.parse(event?.payloadJson || 'null')?.receipt } catch { /* refusal below */ }
        if (!receipt || event.actorId !== authority.viewer.principal.id || event.businessId !== authority.business.id) throw pipelineError('IDEMPOTENCY_CONFLICT', 409)
        await resolvePipelineAuthority(tx, receipt.projects.map(project => project.projectId), authority.viewer, { ...settings, write: true })
        return { committed: true, replay: true, executionRunId: receipt.bundleRunId, receipt, preview: null }
      }
      if(receiptOnly) throw pipelineError('IDEMPOTENCY_CONFLICT',409)
      const prepared = await prepare(tx, bundle, authority)
      requirePipelineHash(bundle.expectedPreviewHash, prepared.previewHash, 'STALE_PREVIEW')
      const context = { ...prepared, actorPersonId: authority.viewer.principal.id, tenantId: authority.tenant.id, auditEventId: randomUUID(), decisionAt: new Date().toISOString() }
      const facade = pipelineTransactionFacade(tx)
      const result = await commitLegacyBundle(bundle, { db: facade, viewer: authority.viewer, handoffContext: context })
      if (!result.committed) throw pipelineError('INVALID_ENVELOPE', 400)
      return result
    })
  } catch (error) {
    if(!receiptOnly && isPipelineReceiptConflict(error)) return commitHandoffBundle(raw,{viewer,db},true)
    return pipelineFailure(error)
  }
}

export async function writeBundleHandoffEdge(tx, dependency, context) {
  const encoded = Buffer.from(canonicalJSON({ sourceProjectRef: dependency.sourceProjectRef, targetProjectRef: dependency.targetProjectRef, relation: dependency.relation })).toString('base64url')
  const entry = context.edges.get(encoded)
  if (entry.existed) return { row: await tx.dependency.findUnique({ where: { id: entry.row.id } }), existed: true }
  const provenance = { actorPersonId: context.actorPersonId, decisionAuditEventId: context.auditEventId, decisionAt: context.decisionAt }
  const data = { ...entry.row, createdAt: context.decisionAt, contractJson: canonicalJSON(persistHandoffContract(dependency.contract, provenance)) }
  return { row: await tx.dependency.create({ data }), existed: false }
}
export async function bundleHandoffReceipt(tx, context) {
  const actual = await readPipelineState(tx), changes = pipelineChanges(context.before, actual)
  const projected = new Map([...actual].map(([key, entry]) => [key, clonePipelineValue(entry)]))
  for (const change of changes) {
    const entry = projected.get(pipelineKey(change.type, change.id))
    if (!entry) continue
    if (change.action === 'CREATE' && Object.hasOwn(entry.row, 'createdAt')) entry.row.createdAt = null
    if (Object.hasOwn(entry.row, 'updatedAt')) entry.row.updatedAt = null
    if (context.proposedContracts.has(change.id)) entry.row.contractJson = canonicalJSON(context.proposedContracts.get(change.id))
  }
  if (canonicalJSON(pipelineChanges(context.before, projected)) !== canonicalJSON(context.changes)) throw pipelineError('STALE_PREVIEW', 409)
  return { version: 1, previewHash: context.previewHash, beforeHash: pipelineAggregateHash(changes, 'before'), afterHash: pipelineAggregateHash(changes, 'after'), changes }
}
