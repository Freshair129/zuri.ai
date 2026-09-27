import { createHash, randomUUID } from 'node:crypto'
import { validateClaim, validateTurnContext, validateWorkToolRequest } from './contracts.js'
import { composeTurnContext } from './context.js'

// @req FR-149, FR-171 — claimed LINE turn orchestration and delivery coordination.
// @spec ADR-106, SDD-110 — no direct DB/provider/table authority; use bounded ports.
// @tested services/conversation-runtime/test/turn-runtime.test.js
const safeCode = error => typeof error?.code === 'string' && /^[A-Z0-9_:-]{1,80}$/.test(error.code) ? error.code : 'RUNTIME_OPERATION_FAILED'
const evidenceRecords = value => Array.isArray(value) ? value : value?.records ?? []
const answerOperation = jobId => `${jobId}:turn-answer`
const modelOperation = jobId => `${jobId}:runtime-model`
const deliveryStatusOperation = jobId => `${jobId}:delivery`
const MEMORY_METHODS = ['read', 'append', 'receipt']

function injectionReceiptUnknown(cause) {
  return Object.assign(new Error('MSP_INJECTION_RECEIPT_UNKNOWN'),
    { code: 'MSP_INJECTION_RECEIPT_UNKNOWN', outcome: 'UNKNOWN', ...(cause ? { cause } : {}) })
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
    let exclusiveOperations = 0
    const leaseMs = Math.max(1000, Date.parse(claim.leaseExpiresAt) - now().getTime())
    const renewTimer = setInterval(() => {
      if (renewalInFlight || renewalError || exclusiveOperations) return
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
    // Core's memory fences compare the claimed job version, exactly as the legacy
    // worker's memory-state reader does; a renewal must not land inside one.
    const exclusive = async work => {
      if (renewalInFlight) await renewalInFlight
      exclusiveOperations += 1
      try { return await work() } finally { exclusiveOperations -= 1 }
    }
    const requireMemoryPort = () => {
      if (!MEMORY_METHODS.every(method => typeof ports.memory?.[method] === 'function')) {
        throw Object.assign(new Error('MEMORY_PORT_UNAVAILABLE'), { code: 'MEMORY_PORT_UNAVAILABLE' })
      }
    }
    const recordInjection = async (state, model) => {
      try {
        const recorded = await exclusive(() => ports.memory.receipt(claim, 'injection', { state, model }, { signal }))
        return recorded?.status === 'COMPLETED' ? { ok: true } : { ok: false, error: new Error('MEMORY_RECEIPT_RESPONSE_INVALID') }
      } catch (error) { return { ok: false, error } }
    }
    // The legacy worker's MSP injection-receipt wrapper, driven through Core one
    // state at a time: RESOLVED before the provider starts, SUBMITTED while it
    // runs, then COMPLETED or FAILED. A receipt that cannot be established after
    // the provider may have run is UNKNOWN, never a retryable failure.
    const invokeWithInjectionReceipt = async (credential, generate) => {
      const model = { provider: String(credential?.provider ?? 'configured').slice(0, 32),
        model: String(credential?.model ?? 'configured').slice(0, 200) }
      const resolved = await recordInjection('RESOLVED', model)
      // Nothing has run yet: a typed Core fence refusal is an ordinary failure, as
      // the legacy worker's pre-model fence is; only an unestablished MSP write is UNKNOWN.
      if (!resolved.ok) throw resolved.error?.retryable === false ? resolved.error : injectionReceiptUnknown(resolved.error)
      let pending
      try { pending = Promise.resolve(generate()) } catch (error) { pending = Promise.reject(error) }
      const settled = pending.then(value => ({ value }), error => ({ error }))
      const submitted = await recordInjection('SUBMITTED', model)
      const result = await settled
      if (!submitted.ok) {
        if (result.error) {
          const terminal = await recordInjection('FAILED', model)
          if (!terminal.ok) throw injectionReceiptUnknown(submitted.error)
          throw result.error
        }
        throw injectionReceiptUnknown(submitted.error)
      }
      if (result.error) {
        const failed = await recordInjection('FAILED', model)
        if (!failed.ok) throw injectionReceiptUnknown(failed.error)
        throw result.error
      }
      const terminal = await recordInjection('COMPLETED', model)
      if (!terminal.ok) throw injectionReceiptUnknown(terminal.error)
      return result.value
    }
    // Append the completed exchange under the job's stable memory-append id, the
    // way Work receipts are handled: look up the durable receipt first, and after
    // an ambiguous failure look again before a single retry.
    const appendMemory = async answer => {
      const textSha256 = createHash('sha256').update(answer, 'utf8').digest('hex')
      const lookup = () => exclusive(() => ports.memory.receipt(claim, 'append', {}, { signal }))
      const accept = receipt => {
        if (receipt?.status !== 'COMPLETED') return false
        if (receipt.result?.receipt?.textSha256 !== textSha256) {
          throw Object.assign(new Error('MEMORY_APPEND_CONFLICT'), { code: 'MEMORY_APPEND_CONFLICT' })
        }
        return true
      }
      if (accept(await lookup())) return
      for (let attempt = 0; ; attempt += 1) {
        let appendError
        try {
          if (accept(await exclusive(() => ports.memory.append(claim, answer, { signal })))) return
          appendError = Object.assign(new Error('MEMORY_APPEND_RESPONSE_INVALID'), { code: 'MEMORY_APPEND_RESPONSE_INVALID' })
        } catch (error) { appendError = error }
        // A typed Core refusal (fence, revoked policy, conflict) is final.
        if (appendError?.retryable === false || appendError?.code === 'MEMORY_APPEND_CONFLICT') throw appendError
        const after = await lookup()
        if (accept(after)) return
        if (after?.status === 'NOT_FOUND' && attempt === 0) continue
        throw appendError
      }
    }
    const stableAnswerId = answerOperation(claim.jobId)
    const stableModelId = modelOperation(claim.jobId)
    let text = null
    let composed = null
    try {
      const authority = await ports.authority.resolve(claim, { signal })
      assertAuthority(authority, claim)
      const turn = validateTurnContext(await ports.context.prepare(claim, authority, { signal }))
      if (turn.workCommand) {
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
            else if (status?.status === 'NOT_FOUND' && attempt === 0) continue
            else throw unknownOutcome('WORK_TOOL_OUTCOME_UNKNOWN', executionError)
          }
        }
        if (!result) throw unknownOutcome('WORK_TOOL_OUTCOME_UNKNOWN')
        text = result?.result?.text ?? result?.text
      } else {
        // @req FR-149 — a memory-sync opt-in turn reads its thread context through
        // Core before anything is answered, as the legacy worker does even when the
        // evidence is empty and no model will run.
        let memoryPacket = null
        if (turn.memorySync === true) {
          requireMemoryPort()
          await ensureLease()
          stage = 'memory'
          const memory = await exclusive(() => ports.memory.read(claim, { signal }))
          if (memory?.status !== 'COMPLETED' || !memory.result) {
            throw Object.assign(new Error('MEMORY_READ_RESPONSE_INVALID'), { code: 'MEMORY_READ_RESPONSE_INVALID' })
          }
          memoryPacket = memory.result.contextPacket ?? null
        }
        if (evidenceRecords(turn.evidence).length === 0) {
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
            // Credential resolution is a point-in-time grant. Revalidate the durable
            // claim and identity after receiving it, immediately before the provider
            // side effect, so a revoke or transport/lease change during that request
            // cannot start a model invocation with stale authority.
            await ensureLease()
            const currentAuthority = await ports.authority.resolve(claim, { signal })
            assertAuthority(currentAuthority, claim, authority)
            await ensureLease()
            // The memory packet is Core's composed MSP context, byte-identical to the
            // one the legacy worker hands its provider.
            const generate = () => ports.model.generate({ question: turn.question, evidence: turn.evidence,
              contextPacket: memoryPacket ?? (composed.text ? { policyDecision: 'ALLOW', text: composed.text, receipt: composed.receipt } : null),
              contextReceipt: composed.receipt, credential,
              deadlineAt: claim.deadlineAt, correlationId: claim.correlationId, signal })
            const generated = memoryPacket ? await invokeWithInjectionReceipt(credential, generate) : await generate()
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
        if (turn.memorySync === true) {
          if (typeof text !== 'string' || !text.trim()) throw Object.assign(new Error('RUNTIME_ANSWER_EMPTY'), { code: 'RUNTIME_ANSWER_EMPTY' })
          text = text.trim().slice(0, 5000).replace(/[\uD800-\uDBFF]$/, '')
          // The answer is committed only after the same text is in the thread;
          // Core refuses the completion otherwise.
          await ensureLease()
          stage = 'memory-append'
          await appendMemory(text)
        }
      }
      if (typeof text !== 'string' || !text.trim()) throw Object.assign(new Error('RUNTIME_ANSWER_EMPTY'), { code: 'RUNTIME_ANSWER_EMPTY' })
      text = text.trim().slice(0, 5000).replace(/[\uD800-\uDBFF]$/, '')
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
      if (stage !== 'completion' && stage !== 'delivery') {
        try { await ports.job.fail(claim, { code, outcome }, { signal }) } catch { /* core status/lease recovery owns reconciliation */ }
      }
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
