import { randomUUID } from 'node:crypto'
import { validateClaim, validateTurnContext, validateWorkToolRequest } from './contracts.js'
import { composeTurnContext } from './context.js'

// @req FR-149, FR-171 — claimed LINE turn orchestration and delivery coordination.
// @spec ADR-106, SDD-108 — no direct DB/provider/table authority; use bounded ports.
// @tested services/conversation-runtime/test/turn-runtime.test.js
const safeCode = error => typeof error?.code === 'string' && /^[A-Z0-9_:-]{1,80}$/.test(error.code) ? error.code : 'RUNTIME_OPERATION_FAILED'

export function createConversationRuntime({ ports, claimantId = `conversation-runtime:${randomUUID()}`, now = () => new Date() } = {}) {
  if (!ports?.job || ['claim', 'renew', 'complete', 'fail'].some(method => typeof ports.job[method] !== 'function')
    || typeof ports.authority?.resolve !== 'function' || typeof ports.context?.prepare !== 'function'
    || typeof ports.workTool?.execute !== 'function' || typeof ports.model?.credential !== 'function'
    || typeof ports.model?.generate !== 'function' || typeof ports.delivery?.send !== 'function'
    || typeof ports.trace?.append !== 'function') {
    throw new Error('RUNTIME_PORTS_REQUIRED')
  }

  async function runOne({ signal } = {}) {
    let claim = await ports.job.claim({ claimantId, signal })
    if (!claim) return { status: 'IDLE' }
    claim = validateClaim(claim)
    const startedAt = now()
    let stage = 'turn'
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
    try {
      const authority = await ports.authority.resolve(claim, { signal })
      if (authority?.authorized !== true || authority.scope?.tenantId !== claim.tenantId
        || authority.scope?.businessId !== claim.businessId || authority.scope?.accountId !== claim.accountId) {
        throw Object.assign(new Error('AUTHORITY_DENIED'), { code: 'AUTHORITY_DENIED', status: 403 })
      }
      const turn = validateTurnContext(await ports.context.prepare(claim, authority, { signal }))
      const operationId = `${claim.jobId}:${claim.executionId}`
      let answer
      if (turn.workCommand) {
        const request = validateWorkToolRequest({ ...turn.workCommand, operationId: turn.workCommand.operationId || operationId })
        const result = await ports.workTool.execute(claim, authority, request, { signal })
        answer = result?.text
      } else if (turn.evidence.length === 0) {
        answer = 'ยังไม่พบข้อมูลที่ตรงกับคำถามนี้ ลองระบุรายละเอียดเพิ่มอีกหนึ่งอย่างได้ไหมคะ'
      } else {
        const composed = composeTurnContext({ authorized: turn.authorized, slices: turn.slices,
          threadId: turn.threadId, audienceKind: turn.audienceKind, maxBudgetChars: turn.maxBudgetChars })
        await ensureLease()
        const credential = await ports.model.credential(claim, authority, { signal })
        answer = await ports.model.generate({ question: turn.question, evidence: turn.evidence,
          contextPacket: composed.text, contextReceipt: composed.receipt, credential,
          deadlineAt: claim.deadlineAt, correlationId: claim.correlationId, signal })
        await ports.trace.append(claim, { kind: 'CONTEXT_COMMITTED', payload: composed.receipt }, { signal })
      }
      if (typeof answer !== 'string' || !answer.trim()) throw Object.assign(new Error('RUNTIME_ANSWER_EMPTY'), { code: 'RUNTIME_ANSWER_EMPTY' })
      const text = answer.trim().slice(0, 5000).replace(/[\uD800-\uDBFF]$/, '')
      await ensureLease()
      const completed = await ports.job.complete(claim, { text, operationId }, { signal })
      try { await ports.trace.append(claim, { kind: 'ANSWER_READY', payload: { status: completed?.status ?? 'READY', elapsedMs: Math.max(0, now() - startedAt) } }, { signal }) } catch { /* core completion owns the durable READY transition */ }
      stage = 'delivery'
      const delivery = await ports.delivery.send(claim, { signal })
      return { jobId: claim.jobId, status: delivery?.status ?? completed?.status ?? 'READY' }
    } catch (error) {
      const code = safeCode(error)
      const outcome = stage === 'delivery' || error?.code === 'DELIVERY_OUTCOME_UNKNOWN' ? 'UNKNOWN' : 'FAILED'
      try { await ports.job.fail(claim, { code, outcome }, { signal }) } catch { /* lease reconciliation owns recovery */ }
      try { await ports.trace.append(claim, { kind: outcome === 'UNKNOWN' ? 'DELIVERY_UNKNOWN' : 'EXECUTION_FAILED', payload: { code } }, { signal }) } catch { /* trace availability is reported by the owner */ }
      return { jobId: claim.jobId, status: outcome, code }
    } finally {
      clearInterval(renewTimer)
      await renewalInFlight?.catch(() => {})
    }
  }

  return Object.freeze({ runOne })
}
