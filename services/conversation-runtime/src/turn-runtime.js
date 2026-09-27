import { randomUUID } from 'node:crypto'
import { validateClaim, validateTurnContext, validateWorkToolRequest } from './contracts.js'
import { composeTurnContext } from './context.js'
import { NO_EVIDENCE_REPLY, boundLineText, checkModelAnswer, deterministicFallback } from './line-answer-policy.js'

// @req FR-149, FR-171 — claimed LINE turn orchestration and delivery coordination.
// @spec ADR-106, SDD-110 — no direct DB/provider/table authority; use bounded ports.
// @tested services/conversation-runtime/test/turn-runtime.test.js
const safeCode = error => typeof error?.code === 'string' && /^[A-Z0-9_:-]{1,80}$/.test(error.code) ? error.code : 'RUNTIME_OPERATION_FAILED'
const evidenceRecords = value => Array.isArray(value) ? value : value?.records ?? []
const answerOperation = jobId => `${jobId}:turn-answer`
const modelOperation = jobId => `${jobId}:runtime-model`
const deliveryStatusOperation = jobId => `${jobId}:delivery`
// Causes that end a turn for good: Core revoked the authority it runs under.
const AUTHORITY_ENDED = Object.freeze(['AUTHORITY_DENIED', 'CONVERSATION_IDENTITY_CHANGED', 'CONVERSATION_IDENTITY_REVOKED',
  'CONVERSATION_JOB_AUTHORITY_REVOKED', 'PDPA_ERASURE'])

// The Server path meets a provider configuration error while building its provider
// port, before any answer exists, and replies with nothing; so does the Runtime.
const MODEL_CONFIGURATION_CODES = new Set(['MODEL_CONFIG_INVALID', 'MODEL_PRIVATE_RUNTIME_NOT_CONFIGURED',
  'MODEL_BASE_URL_INVALID', 'MODEL_BASE_URL_NOT_ALLOWED'])

// @req FR-049, FR-149 — the Server answer path replies from evidence when the
// provider call fails (grounded-business-answer.js). Three failures still fail
// the turn: a provider configuration error (above); an error that marks its own
// outcome UNKNOWN, as the Server path rethrows MSP_INJECTION_RECEIPT_UNKNOWN; and
// this process's own abort, which is a shutdown, not a provider answer.
function answersFromEvidence(error, signal) {
  if (signal?.aborted || error?.outcome === 'UNKNOWN') return false
  if (['MSP_INJECTION_RECEIPT_UNKNOWN', 'MODEL_OUTCOME_UNKNOWN'].includes(error?.code)) return false
  return !MODEL_CONFIGURATION_CODES.has(error?.code)
}

function unknownOutcome(code, cause) {
  return Object.assign(new Error(code), { code, outcome: 'UNKNOWN', ...(cause ? { cause } : {}) })
}

function assertAuthority(authority, claim, prior = null) {
  const scope = authority?.scope
  if (authority?.authorized !== true || !Number.isInteger(authority.version) || authority.version < 1
    || scope?.tenantId !== claim.tenantId || scope?.businessId !== claim.businessId || scope?.accountId !== claim.accountId
    || typeof scope.identityId !== 'string' || !scope.identityId || !Number.isInteger(scope.identityVersion)) {
    throw Object.assign(new Error('AUTHORITY_DENIED'), { code: 'AUTHORITY_DENIED', status: 403 })
  }
  if (prior && (scope.identityId !== prior.scope.identityId || scope.identityVersion !== prior.scope.identityVersion)) {
    throw Object.assign(new Error('CONVERSATION_IDENTITY_CHANGED'), { code: 'CONVERSATION_IDENTITY_CHANGED', status: 403 })
  }
}

export function createConversationRuntime({ ports, claimantId = `conversation-runtime:${randomUUID()}`, now = () => new Date() } = {}) {
  if (!ports?.job || ['claim', 'renew', 'complete', 'fail', 'status'].some(method => typeof ports.job[method] !== 'function')
    || typeof ports.authority?.resolve !== 'function' || typeof ports.context?.prepare !== 'function'
    || !['execute', 'status'].every(method => typeof ports.workTool?.[method] === 'function')
    || typeof ports.model?.credential !== 'function' || typeof ports.model?.generate !== 'function'
    || !['send', 'status'].every(method => typeof ports.delivery?.[method] === 'function')
    || !['append', 'status'].every(method => typeof ports.trace?.[method] === 'function')) {
    throw new Error('RUNTIME_PORTS_REQUIRED')
  }

  async function sendWithReconciliation(claim, { signal } = {}) {
    try { return await ports.delivery.send(claim, { signal }) }
    catch (firstError) {
      let prior
      try { prior = await ports.delivery.status(claim, { signal }) }
      catch (statusError) { throw unknownOutcome('DELIVERY_OUTCOME_UNKNOWN', statusError ?? firstError) }
      if (prior?.operationId !== deliveryStatusOperation(claim.jobId)) {
        throw unknownOutcome('DELIVERY_OUTCOME_UNKNOWN', firstError)
      }
      if (prior.status !== 'READY') {
        const uncertain = ['SENDING', 'UNKNOWN', 'UNKNOWN_OPERATION'].includes(prior.status)
        return { status: uncertain ? 'UNKNOWN' : prior.status,
          ...(uncertain ? { code: 'DELIVERY_OUTCOME_UNKNOWN' } : {}) }
      }

      try { return await ports.delivery.send(claim, { signal }) }
      catch (retryError) {
        let recorded
        try { recorded = await ports.delivery.status(claim, { signal }) }
        catch (statusError) { throw unknownOutcome('DELIVERY_OUTCOME_UNKNOWN', statusError ?? retryError) }
        if (recorded?.operationId !== deliveryStatusOperation(claim.jobId)) {
          throw unknownOutcome('DELIVERY_OUTCOME_UNKNOWN', retryError)
        }
        if (recorded.status !== 'READY') {
          const uncertain = ['SENDING', 'UNKNOWN', 'UNKNOWN_OPERATION'].includes(recorded.status)
          return { status: uncertain ? 'UNKNOWN' : recorded.status,
            ...(uncertain ? { code: 'DELIVERY_OUTCOME_UNKNOWN' } : {}) }
        }
        throw unknownOutcome('DELIVERY_OUTCOME_UNKNOWN', retryError)
      }
    }
  }

  async function runOne({ signal } = {}) {
    let claim = await ports.job.claim({ claimantId, signal })
    if (!claim) return { status: 'IDLE' }
    claim = validateClaim(claim)
    if (claim.phase === 'DELIVERY') {
      try {
        const delivery = await sendWithReconciliation(claim, { signal })
        return { jobId: claim.jobId, status: delivery?.status ?? 'UNKNOWN', ...(delivery?.code ? { code: delivery.code } : {}) }
      } catch (error) { return { jobId: claim.jobId, status: 'UNKNOWN', code: safeCode(error) } }
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
    let fixedReply = false
    let composed = null
    try {
      const authority = await ports.authority.resolve(claim, { signal })
      assertAuthority(authority, claim)
      const turn = validateTurnContext(await ports.context.prepare(claim, authority, { signal }))
      // @req FR-244 — Core decided at admission that this message arrived outside the
      // account's hours and handed over its fixed reply. The runtime produces exactly
      // that reply: no Work command, context, credential or model call.
      fixedReply = turn.turnKind === 'OUT_OF_HOURS'
      if (fixedReply) {
        stage = 'out-of-hours'
        text = turn.replyText
      } else if (turn.workReply) {
        // Core derived a fixed reply from malformed Work command text; no tool runs.
        text = turn.workReply.text
      } else if (turn.workCommand) {
        const operationId = turn.workCommand.operation === 'confirm-execute' ? turn.workCommand.input?.proposalId
          : turn.workCommand.operation === 'propose' ? `${claim.jobId}:work-proposal` : `${claim.jobId}:work-read`
        if (turn.workCommand.operationId && turn.workCommand.operationId !== operationId) {
          throw Object.assign(new Error('WORK_TOOL_IDENTITY_INVALID'), { code: 'WORK_TOOL_IDENTITY_INVALID' })
        }
        const request = validateWorkToolRequest({ ...turn.workCommand, operationId })
        stage = 'work-tool'
        let prior
        try { prior = await ports.workTool.status(claim, request.operationId, { signal }) }
        catch (statusError) { throw unknownOutcome('WORK_TOOL_OUTCOME_UNKNOWN', statusError) }
        let result = prior?.status === 'COMPLETED' && prior.result ? prior.result : null
        if (!result && prior?.status === 'NOT_FOUND') {
          for (let attempt = 0; attempt < 2 && !result; attempt += 1) {
            let executionError
            try { result = await ports.workTool.execute(claim, authority, request, { signal }) }
            catch (error) { executionError = error }
            if (!executionError) break

            let status
            try { status = await ports.workTool.status(claim, request.operationId, { signal }) }
            catch (statusError) { throw unknownOutcome('WORK_TOOL_OUTCOME_UNKNOWN', statusError) }
            if (status?.status === 'COMPLETED' && status.result) result = status.result
            // Core refused the call as final and nothing was recorded: retrying cannot
            // change the answer, and the outcome is known rather than UNKNOWN.
            else if (status?.status === 'NOT_FOUND' && executionError?.retryable === false) throw executionError
            else if (status?.status === 'NOT_FOUND' && attempt === 0) continue
            else throw unknownOutcome('WORK_TOOL_OUTCOME_UNKNOWN', executionError)
          }
        }
        if (!result) throw unknownOutcome('WORK_TOOL_OUTCOME_UNKNOWN')
        // COMPLETED and a typed REJECTED refusal both carry the user-facing reply;
        // a refusal is final, so it is answered and completed rather than retried.
        text = result?.result?.text ?? result?.text
      } else if (evidenceRecords(turn.evidence).length === 0) {
        text = NO_EVIDENCE_REPLY
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
          // Credential resolution is a point-in-time grant. Revalidate the durable
          // claim and identity after receiving it, immediately before the provider
          // side effect, so a revoke or transport/lease change during that request
          // cannot start a model invocation with stale authority.
          await ensureLease()
          const currentAuthority = await ports.authority.resolve(claim, { signal })
          assertAuthority(currentAuthority, claim, authority)
          await ensureLease()
          // @req FR-049, FR-149 — the Server answer path's post-model rules, from
          // the same policy source: a provider failure answers from evidence, and a
          // candidate carrying a number, code or delivery claim the evidence does
          // not carry is replaced by the evidence fallback.
          const checkedEvidence = { records: evidenceRecords(turn.evidence) }
          let generated
          let answer = null
          try {
            generated = await ports.model.generate({ question: turn.question, evidence: turn.evidence,
              contextPacket: composed.text ? { policyDecision: 'ALLOW', text: composed.text, receipt: composed.receipt } : null,
              contextReceipt: composed.receipt, credential,
              deadlineAt: claim.deadlineAt, correlationId: claim.correlationId, signal })
          } catch (error) {
            if (!answersFromEvidence(error, signal)) throw error
            answer = { text: deterministicFallback(checkedEvidence), status: 'fallback', code: safeCode(error) }
          }
          if (!answer) {
            if (typeof generated !== 'string' || !generated.trim()) throw Object.assign(new Error('RUNTIME_ANSWER_EMPTY'), { code: 'RUNTIME_ANSWER_EMPTY' })
            answer = checkModelAnswer(turn.question, checkedEvidence, generated)
          }
          // The Server worker bounds the answer and then trims it (zCompletion), in
          // that order. The recorded text is the final reply, so a replay after a
          // reclaim reuses it as is and never calls the provider a second time.
          text = boundLineText(answer.text).trim()
          try {
            await ports.trace.append(claim, { kind: 'MODEL_COMPLETED', payload: { operationId: stableModelId, text,
              answerStatus: answer.status, ...(answer.code ? { code: answer.code } : {}) } }, { signal })
          } catch {
            const recorded = await ports.trace.status(claim, stableModelId, { signal })
            if (recorded?.status === 'COMPLETED' && typeof recorded.text === 'string') text = recorded.text
            else throw Object.assign(new Error('MODEL_RESULT_UNCERTAIN'), { code: 'MODEL_OUTCOME_UNKNOWN', outcome: 'UNKNOWN' })
          }
        }
        await ports.trace.append(claim, { kind: 'CONTEXT_COMMITTED', payload: composed.receipt }, { signal })
      }
      if (typeof text !== 'string' || !text.trim()) throw Object.assign(new Error('RUNTIME_ANSWER_EMPTY'), { code: 'RUNTIME_ANSWER_EMPTY' })
      // The fixed reply is sent byte for byte, as the Server path sends it; Core
      // commits READY only for that exact text.
      if (!fixedReply) text = text.trim().slice(0, 5000).replace(/[\uD800-\uDBFF]$/, '')
      await ensureLease()
      stage = 'completion'
      let completed
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let completionError
        try {
          completed = await ports.job.complete(claim, { text, operationId: stableAnswerId }, { signal })
          if (completed?.status === 'READY'
            && (completed.operationId === undefined || completed.operationId === stableAnswerId)) break
          completionError = new Error('COMPLETION_RESPONSE_INVALID')
        } catch (error) { completionError = error }

        let status
        try { status = await ports.job.status(claim, stableAnswerId, { signal }) }
        catch (statusError) { throw unknownOutcome('COMPLETION_OUTCOME_UNKNOWN', statusError) }
        if (status?.operationId !== stableAnswerId) throw unknownOutcome('COMPLETION_OUTCOME_UNKNOWN', completionError)
        if (status?.status === 'READY' && status.operationId === stableAnswerId) {
          completed = status
          break
        }
        if (status?.status === 'CLAIMED' && attempt === 0) continue
        throw unknownOutcome('COMPLETION_OUTCOME_UNKNOWN', completionError)
      }
      if (completed?.status !== 'READY') throw unknownOutcome('COMPLETION_OUTCOME_UNKNOWN')
      try { await ports.trace.append(claim, { kind: 'ANSWER_READY', payload: { operationId: stableAnswerId,
        status: completed?.status ?? 'READY', elapsedMs: Math.max(0, now() - startedAt) } }, { signal }) } catch { /* the durable completion row is authoritative */ }
      stage = 'delivery'
      let delivery
      delivery = await sendWithReconciliation(claim, { signal })
      return { jobId: claim.jobId, status: delivery?.status ?? completed?.status ?? 'READY', ...(delivery?.code ? { code: delivery.code } : {}) }
    } catch (error) {
      const code = safeCode(error)
      const uncertainModel = stage === 'model' && (error?.outcome === 'UNKNOWN'
        || ['MODEL_PROVIDER_TIMEOUT', 'MODEL_PROVIDER_NETWORK_ERROR', 'MODEL_OUTCOME_UNKNOWN'].includes(error?.code))
      const outcome = error?.outcome === 'UNKNOWN' || uncertainModel || stage === 'delivery' || stage === 'completion'
        || error?.code === 'DELIVERY_OUTCOME_UNKNOWN' ? 'UNKNOWN' : 'FAILED'
      // A lost completion response is reconciled on the next process iteration from
      // the same job operation id. Never overwrite a possible READY commit as FAILED.
      // @req FR-244 — an out-of-hours reply must not be lost to a transient error: the
      // Server path cannot fail it. Only a revoked authority ends the turn; anything
      // else is left CLAIMED for lease reclaim. Before `prepare` the runtime cannot
      // know the turn kind, so Core refuses the `fail` itself (OUT_OF_HOURS_FAILURE_DEFERRED).
      const settles = stage !== 'completion' && stage !== 'delivery'
      let deferred = settles && fixedReply && !AUTHORITY_ENDED.includes(code)
      if (!deferred && settles) {
        try { await ports.job.fail(claim, { code, outcome }, { signal }) }
        catch (failError) { deferred = failError?.code === 'OUT_OF_HOURS_FAILURE_DEFERRED' /* else core status/lease recovery owns reconciliation */ }
      }
      if (deferred) return { jobId: claim.jobId, status: 'DEFERRED', code }
      const traceKind = stage === 'completion' ? 'COMPLETION_OUTCOME_UNKNOWN'
        : stage === 'delivery' ? 'DELIVERY_OUTCOME_UNKNOWN'
          : stage === 'work-tool' && outcome === 'UNKNOWN' ? 'WORK_TOOL_OUTCOME_UNKNOWN'
            : stage === 'model' && outcome === 'UNKNOWN' ? 'MODEL_FAILED' : 'EXECUTION_FAILED'
      try { await ports.trace.append(claim, { kind: traceKind,
        payload: { code, operationId: stableAnswerId } }, { signal }) } catch { /* scoped durable state remains authoritative */ }
      return { jobId: claim.jobId, status: outcome, code }
    } finally {
      clearInterval(renewTimer)
      await renewalInFlight?.catch(() => {})
    }
  }

  return Object.freeze({ runOne })
}
