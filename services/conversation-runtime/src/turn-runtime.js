import { randomUUID } from 'node:crypto'
import { validateClaim, validateTurnContext, validateWorkToolRequest } from './contracts.js'
import { composeTurnContext } from './context.js'

// @req FR-149, FR-171 — claimed LINE turn orchestration and delivery coordination.
// @spec ADR-106, SDD-108 — no direct DB/provider/table authority; use bounded ports.
// @tested services/conversation-runtime/test/turn-runtime.test.js
const safeCode = error => typeof error?.code === 'string' && /^[A-Z0-9_:-]{1,80}$/.test(error.code) ? error.code : 'RUNTIME_OPERATION_FAILED'
const evidenceRecords = value => Array.isArray(value) ? value : value?.records ?? []
const answerOperation = jobId => `${jobId}:turn-answer`
const modelOperation = jobId => `${jobId}:runtime-model`

export function createConversationRuntime({ ports, claimantId = `conversation-runtime:${randomUUID()}`, now = () => new Date() } = {}) {
  if (!ports?.job || ['claim', 'renew', 'complete', 'fail', 'status'].some(method => typeof ports.job[method] !== 'function')
    || typeof ports.authority?.resolve !== 'function' || typeof ports.context?.prepare !== 'function'
    || !['execute', 'status'].every(method => typeof ports.workTool?.[method] === 'function')
    || typeof ports.model?.credential !== 'function' || typeof ports.model?.generate !== 'function'
    || !['send', 'status'].every(method => typeof ports.delivery?.[method] === 'function')
    || !['append', 'status'].every(method => typeof ports.trace?.[method] === 'function')) {
    throw new Error('RUNTIME_PORTS_REQUIRED')
  }

  async function runOne({ signal } = {}) {
    let claim = await ports.job.claim({ claimantId, signal })
    if (!claim) return { status: 'IDLE' }
    claim = validateClaim(claim)
    if (claim.phase === 'DELIVERY') {
      try {
        const delivery = await ports.delivery.send(claim, { signal })
        return { jobId: claim.jobId, status: delivery?.status ?? 'UNKNOWN' }
      } catch {
        // A repeated send is safe only because Core reconciles the durable SENDING/
        // ACCEPTED state before any new transport attempt.
        try {
          const delivery = await ports.delivery.send(claim, { signal })
          return { jobId: claim.jobId, status: delivery?.status ?? 'UNKNOWN' }
        } catch { return { jobId: claim.jobId, status: 'UNKNOWN', code: 'DELIVERY_OUTCOME_UNKNOWN' } }
      }
    }

    const startedAt = now()
    let stage = 'authority'
    let renewalError = null
    let renewalInFlight = null
    const leaseMs = Math.max(1000, Date.parse(claim.leaseExpiresAt) - now().getTime())
    const renewTimer = setInterval(() => {
      if (renewalInFlight || renewalError) return
      renewalInFlight = ports.job.renew(claim, { signal }).then(renewed => {
        if (Number.isInteger(renewed?.version) && renewed.version >= claim.version) claim.version = renewed.version
        if (typeof renewed?.leaseExpiresAt === 'string') claim.leaseExpiresAt = renewed.leaseExpiresAt
      }).catch(error => { renewalError = error }).finally(() => { renewalInFlight = null })
    }, Math.max(1000, Math.floor(leaseMs / 3)))
    renewTimer.unref?.()
    const ensureLease = async () => {
      if (renewalInFlight) await renewalInFlight
      if (renewalError || Date.parse(claim.leaseExpiresAt) <= now().getTime()) {
        throw Object.assign(new Error('CONVERSATION_JOB_LEASE_LOST'), { code: 'CONVERSATION_JOB_LEASE_LOST', status: 409 })
      }
    }
    const stableAnswerId = answerOperation(claim.jobId)
    const stableModelId = modelOperation(claim.jobId)
    let text = null
    let composed = null
    try {
      const authority = await ports.authority.resolve(claim, { signal })
      if (authority?.authorized !== true || authority.scope?.tenantId !== claim.tenantId
        || authority.scope?.businessId !== claim.businessId || authority.scope?.accountId !== claim.accountId) {
        throw Object.assign(new Error('AUTHORITY_DENIED'), { code: 'AUTHORITY_DENIED', status: 403 })
      }
      const turn = validateTurnContext(await ports.context.prepare(claim, authority, { signal }))
      if (turn.workCommand) {
        const defaultId = turn.workCommand.operation === 'confirm-execute' ? turn.workCommand.input?.proposalId
          : turn.workCommand.operation === 'propose' ? `${claim.jobId}:work-proposal` : `${claim.jobId}:work-read`
        const request = validateWorkToolRequest({ ...turn.workCommand, operationId: turn.workCommand.operationId || defaultId })
        stage = 'work-tool'
        let result
        let prior
        try { prior = await ports.workTool.status(claim, request.operationId, { signal }) }
        catch { throw Object.assign(new Error('WORK_TOOL_STATUS_UNAVAILABLE'), { code: 'WORK_TOOL_OUTCOME_UNKNOWN', outcome: 'UNKNOWN' }) }
        if (prior?.status === 'COMPLETED' && prior.result) result = prior.result
        else if (prior?.status === 'NOT_FOUND') {
          try { result = await ports.workTool.execute(claim, authority, request, { signal }) }
          catch (error) {
            let status
            try { status = await ports.workTool.status(claim, request.operationId, { signal }) }
            catch { throw Object.assign(error, { code: 'WORK_TOOL_OUTCOME_UNKNOWN', outcome: 'UNKNOWN' }) }
            if (status?.status === 'COMPLETED' && status.result) result = status.result
            else if (status?.status === 'NOT_FOUND') {
              try { result = await ports.workTool.execute(claim, authority, request, { signal }) }
              catch { throw Object.assign(error, { code: 'WORK_TOOL_OUTCOME_UNKNOWN', outcome: 'UNKNOWN' }) }
            } else throw Object.assign(error, { code: 'WORK_TOOL_OUTCOME_UNKNOWN', outcome: 'UNKNOWN' })
          }
        } else {
          throw Object.assign(new Error('WORK_TOOL_OUTCOME_UNKNOWN'), { code: 'WORK_TOOL_OUTCOME_UNKNOWN', outcome: 'UNKNOWN' })
        }
        text = result?.result?.text ?? result?.text
      } else if (evidenceRecords(turn.evidence).length === 0) {
        text = 'ยังไม่พบข้อมูลที่ตรงกับคำถามนี้ ลองระบุรายละเอียดเพิ่มอีกหนึ่งอย่างได้ไหมคะ'
      } else {
        composed = composeTurnContext({ authorized: turn.authorized, slices: turn.slices,
          threadId: turn.threadId, audienceKind: turn.audienceKind, maxBudgetChars: turn.maxBudgetChars })
        await ensureLease()
        stage = 'model'
        const prior = await ports.trace.status(claim, stableModelId, { signal })
        if (prior?.status === 'COMPLETED' && typeof prior.text === 'string') text = prior.text
        else if (prior?.status === 'STARTED' && prior.executionId !== claim.executionId) {
          throw Object.assign(new Error('MODEL_OUTCOME_UNKNOWN'), { code: 'MODEL_OUTCOME_UNKNOWN', outcome: 'UNKNOWN' })
        } else {
          if (prior?.status === 'NOT_FOUND') {
            try {
              await ports.trace.append(claim, { kind: 'MODEL_STARTED', payload: { operationId: stableModelId } }, { signal })
            } catch {
              const recorded = await ports.trace.status(claim, stableModelId, { signal })
              if (recorded?.status !== 'STARTED' || recorded.executionId !== claim.executionId) throw Object.assign(new Error('MODEL_START_UNCERTAIN'), { code: 'MODEL_OUTCOME_UNKNOWN', outcome: 'UNKNOWN' })
            }
          } else if (prior?.status !== 'STARTED') {
            throw Object.assign(new Error('MODEL_OPERATION_STATUS_INVALID'), { code: 'MODEL_OPERATION_STATUS_INVALID' })
          }
          await ensureLease()
          const credential = await ports.model.credential(claim, authority, { signal })
          const generated = await ports.model.generate({ question: turn.question, evidence: turn.evidence,
            contextPacket: composed.text ? { policyDecision: 'ALLOW', text: composed.text, receipt: composed.receipt } : null,
            contextReceipt: composed.receipt, credential,
            deadlineAt: claim.deadlineAt, correlationId: claim.correlationId, signal })
          if (typeof generated !== 'string' || !generated.trim()) throw Object.assign(new Error('RUNTIME_ANSWER_EMPTY'), { code: 'RUNTIME_ANSWER_EMPTY' })
          text = generated.trim().slice(0, 5000).replace(/[\uD800-\uDBFF]$/, '')
          try {
            await ports.trace.append(claim, { kind: 'MODEL_COMPLETED', payload: { operationId: stableModelId, text } }, { signal })
          } catch {
            const recorded = await ports.trace.status(claim, stableModelId, { signal })
            if (recorded?.status === 'COMPLETED' && typeof recorded.text === 'string') text = recorded.text
            else throw Object.assign(new Error('MODEL_RESULT_UNCERTAIN'), { code: 'MODEL_OUTCOME_UNKNOWN', outcome: 'UNKNOWN' })
          }
        }
        await ports.trace.append(claim, { kind: 'CONTEXT_COMMITTED', payload: composed.receipt }, { signal })
      }
      if (typeof text !== 'string' || !text.trim()) throw Object.assign(new Error('RUNTIME_ANSWER_EMPTY'), { code: 'RUNTIME_ANSWER_EMPTY' })
      text = text.trim().slice(0, 5000).replace(/[\uD800-\uDBFF]$/, '')
      await ensureLease()
      stage = 'completion'
      let completed
      try { completed = await ports.job.complete(claim, { text, operationId: stableAnswerId }, { signal }) }
      catch (error) {
        const status = await ports.job.status(claim, stableAnswerId, { signal })
        if (status?.status === 'READY' && status.operationId === stableAnswerId) completed = status
        else if (status?.status === 'CLAIMED') completed = await ports.job.complete(claim, { text, operationId: stableAnswerId }, { signal })
        else throw Object.assign(error, { code: 'COMPLETION_OUTCOME_UNKNOWN', outcome: 'UNKNOWN' })
      }
      try { await ports.trace.append(claim, { kind: 'ANSWER_READY', payload: { operationId: stableAnswerId,
        status: completed?.status ?? 'READY', elapsedMs: Math.max(0, now() - startedAt) } }, { signal }) } catch { /* the durable completion row is authoritative */ }
      stage = 'delivery'
      let delivery
      try { delivery = await ports.delivery.send(claim, { signal }) }
      catch {
        try { delivery = await ports.delivery.send(claim, { signal }) }
        catch { throw Object.assign(new Error('DELIVERY_OUTCOME_UNKNOWN'), { code: 'DELIVERY_OUTCOME_UNKNOWN', outcome: 'UNKNOWN' }) }
      }
      return { jobId: claim.jobId, status: delivery?.status ?? completed?.status ?? 'READY' }
    } catch (error) {
      const code = safeCode(error)
      const uncertainModel = stage === 'model' && (error?.outcome === 'UNKNOWN'
        || ['MODEL_PROVIDER_TIMEOUT', 'MODEL_PROVIDER_NETWORK_ERROR', 'MODEL_OUTCOME_UNKNOWN'].includes(error?.code))
      const outcome = error?.outcome === 'UNKNOWN' || uncertainModel || stage === 'delivery' || stage === 'completion'
        || error?.code === 'DELIVERY_OUTCOME_UNKNOWN' ? 'UNKNOWN' : 'FAILED'
      // A lost completion response is reconciled on the next process iteration from
      // the same job operation id. Never overwrite a possible READY commit as FAILED.
      if (stage !== 'completion') {
        try { await ports.job.fail(claim, { code, outcome }, { signal }) } catch { /* core status/lease recovery owns reconciliation */ }
      }
      try { await ports.trace.append(claim, { kind: outcome === 'UNKNOWN' ? 'MODEL_FAILED' : 'EXECUTION_FAILED',
        payload: { code, operationId: stableAnswerId } }, { signal }) } catch { /* scoped durable state remains authoritative */ }
      return { jobId: claim.jobId, status: outcome, code }
    } finally {
      clearInterval(renewTimer)
      await renewalInFlight?.catch(() => {})
    }
  }

  return Object.freeze({ runOne })
}
