import { isPipelineReceiptConflict } from '../application/pipeline-writer'
import { bindPostgresScope } from '../application/project-feature-repository'
import { readablePipelineProjects } from '../application/handoff-evidence'
// @req FR-084 — shared read-only preview and atomic, hash-fenced intake commit.
// @spec ADR-035, SDD-046, SEC-001, SEC-003
// @tested tests/integration/plan-delta.test.js
// @tested tests/integration/dependency-handoff.test.js
import { randomUUID } from 'node:crypto'
import { PIPELINE_PROTECTED_WORK_STATUSES } from '@/lib/validation/enums'
import prisma from '@/lib/db'
import { zPlanDelta, zRegisterDelta } from './plan-delta-schema'
import { catalogue, compilePlanDelta, pipelineChanges, pipelineAggregateHash, requirePipelineHash } from './plan-delta-operations'
import { canonicalJSON, entityHash, handoffHash, persistHandoffContract, readStoredHandoff } from '../application/handoff-contract'
import { withPipelineTransaction, resolvePipelineAuthority, pipelineError, isPostgres } from '../application/pipeline-transaction'
import { PIPELINE_MODELS, pipelineKey, readPipelineState, pipelineProjectId, pipelineRecord, pipelineReleaseState, clonePipelineValue, pipelineReadRows, pipelineReleaseScopes, pipelineOrdering, hydratePipelineGates } from '../application/pipeline-state'
import { recordAudit } from '../application/audit'
import { createExecutionTraceContext, createExecutionTraceRows, finishExecutionRun, finishExecutionStep } from '../application/execution-trace'

export function pipelineFailure(error, dry = false) {
  const code = error?.name === 'PipelineError' || error?.name === 'ProgressNumericError' ? error.code : 'GRAPH_BUSY'
  const base = { errors: error?.name === 'PipelineError' && error.validationIssues?.length ? error.validationIssues : [{ code, path: '', message: code }], conflicts: error?.name === 'PipelineError' ? error.conflicts : [] }
  return dry ? { valid: false, ...base, preview: null, previewHash: null, projectId: null } : { committed: false, ...base }
}
export function pipelineResponseStatus(result) {
  const code = typeof result.errors?.[0] === 'string' && result.errors[0].startsWith('IDEMPOTENCY_CONFLICT') ? 'IDEMPOTENCY_CONFLICT' : result.errors?.[0]?.code
  if (!code) return 200
  if (code === 'UNAUTHENTICATED') return 401
  if (code === 'SCOPE_UNAVAILABLE') return 404
  if (code === 'PAYLOAD_LIMIT') return 413
  if (code === 'INVALID_ENVELOPE') return 400
  if (code === 'GRAPH_BUSY') return 503
  return ['STALE_PREVIEW', 'STALE_ENTITY', 'UNDO_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'RELEASE_HELD', 'UPGRADE_REQUIRED', 'CONTRACT_CONFLICT'].includes(code) ? 409 : 422
}
export function invalidPipelineEnvelope(zodError) {
  const paths = new Set()
  const visit = issue => {
    if (issue.code === 'invalid_union') { for (const error of issue.unionErrors) for (const nested of error.issues) visit(nested); return }
    const inputs = issue.code === 'unrecognized_keys' ? issue.keys.map(key => [...issue.path, key]) : [issue.path]
    for (const input of inputs) paths.add(input.map(part => '/' + String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join(''))
  }
  for (const issue of zodError.issues) visit(issue)
  return Object.assign(pipelineError('INVALID_ENVELOPE', 400), { validationIssues: [...paths].sort().slice(0, 50).map(path => ({ code: 'INVALID_ENVELOPE', path, message: 'INVALID_ENVELOPE' })) })
}
function parse(raw, register,requestBodyBytes) {
  if (Math.max(requestBodyBytes||0,Buffer.byteLength(JSON.stringify(raw) || '')) > 1024 * 1024) throw pipelineError('PAYLOAD_LIMIT', 413)
  const result = (register ? zRegisterDelta : zPlanDelta).safeParse(raw)
  if (!result.success) throw invalidPipelineEnvelope(result.error)
  return result.data
}
function payloadHash(plan, actorPersonId, projectIds) {
  return handoffHash('pm-delta-payload:v1', { schemaVersion: plan.schemaVersion, kind: plan.kind, projectId: projectIds[0], ...(plan.kind === 'DEPENDENCY_REGISTER' ? { projectIds } : {}), actorPersonId, trace: plan.trace, commands: plan.commands })
}
export async function readPipelineEvidence(tx, state, plan, projectIds, tenantId,readableProjectIds=projectIds,viewer=null) {
  const ids=new Set(),locators=[]
  for(const command of plan.commands.filter(command=>command.op==='undo')) {
    const postgres=isPostgres(tx),bind=n=>postgres?'$'+n:'?',slots=projectIds.map((_,index)=>bind(index+3)).join(',')
    const projection=postgres?`a."payloadJson"::jsonb->'projectIds'`:`json_extract(CASE WHEN json_valid(a."payloadJson") THEN a."payloadJson" ELSE '{}' END,'$.projectIds')`
    const rows=await tx.$queryRawUnsafe(`SELECT a."id",${projection} AS projects FROM "AuditEvent" a WHERE a."id"=${bind(1)} AND a."tenantId"=${bind(2)} AND a."entityType"='PROJECT' AND a."entityId" IN (${slots})`,command.originalAuditEventId,tenantId,...projectIds)
    let projects=rows[0]?.projects
    if(typeof projects==='string') {try{projects=JSON.parse(projects)}catch{projects=null}}
    if(!Array.isArray(projects) || canonicalJSON(projects)!==canonicalJSON(projectIds)) throw pipelineError('SCOPE_UNAVAILABLE',404)
    ids.add(command.originalAuditEventId)
  }
  for (const entry of state.values()) if (entry.type === 'DEPENDENCY' && entry.row.contractJson !== null) {
    const acceptance = readStoredHandoff(entry.row.contractJson)?.acceptance
    try {
      const successor = {type: entry.row.dependencyType === 'REQUIRES' ? entry.row.sourceType : entry.row.targetType, id: entry.row.dependencyType === 'REQUIRES' ? entry.row.sourceId : entry.row.targetId}
      if (acceptance?.kind === 'MANUAL' && projectIds.includes(pipelineProjectId(state, successor)) && [pipelineProjectId(state,{type:entry.row.sourceType,id:entry.row.sourceId}),pipelineProjectId(state,{type:entry.row.targetType,id:entry.row.targetId})].every(id=>readableProjectIds.includes(id))) ids.add(acceptance.decisionAuditEventId)
    } catch {
      // Only a dangling successor needs its historical scope locator. Bound the
      // result per edge at the DB; never load every Tenant's lifetime of audits.
      const postgres = isPostgres(tx), bind = n => postgres ? '$'+n : '?'
      const projectSlots=projectIds.map((_,index)=>bind(index+3)).join(',')
      const scoped=`a."tenantId"=${bind(1)} AND a."action" IN ('PLAN_DELTA_COMMITTED','BUNDLE_IMPORTED','PLAN_IMPORTED','CREATED','UPDATED','DELETED','ARCHIVED')`
      const match=postgres ? `x->>'dependencyId'=${bind(2)} AND x->>'successorProjectId' IN (${projectSlots})` : `json_extract(x.value,'$.dependencyId')=${bind(2)} AND json_extract(x.value,'$.successorProjectId') IN (${projectSlots})`
      const source=postgres
        ? `"AuditEvent" a CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(a."payloadJson"::jsonb->'releaseScopes')='array' THEN a."payloadJson"::jsonb->'releaseScopes' ELSE '[]'::jsonb END) x`
        : `"AuditEvent" a, json_each(CASE WHEN json_valid(a."payloadJson") THEN a."payloadJson" ELSE '{}' END, '$.releaseScopes') x`
      const found=await tx.$queryRawUnsafe(`SELECT a."id",a."occurredAt",a."businessId",a."tenantId",${postgres?'x':'x.value'} AS locator FROM ${source} WHERE ${scoped} AND ${match} ORDER BY a."occurredAt" DESC,a."id" DESC LIMIT 1`,tenantId,entry.id,...projectIds)
      if(found[0]) {
        const row=found[0],locator=typeof row.locator==='string'?JSON.parse(row.locator):row.locator
        let readable=false
        try {
          const direction=pipelineOrdering(entry.row),predecessorId=pipelineProjectId(state,direction.predecessor)
          const scopes=await readablePipelineProjects(tx,[predecessorId,locator.successorProjectId],viewer)
          if(scopes.includes(predecessorId) && scopes.includes(locator.successorProjectId)) {
            const projects=await tx.project.findMany({where:{id:{in:scopes}},select:{businessId:true,workspace:{select:{businessId:true}}}})
            readable=projects.some(project=>(project.businessId||project.workspace?.businessId)===row.businessId) && row.tenantId===tenantId
          }
        } catch { /* an opaque locator is structural proof only */ }
        const full=readable && await tx.auditEvent.findUnique({where:{id:row.id}})
        locators.push(full || {id:row.id,occurredAt:row.occurredAt,locatorOnly:true,payloadJson:canonicalJSON({releaseScopes:[locator]})})
      }
    }
  }
  let rows=[]
  if(ids.size) {
    const projects=await tx.project.findMany({where:{id:{in:readableProjectIds}},select:{businessId:true,workspace:{select:{businessId:true}}}})
    const businessIds=[...new Set(projects.map(project=>project.businessId||project.workspace?.businessId).filter(Boolean))]
    rows=await tx.auditEvent.findMany({where:{id:{in:[...ids]},tenantId,businessId:{in:businessIds}},orderBy:{id:'asc'}})
    const inverseEvidence=new Set()
    for (const command of plan.commands.filter(command=>command.op==='undo')) {
      const original=rows.find(row=>row.id===command.originalAuditEventId)
      let payload
      try {payload=JSON.parse(original?.payloadJson||'null')} catch {continue}
      if (!Array.isArray(payload?.stateImages)) continue
      for (const image of payload.stateImages) if (image?.type==='DEPENDENCY' && image.before) {
        const row=image.before,acceptance=readStoredHandoff(row.contractJson)?.acceptance
        try {
          if (![pipelineProjectId(state,{type:row.sourceType,id:row.sourceId}),pipelineProjectId(state,{type:row.targetType,id:row.targetId})].every(id=>projectIds.includes(id))) continue
          if (acceptance?.kind==='MANUAL') inverseEvidence.add(acceptance.decisionAuditEventId)
        } catch { /* compiler rejects unavailable inverse endpoints */ }
      }
    }
    if (inverseEvidence.size) rows.push(...await tx.auditEvent.findMany({where:{id:{in:[...inverseEvidence]},tenantId,businessId:{in:businessIds}},orderBy:{id:'asc'}}))
  }
  return [...new Map([...locators,...rows].map(row=>[row.id,row])).values()].sort((a,b)=>a.id.localeCompare(b.id))
}
export async function pipelineReadableProjects(tx,state,projectIds,viewer) {
  const reads=new Set(projectIds)
  for(const entry of state.values()) if(entry.type==='DEPENDENCY' && entry.row.contractJson!==null) {
    const direction=pipelineOrdering(entry.row)
    try {if(direction && projectIds.includes(pipelineProjectId(state,direction.successor))) reads.add(pipelineProjectId(state,direction.predecessor))} catch { /* opaque locator */ }
  }
  return [...new Set([...projectIds,...await readablePipelineProjects(tx,[...reads],viewer)])]

}

export async function readPlanDeltaSnapshot(tx, plan, authority, projectIds) {
  const before = await readPipelineState(tx)
  const readableProjectIds=await pipelineReadableProjects(tx,before,projectIds,authority.viewer)
  await hydratePipelineGates(tx,before,readableProjectIds)
  const audits=await readPipelineEvidence(tx,before,plan,projectIds,authority.scopes[0].tenant.id,readableProjectIds,authority.viewer)
  return {before,readableProjectIds,audits}
}

// @req FR-082 — target discovery shares one read snapshot and full semantic checks.
// @tested tests/integration/plan-delta-moves.test.js
// These options are internal read-model inputs, never request-envelope fields.
export async function preparePlanDelta(tx, plan, authority, projectIds, {snapshot=null,validationOnly=false}={}) {
  const {before,readableProjectIds,audits}=snapshot||await readPlanDeltaSnapshot(tx,plan,authority,projectIds)
  const compiled = await compilePlanDelta(plan, { tx, state: before, projectIds, readableProjectIds, actorPersonId: authority.viewer.principal.id, audits })
  const releaseEffects = []
  for (const entry of compiled.state.values()) {
    if (entry.type !== 'WORK_ITEM' || entry.row.deletedAt || compiled.softDeletes.has(pipelineKey(entry.type, entry.id))) continue
    let projectId
    try { projectId = pipelineProjectId(compiled.state, entry) } catch { continue }
    if (!projectIds.includes(projectId)) continue
    const options = { tx, allowedProjectIds: readableProjectIds, audits }
    const oldRow=before.get(pipelineKey(entry.type,entry.id))?.row
    const phase=status=>PIPELINE_PROTECTED_WORK_STATUSES.includes(status)?status:undefined
    const old = oldRow ? await pipelineReleaseState(before, entry.id, {...options,protectedStatus:phase(oldRow.status)}) : null
    const after = await pipelineReleaseState(compiled.state, entry.id, { ...options, protectedStatus:phase(entry.row.status), proposedContracts: compiled.proposedContracts })
    if ((!old || canonicalJSON(old) !== canonicalJSON(after)) && after.restricted) throw pipelineError('SCOPE_UNAVAILABLE',404)
    if (!old || canonicalJSON(old) !== canonicalJSON(after)) releaseEffects.push({ workItemId: entry.id, before: old, after })
  }
  releaseEffects.sort((a, b) => a.workItemId.localeCompare(b.workItemId))
  if (releaseEffects.length > 2000 || Buffer.byteLength(canonicalJSON(releaseEffects)) > 4 * 1024 * 1024) throw pipelineError('GRAPH_LIMIT')
  if(validationOnly)return {compiled,releaseEffects}
  const first = authority.scopes[0]
  const rows = pipelineReadRows(before, projectIds, compiled.proposedContracts)
  const readSet = {
    scope: { tenantId: first.tenant.id, businessId: first.business.id, workspaceId: first.workspace.id, projectId: projectIds[0] },
    authorityHash: handoffHash('pm-authority:v1', authority.rows), catalogueHash: handoffHash('pm-execution-catalog:v1', catalogue),
    graph: rows.filter(row => row.type === 'DEPENDENCY').map(row => ({ id: row.id, hash: entityHash(row.type, row.row) })),
    entities: rows.filter(row => !['GATE', 'DEPENDENCY'].includes(row.type)).map(row => ({ type: row.type, id: row.id, hash: entityHash(row.type, row.row) })).sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id)),
    gates: rows.filter(row => row.type === 'GATE' && Object.hasOwn(row.row,'status')).map(row => ({ id: row.id, hash: entityHash(row.type, row.row) })),
    evidence: audits.filter(row=>!row.locatorOnly).map(row => ({ id: row.id, hash: entityHash('AUDIT_EVENT', clonePipelineValue(row)) })), resolutions: compiled.resolutions,
  }
  const preview = { commands: plan.commands, changes: compiled.changes, releaseEffects }
  const payload = payloadHash(plan, authority.viewer.principal.id, projectIds)
  const beforeHash = pipelineAggregateHash(compiled.changes, 'before'), proposedAfterHash = pipelineAggregateHash(compiled.changes, 'after')
  const previewHash = handoffHash('pm-delta-preview:v1', { contractVersion: '1', payloadHash: payload, readSetHash: handoffHash('pm-readset:v1', readSet), beforeHash, proposedAfterHash, changes: compiled.changes, releaseEffects })
  return { before, compiled, audits, payloadHash: payload, beforeHash, preview, previewHash }
}

async function applyCompiled(tx, prepared, provenance) {
  const { before, compiled } = prepared, after = compiled.state
  const pending = [...compiled.changes], actual = new Map(before)
  // Receipt sorting is independent of write order: parents must exist before
  // children, and inverse physical deletes must remove children before parents.
  for (let round = 0; pending.length && round < 2001; round++) {
    let progressed = false
    for (let index = 0; index < pending.length; index++) {
      const change = pending[index], key = pipelineKey(change.type, change.id), proposed = after.get(key)?.row
      const delegate = PIPELINE_MODELS[change.type]
      if (change.action === 'CREATE') {
        const parent = change.type === 'WORKSTREAM' ? ['PROJECT', proposed.projectId] : ['WORK_CONTAINER', proposed.parentId || proposed.containerId]
        if (proposed.workstreamId && !actual.has(pipelineKey('WORKSTREAM', proposed.workstreamId))) continue
        if (parent[1] && !actual.has(pipelineKey(...parent))) continue
      }
      if (change.action === 'DELETE' && change.type !== 'DEPENDENCY' && [...actual.values()].some(entry => entry.row.parentId === change.id || entry.row.containerId === change.id)) continue
      if (!proposed) {
        await tx[delegate].delete({ where: { id: change.id } })
        actual.delete(key)
      } else {
        const data = { ...proposed }
        if (Object.hasOwn(data, 'createdAt') && data.createdAt === null) data.createdAt = provenance.decisionAt
        if (Object.hasOwn(data, 'updatedAt') && data.updatedAt === null) data.updatedAt = provenance.decisionAt
        if (compiled.softDeletes.has(key)) data.deletedAt = provenance.decisionAt
        if (compiled.proposedContracts.has(change.id)) data.contractJson = canonicalJSON(persistHandoffContract(compiled.proposedContracts.get(change.id), provenance))
        const saved = change.action === 'CREATE' ? await tx[delegate].create({ data }) : await tx[delegate].update({ where: { id: change.id }, data })
        actual.set(key, { type: change.type, id: change.id, row: clonePipelineValue(saved) })
      }
      pending.splice(index--, 1)
      progressed = true
    }
    if (!progressed) throw pipelineError('UNDO_CONFLICT', 409)
  }
  if (pending.length) throw pipelineError('GRAPH_LIMIT')
  return actual
}

async function run(raw, { workspaceId, viewer, db = prisma, register = false,requestBodyBytes = null } = {}, commit, receiptOnly = false) {
  try {
    const plan = parse(raw, register,requestBodyBytes), projectIds = register ? plan.projectIds : [plan.projectId]
    if (commit && !plan.expectedPreviewHash) throw pipelineError('INVALID_ENVELOPE', 400)
    if (!commit && plan.expectedPreviewHash !== null) throw pipelineError('INVALID_ENVELOPE', 400)
    return await withPipelineTransaction(db, async (tx, { postgres }) => {
      const authority = await resolvePipelineAuthority(tx, projectIds, viewer, { postgres, write: commit, workspaceId })
      if (postgres && projectIds.length === 1) await bindPostgresScope(tx,{tenantId:authority.scopes[0].tenant.id,businessId:authority.scopes[0].business.id})
      const hash = payloadHash(plan, authority.viewer.principal.id, projectIds)
      if (commit) {
        const existing = await tx.planImportReceipt.findUnique({ where: { idempotencyKey: plan.trace.idempotencyKey } })
        if (existing) {
          if (existing.payloadHash !== hash || existing.projectId !== projectIds[0]) throw pipelineError('IDEMPOTENCY_CONFLICT', 409)
          const audit = existing.auditEventId && await tx.auditEvent.findUnique({ where: { id: existing.auditEventId } })
          let response
          try { response = JSON.parse(audit?.payloadJson || 'null')?.response } catch { /* fail closed below */ }
          if (!response || audit.actorId !== authority.viewer.principal.id) throw pipelineError('IDEMPOTENCY_CONFLICT', 409)
          return { ...response, replay: true }
        }
      }
      if(receiptOnly) throw pipelineError('IDEMPOTENCY_CONFLICT',409)
      const prepared = await preparePlanDelta(tx, plan, authority, projectIds)
      if (!commit) return { valid: true, errors: [], conflicts: [], preview: prepared.preview, previewHash: prepared.previewHash, projectId: projectIds[0] }
      requirePipelineHash(plan.expectedPreviewHash, prepared.previewHash, 'STALE_PREVIEW')
      const auditEventId = randomUUID(), actorPersonId = authority.viewer.principal.id
      const provenance = { actorPersonId, decisionAuditEventId: auditEventId, decisionAt: new Date().toISOString() }
      const after = await applyCompiled(tx, prepared, provenance)
      const changes = pipelineChanges(prepared.before, after)
      const trace = createExecutionTraceContext({ plan, workspace: authority.scopes[0].workspace, projectId: projectIds[0], projectIds, sourceKind: 'PLAN', stepKeys: ['plan.commit'] })
      await createExecutionTraceRows(tx, trace)
      const step = trace.steps[0]
      const deltaReceipt = { version: 1, idempotencyKey: plan.trace.idempotencyKey, payloadHash: prepared.payloadHash, previewHash: prepared.previewHash, beforeHash: pipelineAggregateHash(changes, 'before'), afterHash: pipelineAggregateHash(changes, 'after'), changes, undoable: plan.commands[0].op !== 'undo', inverseOfAuditEventId: plan.commands[0].op === 'undo' ? plan.commands[0].originalAuditEventId : null }
      const response = { committed: true, projectId: projectIds[0], executionRunId: trace.executionRunId, executionStepId: step.executionStepId, attemptId: step.attemptId, stepKey: 'plan.import.commit', status: 'SUCCEEDED', auditEventId, deltaReceipt, replay: false, errors: [], conflicts: [] }
      const stateImages = changes.map(change => ({ type: change.type, id: change.id, before: prepared.before.get(pipelineKey(change.type, change.id))?.row || null, after: after.get(pipelineKey(change.type, change.id))?.row || null }))
      await recordAudit(tx, { id: auditEventId, entityType: 'PROJECT', entityId: projectIds[0], action: 'PLAN_DELTA_COMMITTED', actorId: actorPersonId, tenantId: authority.scopes[0].tenant.id, businessId: authority.scopes[0].business.id, payload: { releaseScopes: pipelineReleaseScopes(after, projectIds), contractVersion: '1', actorPersonId, projectIds, commands: plan.commands, payloadHash: prepared.payloadHash, stateImages, deltaReceipt, response } })
      await finishExecutionStep(tx, step.executionStepId, { status: 'SUCCEEDED', projectId: projectIds[0], auditEventId })
      await finishExecutionRun(tx, trace.executionRunId, { status: 'SUCCEEDED', projectId: projectIds[0], projectIds, auditEventId })
      await tx.planImportReceipt.create({ data: { idempotencyKey: plan.trace.idempotencyKey, payloadHash: prepared.payloadHash, executionRunId: trace.executionRunId, executionStepId: step.executionStepId, attemptId: step.attemptId, stepKey: 'plan.import.commit', status: 'SUCCEEDED', correlationId: plan.trace.correlationId, schemaVersion: '1.3', projectId: projectIds[0], auditEventId } })
      return response
    }, { write: commit })
  } catch (error) {
    if(commit && !receiptOnly && isPipelineReceiptConflict(error)) return run(raw,{workspaceId,viewer,db,register,requestBodyBytes},true,true)
    return pipelineFailure(error, !commit)
  }
}
export const dryRunPlanDelta = (raw, options) => run(raw, options, false)
export const commitPlanDelta = (raw, options) => run(raw, options, true)
