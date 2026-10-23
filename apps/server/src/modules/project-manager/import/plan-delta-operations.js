import { domainBindingForMode, EXECUTION_MODE_IDS, EXECUTION_CONTRACT_IDS } from './plan-schema'
// @req FR-084 — prospective domain commands shared by preview and commit.
// @spec ADR-035, SDD-046, BR-017
// @tested tests/integration/plan-delta.test.js
import catalogue from '../../../../contracts/pipeline-execution-catalog.v1.json'
import { EXECUTION_MODE_CONTRACTS, PIPELINE_CHANGE_TYPES, PIPELINE_PROTECTED_WORK_STATUSES } from '@/lib/validation/enums'
import { canonicalJSON, entityHash, handoffHash, readStoredHandoff, zHandoffContractV1 } from '../application/handoff-contract'
import { pipelineError } from '../application/pipeline-transaction'
import { pipelineKey, pipelineRecord, pipelineProjectId, pipelineDescendants, pipelineItems, pipelineOrdering, pipelineUUID, pipelineProposedRow, pipelineSubtreeHash, orderPipelineRows, clonePipelineValue, validatePipelineGraph, assertPipelineProgress, pipelineReleaseState } from '../application/pipeline-state'

export { catalogue }
export function pipelineChanges(before, after) {
  const keys = new Set([...before.keys(), ...after.keys()])
  return [...keys].flatMap(key => {
    const a = before.get(key), b = after.get(key)
    if (a && b && canonicalJSON(a.row) === canonicalJSON(b.row)) return []
    const record = b || a
    return [{ type: record.type, id: record.id, action: !a ? 'CREATE' : !b ? 'DELETE' : 'UPDATE', beforeHash: a ? entityHash(a.type, a.row) : null, afterHash: b ? entityHash(b.type, b.row) : null }]
  }).sort(orderPipelineRows)
}
export const pipelineAggregateHash = (changes, phase) => handoffHash('pm-delta-state:v1', { rows: changes.map(row => ({ type: row.type, id: row.id, hash: row[phase + 'Hash'] })) })
export function requirePipelineHash(expected, actual, code = 'STALE_ENTITY') {
  if (expected !== actual) throw pipelineError(code, 409, [{ code, path: '', expectedHash: expected, actualHash: actual }])
}

export function checkCatalogue() {
  if (canonicalJSON(Object.keys(EXECUTION_MODE_CONTRACTS).sort()) !== canonicalJSON(Object.keys(catalogue.contracts).sort())) throw pipelineError('MODE_INCOMPATIBLE')
  for (const [mode, frozen] of Object.entries(catalogue.contracts)) {
    const current = EXECUTION_MODE_CONTRACTS[mode]
    if (canonicalJSON(domainBindingForMode(mode)) !== canonicalJSON(frozen.domainBinding) || EXECUTION_MODE_IDS[mode] !== 'EXM-' + mode.replaceAll('_', '-') || EXECUTION_CONTRACT_IDS[mode] !== 'EXC-' + mode.replaceAll('_', '-') + '-V1') throw pipelineError('MODE_INCOMPATIBLE')
    if (!current || ['progressStrategy', 'containerSubtypes', 'itemSubtypes', 'metricKeys'].some(key => canonicalJSON(current[key]) !== canonicalJSON(frozen[key]))) throw pipelineError('MODE_INCOMPATIBLE')
  }
}
export function validatePipelineHandoff(contract, edge, state, allowedProjects) {
  const parsed = zHandoffContractV1.safeParse(contract)
  if (!parsed.success) throw pipelineError('INVALID_CONTRACT')
  const direction = pipelineOrdering(edge) || { predecessor: { type: edge.sourceType, id: edge.sourceId } }
  const predecessor = pipelineRecord(state, direction.predecessor)
  const projectId = pipelineProjectId(state, direction.predecessor)
  if (!allowedProjects.includes(projectId)) throw pipelineError('SCOPE_UNAVAILABLE', 404)
  if (parsed.data.acceptance.kind === 'GATE') {
    const gate = pipelineRecord(state, { type: 'GATE', id: parsed.data.acceptance.gateId })
    if (!allowedProjects.includes(gate.projectId)) throw pipelineError('SCOPE_UNAVAILABLE', 404)
    const ws = direction.predecessor.type === 'WORKSTREAM' ? predecessor.id : predecessor.workstreamId
    if (gate.projectId !== projectId || (gate.workstreamId && gate.workstreamId !== ws)) throw pipelineError('INVALID_CONTRACT')
  }
  return parsed.data
}

export async function compilePlanDelta(plan, { tx, state: before, projectIds, readableProjectIds = projectIds, actorPersonId, audits }) {
  checkCatalogue()
  const state = new Map([...before].map(([key, row]) => [key, clonePipelineValue(row)]))
  const refs = new Map(), proposedContracts = new Map(), resolutions = [], softDeletes = new Set()
  const primary = projectIds[0]
  const scopeReference = reference => {
    const resolved = reference.ref ? { type: reference.type, id: refs.get(reference.ref) } : reference
    if (!resolved.id || !projectIds.includes(pipelineProjectId(state, resolved))) throw pipelineError('SCOPE_UNAVAILABLE', 404)
    return resolved
  }
  const allocation = ref => pipelineUUID('zuri.pm.pipeline.v1/' + actorPersonId + '/' + primary + '/' + plan.trace.idempotencyKey + '/' + ref)
  const edit = (type, row) => {
    const key = pipelineKey(type, row.id), original = before.get(key)?.row
    if (original && Object.hasOwn(row, 'version')) {
      if (original.version >= 2147483647) throw pipelineError('NUMERIC_OVERFLOW')
      row.version = original.version + 1
    }
    if (Object.hasOwn(row, 'updatedAt')) row.updatedAt = null
    state.set(key, { type, id: row.id, row })
  }

  for (const command of plan.commands) {
    if (command.op === 'dependency.create') {
      const source = scopeReference(command.source), target = scopeReference(command.target)
      if (source.id === target.id && source.type === target.type) throw pipelineError('SELF_DEPENDENCY')
      if (plan.kind === 'DEPENDENCY_REGISTER') {
        const actual = [...new Set([pipelineProjectId(state, source), pipelineProjectId(state, target)])].sort()
        if (canonicalJSON(actual) !== canonicalJSON(projectIds)) throw pipelineError('SCOPE_UNAVAILABLE', 404)
      }
      const row = { id: allocation(command.clientRef), sourceType: source.type, sourceId: source.id, targetType: target.type, targetId: target.id, dependencyType: command.dependencyType, createdAt: null, contractJson: null }
      if ([...state.values()].some(entry => entry.type === 'DEPENDENCY' && ['sourceType', 'sourceId', 'targetType', 'targetId', 'dependencyType'].every(key => entry.row[key] === row[key]))) throw pipelineError('STALE_ENTITY', 409)
      const contract = validatePipelineHandoff(command.contract, row, state, projectIds)
      row.contractJson = canonicalJSON(contract)
      edit('DEPENDENCY', row)
      proposedContracts.set(row.id, contract)
    } else if (command.op === 'dependency.contract' || command.op === 'dependency.remove') {
      const row = { ...pipelineRecord(state, { type: 'DEPENDENCY', id: command.id }) }
      const source = scopeReference({ type: row.sourceType, id: row.sourceId }), target = scopeReference({ type: row.targetType, id: row.targetId })
      if (plan.kind === 'DEPENDENCY_REGISTER' && canonicalJSON([...new Set([pipelineProjectId(state, source), pipelineProjectId(state, target)])].sort()) !== canonicalJSON(projectIds)) throw pipelineError('SCOPE_UNAVAILABLE', 404)
      requirePipelineHash(command.expectedDependencyHash, entityHash('DEPENDENCY', row))
      if (command.op === 'dependency.remove') state.delete(pipelineKey('DEPENDENCY', row.id))
      else {
        const contract = validatePipelineHandoff(command.contract, row, state, projectIds)
        row.contractJson = canonicalJSON(contract)
        edit('DEPENDENCY', row)
        proposedContracts.set(row.id, contract)
      }
    } else if (command.op === 'node.create') {
      const parentRef = scopeReference(command.parent), parent = pipelineRecord(state, parentRef)
      if (command.type === 'WORKSTREAM' ? parentRef.type !== 'PROJECT' : !['WORKSTREAM', 'WORK_CONTAINER'].includes(parentRef.type)) throw pipelineError('INVALID_PARENT')
      const duplicate = [...before.values()].find(entry => entry.type === command.type && entry.row.code === command.fields.code)
      resolutions.push({ type: command.type, code: command.fields.code, id: duplicate?.id || null })
      if (duplicate || [...state.values()].some(entry => entry.type === command.type && entry.row.code === command.fields.code)) throw pipelineError('STALE_ENTITY', 409)
      const id = allocation(command.clientRef), fields = { ...command.fields }
      let row
      if (command.type === 'WORKSTREAM') {
        const binding = catalogue.contracts[fields.executionMode]
        if (fields.progressStrategy && fields.progressStrategy !== binding.progressStrategy) throw pipelineError('MODE_INCOMPATIBLE')
        const modeKey = fields.executionMode.replaceAll('_', '-')
        row = pipelineProposedRow(command.type, { ...fields, id, projectId: parent.id, progressStrategy: binding.progressStrategy, executionModeId: 'EXM-' + modeKey, executionContractId: 'EXC-' + modeKey + '-V1', contractVersion: '1.0.0', primaryDomainId: binding.domainBinding.primaryDomainId, supportingDomainIdsJson: canonicalJSON(binding.domainBinding.supportingDomainIds), technicalOwnerDomainId: binding.domainBinding.technicalOwnerDomainId })
      } else {
        const ws = parentRef.type === 'WORKSTREAM' ? parent : pipelineRecord(state, { type: 'WORKSTREAM', id: parent.workstreamId })
        const binding = catalogue.contracts[ws.executionMode]
        if (!binding || !binding[command.type === 'WORK_ITEM' ? 'itemSubtypes' : 'containerSubtypes'].includes(fields.subtype)) throw pipelineError('MODE_INCOMPATIBLE')
        if (fields.assigneeRef) {
          const owner = await tx.person.findUnique({ where: { id: fields.assigneeRef } })
          const targetProject = pipelineRecord(state, { type:'PROJECT',id:pipelineProjectId(state,parentRef) })
          const businessId = targetProject.businessId || (await tx.workspace.findUnique({where:{id:targetProject.workspaceId}}))?.businessId
          const business = businessId && await tx.business.findUnique({where:{id:businessId}})
          const membership = owner && !owner.accessDisabledAt && business && await tx.membership.findFirst({ where: { personId: owner.id, status: 'ACTIVE', tenantId: business.tenantId, OR:[{businessId},{businessId:null}], AND:[{OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]}] } })
          if (!membership) throw pipelineError('SCOPE_UNAVAILABLE', 404)
        }
        row = pipelineProposedRow(command.type, { ...fields, id, workstreamId: ws.id, ...(command.type === 'WORK_ITEM' ? { containerId: parentRef.type === 'WORK_CONTAINER' ? parent.id : null } : { parentId: parentRef.type === 'WORK_CONTAINER' ? parent.id : null }) })
      }
      edit(command.type, row)
      refs.set(command.clientRef, id)
    } else if (command.op === 'node.move') {
      const reference = scopeReference({ type: command.type, id: command.id }), parentRef = scopeReference(command.parent)
      requirePipelineHash(command.expectedEntityHash, pipelineSubtreeHash(state, reference))
      if (command.parent.id) requirePipelineHash(command.expectedParentHash, pipelineSubtreeHash(state, parentRef))
      else if (command.expectedParentHash !== null) throw pipelineError('INVALID_PARENT')
      const row = pipelineRecord(state, reference), parent = pipelineRecord(state, parentRef)
      if (command.type === 'WORKSTREAM') {
        if (parentRef.type !== 'PROJECT' || parent.id !== row.projectId) throw pipelineError('INVALID_PARENT')
        continue
      }
      if (!['WORKSTREAM', 'WORK_CONTAINER'].includes(parentRef.type)) throw pipelineError('INVALID_PARENT')
      const descendants = pipelineDescendants(state, reference)
      if (row.id === parent.id || descendants.some(entry => entry.id === parent.id)) throw pipelineError('INVALID_PARENT')
      const ws = parentRef.type === 'WORKSTREAM' ? parent : pipelineRecord(state, { type: 'WORKSTREAM', id: parent.workstreamId })
      for (const entry of [{ type: command.type, id: row.id, row }, ...descendants]) {
        const binding = catalogue.contracts[ws.executionMode]
        if (!binding || !binding[entry.type === 'WORK_ITEM' ? 'itemSubtypes' : 'containerSubtypes']?.includes(entry.row.subtype)) throw pipelineError('MODE_INCOMPATIBLE')
        const next = { ...entry.row, workstreamId: ws.id }
        if (entry.id === row.id) next[command.type === 'WORK_ITEM' ? 'containerId' : 'parentId'] = parentRef.type === 'WORK_CONTAINER' ? parent.id : null
        edit(entry.type, next)
      }
    } else if (command.op === 'undo') {
      const original = audits.find(row => row.id === command.originalAuditEventId)
      let payload
      try { payload = JSON.parse(original?.payloadJson || 'null') } catch { /* handled below */ }
      if (!original || original.entityType !== 'PROJECT' || !projectIds.includes(original.entityId)) throw pipelineError('SCOPE_UNAVAILABLE', 404)
      if (!payload?.deltaReceipt) throw pipelineError('UNDO_CONFLICT',409)
      if(!Array.isArray(payload.projectIds) || canonicalJSON(payload.projectIds)!==canonicalJSON(projectIds)) throw pipelineError('SCOPE_UNAVAILABLE',404)
      if (payload.deltaReceipt.inverseOfAuditEventId || payload.contractVersion !== '1') throw pipelineError('UNDO_CONFLICT', 409)
      const images=payload.stateImages, receipt=payload.deltaReceipt
      if (original.action !== 'PLAN_DELTA_COMMITTED' || !Array.isArray(images) || !images.length || images.length > 2000 || !Array.isArray(receipt.changes) || receipt.changes.length !== images.length) throw pipelineError('UNDO_CONFLICT',409)
      const imageKeys=new Set()
      for (const image of images) {
        if (!image || !PIPELINE_CHANGE_TYPES.includes(image.type) || !image.id || (!image.before && !image.after)) throw pipelineError('UNDO_CONFLICT',409)
        const key=pipelineKey(image.type,image.id), change=receipt.changes.find(change=>change.type===image.type && change.id===image.id)
        if (imageKeys.has(key) || !change || change.beforeHash !== (image.before ? entityHash(image.type,image.before) : null) || change.afterHash !== (image.after ? entityHash(image.type,image.after) : null)) throw pipelineError('UNDO_CONFLICT',409)
        imageKeys.add(key)
      }
      if (pipelineAggregateHash(receipt.changes,'before') !== receipt.beforeHash || pipelineAggregateHash(receipt.changes,'after') !== receipt.afterHash) throw pipelineError('UNDO_CONFLICT',409)
      requirePipelineHash(command.expectedAfterHash, payload.deltaReceipt.afterHash, 'UNDO_CONFLICT')
      for (const image of payload.stateImages) {
        const current = state.get(pipelineKey(image.type, image.id))?.row
        requirePipelineHash(current ? entityHash(image.type, current) : null, image.after ? entityHash(image.type, image.after) : null, 'UNDO_CONFLICT')
        if(image.type==='DEPENDENCY') for(const row of [image.before,image.after].filter(Boolean)) {scopeReference({type:row.sourceType,id:row.sourceId});scopeReference({type:row.targetType,id:row.targetId})}
        if (current && image.type !== 'DEPENDENCY') scopeReference(image)
        if (!image.before && image.type !== 'DEPENDENCY') {
          const descendants = pipelineDescendants(state, image)
          if (descendants.some(entry => !payload.stateImages.some(other => other.type === entry.type && other.id === entry.id))) throw pipelineError('UNDO_CONFLICT', 409)
          const referenced = [...state.values()].some(entry => entry.type === 'DEPENDENCY' && [entry.row.sourceId, entry.row.targetId].includes(image.id) && !payload.stateImages.some(other => other.id === entry.id))
          if (referenced) throw pipelineError('UNDO_CONFLICT', 409)
          if (await tx.externalRef.findFirst({where:{entityType:image.type,entityId:image.id}}) || await tx.fileLink.findFirst({where:{entityType:image.type,entityId:image.id}}) || await tx.externalEntityRef.findFirst({where:{internalEntityType:image.type,internalEntityId:image.id}})) throw pipelineError('UNDO_CONFLICT',409)
          if (image.type === 'WORKSTREAM' && await tx.assetProjectAllocation.findFirst({where:{workstreamId:image.id}})) throw pipelineError('UNDO_CONFLICT',409)
          if (image.type === 'WORK_ITEM' && (await tx.featureWorkLink.findFirst({ where: { workItemId: image.id } }) || await tx.projectFile.findFirst({ where: { workItemId: image.id } }) || await tx.fileAsset.findFirst({ where: { workItemId: image.id } }))) throw pipelineError('UNDO_CONFLICT', 409)
        }
      }
      for (const image of [...payload.stateImages].reverse()) {
        if (image.before) {
          const restored = clonePipelineValue(image.before)
          if (image.type === 'DEPENDENCY') {
            scopeReference({ type: restored.sourceType, id: restored.sourceId }); scopeReference({ type: restored.targetType, id: restored.targetId })
            if ([...state.values()].some(entry => entry.type === 'DEPENDENCY' && entry.id !== restored.id && ['sourceType','sourceId','targetType','targetId','dependencyType'].every(key => entry.row[key] === restored[key]))) throw pipelineError('UNDO_CONFLICT',409)
            if (restored.contractJson !== null) {
              const contract=readStoredHandoff(restored.contractJson)
              if (!contract) throw pipelineError('UNDO_CONFLICT',409)
              const acceptance=contract.acceptance.kind==='MANUAL' ? {kind:'MANUAL',satisfied:contract.acceptance.satisfied} : contract.acceptance
              validatePipelineHandoff({...contract,acceptance},restored,state,projectIds)
            }
          }
          edit(image.type, restored)
        } else if (['WORK_ITEM', 'WORKSTREAM'].includes(image.type)) {
          softDeletes.add(pipelineKey(image.type, image.id))
          edit(image.type, { ...pipelineRecord(state, image), deletedAt: null, ...(image.type === 'WORK_ITEM' && payload.stateImages.some(other => other.type === 'WORK_CONTAINER' && !other.before && other.id === pipelineRecord(state, image).containerId) ? { containerId: null } : {}) })
        }
        else state.delete(pipelineKey(image.type, image.id))
      }
    }
  }
  const changes = pipelineChanges(before, state)
  if (changes.length > 2000 || Buffer.byteLength(canonicalJSON(changes.map(change => ({ before: before.get(pipelineKey(change.type, change.id))?.row || null, after: state.get(pipelineKey(change.type, change.id))?.row || null })))) > 4 * 1024 * 1024) throw pipelineError('GRAPH_LIMIT')
  const activeState = new Map([...state].filter(([key]) => !softDeletes.has(key)))
  assertPipelineProgress(activeState, projectIds)
  await validatePipelineGraph(before, activeState, changes)
  for (const change of changes.filter(change => change.type === 'WORK_ITEM')) {
    const key = pipelineKey(change.type, change.id), row = activeState.get(key)?.row
    if (!row || !PIPELINE_PROTECTED_WORK_STATUSES.includes(row.status)) continue
    const old = before.get(key)?.row
    // A hierarchy move repeats aggregate membership checks even with the same status.
    if (old && old.status === row.status && old.workstreamId === row.workstreamId && old.containerId === row.containerId) continue
    const release = await pipelineReleaseState(activeState, row.id, { tx, allowedProjectIds: readableProjectIds, audits, proposedContracts, protectedStatus: row.status })
    if (release.restricted) throw pipelineError('SCOPE_UNAVAILABLE',404)
    if (release.held) throw pipelineError('RELEASE_HELD', 409)
  }
  return { state, changes, proposedContracts, softDeletes, resolutions: resolutions.sort((a, b) => a.type.localeCompare(b.type) || a.code.localeCompare(b.code)) }
}
