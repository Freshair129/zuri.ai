import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import {
  appendTraceEvent,
  canonicalJson,
  playbackTrace,
  readExecutionTrace,
  redactTraceTurn,
  sha256,
} from '@/modules/agent/execution-trace'

// @req FR-171 — bind API-009 memory write evidence to one execution context and action attempt.
// @spec ADR-070, FR-171-P3 — reference-only receipts, causal parent validation and tombstone closure.
// @tested tests/integration/memory-trace-linkage.test.js

let scope
let foreignScope

beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8)
  const portfolio = await createPortfolio({ code: `PF-MEM-${suffix}`, name: `Memory Trace ${suffix}` })
  const tenant = await createTenant({ portfolioId: portfolio.id, code: `TN-MEM-${suffix}`, name: `Memory Trace ${suffix}` })
  const business = await createBusiness({ tenantId: tenant.id, code: `BS-MEM-${suffix}`, name: `Memory Trace ${suffix}` })
  const foreignBusiness = await createBusiness({ tenantId: tenant.id, code: `BS-MEM-X-${suffix}`, name: `Foreign Memory Trace ${suffix}` })
  scope = { tenantId: tenant.id, businessId: business.id }
  foreignScope = { tenantId: tenant.id, businessId: foreignBusiness.id }
})

function ids(overrides = {}) {
  return {
    turnId: randomUUID(),
    executionId: randomUUID(),
    ctxId: randomUUID(),
    modelCallId: randomUUID(),
    actionId: randomUUID(),
    actionAttemptId: randomUUID(),
    ...overrides,
  }
}

function traceInput({ eventScope = scope, turnId, executionId, kind, payload, idempotencyKey = randomUUID() }) {
  return {
    scope: eventScope,
    turnId,
    executionId,
    kind,
    idempotencyKey,
    payload,
    occurredAt: new Date('2026-09-08T00:00:00.000Z'),
  }
}

function contextEvent(referenceIds, { eventScope = scope, requestBody = { model: 'memory-test', input: 'private write' }, requestHash } = {}) {
  return traceInput({
    eventScope,
    turnId: referenceIds.turnId,
    executionId: referenceIds.executionId,
    kind: 'CONTEXT_COMMITTED',
    payload: {
      ctxId: referenceIds.ctxId,
      modelCallId: referenceIds.modelCallId,
      requestBody,
      requestHash: requestHash ?? sha256(requestBody),
    },
  })
}

function writeInput({ vaultId = 'msp-vault-1', key = 'memory-key', category = 'profile', bodyHash = sha256({ value: 'memory-v1' }), ...extra } = {}) {
  return { operation: 'MSP_MEMORY_UPSERT', vaultId, key, category, bodyHash, ...extra }
}

function actionEvent(referenceIds, { eventScope = scope, input = writeInput(), inputHash = sha256(input) } = {}) {
  return traceInput({
    eventScope,
    turnId: referenceIds.turnId,
    executionId: referenceIds.executionId,
    kind: 'ACTION_STARTED',
    payload: {
      ctxId: referenceIds.ctxId,
      actionId: referenceIds.actionId,
      actionAttemptId: referenceIds.actionAttemptId,
      input,
      inputHash,
    },
  })
}

function receiptReference(input, { memoryId = 'memory-1', version = 4, sourceHash = 'a'.repeat(64), snapshotHash = input.bodyHash } = {}) {
  return {
    memoryId,
    version,
    sourceVaultId: input.vaultId,
    key: input.key,
    category: input.category,
    sourceHash,
    snapshotHash,
  }
}

function memoryEvent(referenceIds, {
  eventScope = scope,
  input = writeInput(),
  status = 'ACKNOWLEDGED',
  reference = receiptReference(input),
} = {}) {
  return traceInput({
    eventScope,
    turnId: referenceIds.turnId,
    executionId: referenceIds.executionId,
    kind: 'MEMORY_WRITTEN',
    payload: {
      schemaVersion: 'memory-write-trace.v1',
      ctxId: referenceIds.ctxId,
      actionId: referenceIds.actionId,
      actionAttemptId: referenceIds.actionAttemptId,
      source: 'MSP_API_009',
      sessionAuthority: 'NOT_ATTESTED_BY_API_009',
      receipt: {
        status,
        observedAt: '2026-09-08T00:00:01.000Z',
        reference: status === 'ACKNOWLEDGED' ? reference : null,
      },
    },
  })
}

async function appendParents(referenceIds, input, options = {}) {
  await appendTraceEvent(prisma, contextEvent(referenceIds, options.context))
  await appendTraceEvent(prisma, actionEvent(referenceIds, { ...options.action, input }))
}

async function eventCount(eventScope, turnId) {
  return prisma.agentTraceEvent.count({ where: { ...eventScope, turnId } })
}

async function expectRejectedWithoutRow(event, reason, eventScope = scope) {
  const before = await eventCount(eventScope, event.turnId)
  await expect(appendTraceEvent(prisma, event))
    .rejects.toMatchObject({ code: 'MEMORY_TRACE_LINK_INVALID' })
  await expect(appendTraceEvent(prisma, event)).rejects.toMatchObject({ code: 'MEMORY_TRACE_LINK_INVALID' })
  const after = await eventCount(eventScope, event.turnId)
  expect(after).toBe(before)
  if (reason) {
    await expect(appendTraceEvent(prisma, { ...event, idempotencyKey: randomUUID() }))
      .rejects.toThrow(reason)
  }
}

describe('memory journal linkage (FR-171-P3)', () => {
  it.each(['ctxId', 'actionAttemptId'])('rejects reused %s even when each execution has matching parents', async field => {
    const first = ids()
    const input = writeInput()
    await appendParents(first, input)
    const second = ids({ turnId: first.turnId, [field]: first[field] })
    await appendParents(second, input)
    await expectRejectedWithoutRow(memoryEvent(second, { input }), 'MEMORY_TRACE_OCCURRENCE_REUSED')
  })

  it('marks the execution incomplete even when its model call is independently complete', async () => {
    const referenceIds = ids()
    const input = writeInput()
    await appendParents(referenceIds, input)
    await appendTraceEvent(prisma, traceInput({ ...referenceIds, kind: 'MODEL_COMPLETED',
      payload: { ctxId: referenceIds.ctxId, modelCallId: referenceIds.modelCallId, outputText: 'answer' } }))
    await appendTraceEvent(prisma, memoryEvent(referenceIds, { input }))
    const events = await readExecutionTrace(prisma, { scope, turnId: referenceIds.turnId })
    const result = playbackTrace(events)
    expect(result.modelCalls[0].status).toBe('REPLAY_COMPLETE')
    expect(result.executions[0]).toMatchObject({ status: 'REPLAY_INCOMPLETE',
      reasons: expect.arrayContaining(['MSP_SESSION_AUTHORITY_UNAVAILABLE']) })
    expect(result.output).toBeNull()
    expect(() => playbackTrace([...events, null])).not.toThrow()
    expect(Object.isFrozen(result.memoryWrites[0].evidence)).toBe(true)
  })

  it('appends a same-scope reference-only acknowledged receipt through its context and action parents', async () => {
    const referenceIds = ids()
    const input = writeInput()
    await appendParents(referenceIds, input)
    await appendTraceEvent(prisma, memoryEvent(referenceIds, { input }))

    const events = await readExecutionTrace(prisma, { scope, turnId: referenceIds.turnId })
    const stored = events.find(event => event.kind === 'MEMORY_WRITTEN')
    expect(stored).toBeTruthy()
    expect(stored.executionId).toBe(referenceIds.executionId)
    expect(stored.payload).toMatchObject({
      schemaVersion: 'memory-write-trace.v1',
      ctxId: referenceIds.ctxId,
      actionId: referenceIds.actionId,
      receipt: { status: 'ACKNOWLEDGED', reference: { version: 4, key: input.key, category: input.category } },
    })
    expect(stored.payload).not.toHaveProperty('entry')
    expect(stored.payload).not.toHaveProperty('body_json')
    expect(canonicalJson(stored.payload)).not.toContain('body_json')
  })

  it('preserves revision N when a later action attempt records revision N+1', async () => {
    const referenceIds = ids()
    const firstInput = writeInput({ key: 'customer-note', bodyHash: sha256({ value: 'revision-n' }) })
    await appendParents(referenceIds, firstInput)
    await appendTraceEvent(prisma, memoryEvent(referenceIds, {
      input: firstInput,
      reference: receiptReference(firstInput, { version: 3, sourceHash: 'b'.repeat(64) }),
    }))

    const nextAttemptIds = ids({
      turnId: referenceIds.turnId,
      executionId: referenceIds.executionId,
      ctxId: referenceIds.ctxId,
      actionId: referenceIds.actionId,
    })
    const nextInput = writeInput({ key: 'customer-note', bodyHash: sha256({ value: 'revision-n-plus-1' }) })
    await appendTraceEvent(prisma, actionEvent(nextAttemptIds, { input: nextInput }))
    await appendTraceEvent(prisma, memoryEvent(nextAttemptIds, {
      input: nextInput,
      reference: receiptReference(nextInput, { version: 4, sourceHash: 'c'.repeat(64) }),
    }))

    const writes = (await readExecutionTrace(prisma, { scope, turnId: referenceIds.turnId }))
      .filter(event => event.kind === 'MEMORY_WRITTEN')
    expect(writes).toHaveLength(2)
    expect(writes.map(event => event.payload.receipt.reference.version)).toEqual([3, 4])
    expect(writes[0].payload.receipt.reference.sourceHash).toBe('b'.repeat(64))
    expect(writes[1].payload.receipt.reference.sourceHash).toBe('c'.repeat(64))
  })

  it('does not bind a memory receipt across execution, turn or business scope', async () => {
    const referenceIds = ids()
    const input = writeInput()
    await appendParents(referenceIds, input)

    const foreignCases = [
      { label: 'execution', executionId: randomUUID(), eventScope: scope, turnId: referenceIds.turnId },
      { label: 'turn', executionId: referenceIds.executionId, eventScope: scope, turnId: randomUUID() },
      { label: 'business', executionId: referenceIds.executionId, eventScope: foreignScope, turnId: referenceIds.turnId },
    ]
    for (const foreign of foreignCases) {
      const event = memoryEvent({ ...referenceIds, executionId: foreign.executionId, turnId: foreign.turnId }, {
        eventScope: foreign.eventScope,
        input,
      })
      const before = await eventCount(foreign.eventScope, foreign.turnId)
      await expect(appendTraceEvent(prisma, event))
        .rejects.toThrow('MEMORY_TRACE_CONTEXT_MISSING_OR_CONFLICTING')
      expect(await eventCount(foreign.eventScope, foreign.turnId)).toBe(before)
    }
  })

  it('rejects missing, conflicting and hash-invalid context or action parents without storing a row', async () => {
    const missingIds = ids()
    const missingInput = writeInput()
    await expectRejectedWithoutRow(memoryEvent(missingIds, { input: missingInput }), 'MEMORY_TRACE_CONTEXT_MISSING_OR_CONFLICTING')

    const contextHashIds = ids()
    const contextHashInput = writeInput()
    await appendTraceEvent(prisma, contextEvent(contextHashIds, { requestHash: 'f'.repeat(64) }))
    await appendTraceEvent(prisma, actionEvent(contextHashIds, { input: contextHashInput }))
    await expectRejectedWithoutRow(memoryEvent(contextHashIds, { input: contextHashInput }), 'MEMORY_TRACE_CONTEXT_INVALID')

    const actionHashIds = ids()
    const actionHashInput = writeInput()
    await appendTraceEvent(prisma, contextEvent(actionHashIds))
    await appendTraceEvent(prisma, actionEvent(actionHashIds, { input: actionHashInput, inputHash: 'f'.repeat(64) }))
    await expectRejectedWithoutRow(memoryEvent(actionHashIds, { input: actionHashInput }), 'MEMORY_TRACE_ACTION_INPUT_INVALID')

    const conflictingContextIds = ids()
    const conflictingContextInput = writeInput()
    await appendTraceEvent(prisma, contextEvent(conflictingContextIds, { requestBody: { model: 'one' } }))
    await appendTraceEvent(prisma, contextEvent(conflictingContextIds, { requestBody: { model: 'two' } }))
    await appendTraceEvent(prisma, actionEvent(conflictingContextIds, { input: conflictingContextInput }))
    await expectRejectedWithoutRow(memoryEvent(conflictingContextIds, { input: conflictingContextInput }), 'MEMORY_TRACE_CONTEXT_MISSING_OR_CONFLICTING')

    const conflictingActionIds = ids()
    const conflictingActionInput = writeInput()
    await appendTraceEvent(prisma, contextEvent(conflictingActionIds))
    await appendTraceEvent(prisma, actionEvent(conflictingActionIds, { input: conflictingActionInput }))
    await appendTraceEvent(prisma, actionEvent(conflictingActionIds, { input: conflictingActionInput }))
    await expectRejectedWithoutRow(memoryEvent(conflictingActionIds, { input: conflictingActionInput }), 'MEMORY_TRACE_ACTION_MISSING_OR_CONFLICTING')
  })

  it('rejects extra action fields and receipt key or body-hash substitutions', async () => {
    const extraIds = ids()
    const extraInput = writeInput({ extra: 'must-be-rejected' })
    await appendTraceEvent(prisma, contextEvent(extraIds))
    await appendTraceEvent(prisma, actionEvent(extraIds, { input: extraInput }))
    await expectRejectedWithoutRow(memoryEvent(extraIds, { input: extraInput }), 'MEMORY_TRACE_ACTION_TARGET_INVALID')

    for (const mismatch of ['key', 'snapshotHash']) {
      const referenceIds = ids()
      const input = writeInput({ key: 'target-key', bodyHash: sha256({ value: mismatch }) })
      await appendParents(referenceIds, input)
      const reference = receiptReference(input)
      if (mismatch === 'key') reference.key = 'other-key'
      else reference.snapshotHash = sha256({ value: 'different-body' })
      await expectRejectedWithoutRow(memoryEvent(referenceIds, { input, reference }), 'MEMORY_TRACE_WRITE_TARGET_MISMATCH')
    }
  })

  it('rejects acknowledged receipts with incomplete reference metadata', async () => {
    const referenceIds = ids()
    const input = writeInput()
    await appendParents(referenceIds, input)
    const reference = receiptReference(input, { version: null })
    await expectRejectedWithoutRow(memoryEvent(referenceIds, { input, reference }), 'MEMORY_TRACE_PAYLOAD_INVALID')
  })

  it.each(['UNAVAILABLE', 'UNKNOWN'])('records a %s receipt but keeps playback incomplete and explicit', async status => {
    const referenceIds = ids()
    const input = writeInput()
    await appendParents(referenceIds, input)
    await appendTraceEvent(prisma, memoryEvent(referenceIds, { input, status }))

    const playback = playbackTrace(await readExecutionTrace(prisma, { scope, turnId: referenceIds.turnId }))
    expect(playback.playbackStatus).toBe('REPLAY_INCOMPLETE')
    expect(playback.memoryWrites).toHaveLength(1)
    expect(playback.memoryWrites[0]).toMatchObject({
      status: 'REPLAY_INCOMPLETE',
      evidence: { receipt: { status, reference: null } },
    })
    expect(playback.memoryWrites[0].reasons).toEqual(expect.arrayContaining([
      'MEMORY_RECEIPT_INCOMPLETE',
      'MSP_SESSION_AUTHORITY_UNAVAILABLE',
    ]))
  })

  it('marks an old or imported orphan memory event incomplete without inventing parents', () => {
    const referenceIds = ids()
    const input = writeInput()
    const playback = playbackTrace([{
      id: randomUUID(),
      tenantId: scope.tenantId,
      businessId: scope.businessId,
      turnId: referenceIds.turnId,
      executionId: referenceIds.executionId,
      kind: 'MEMORY_WRITTEN',
      payload: memoryEvent(referenceIds, { input }).payload,
    }])

    expect(playback.memoryWrites).toHaveLength(1)
    expect(playback.memoryWrites[0]).toMatchObject({ status: 'REPLAY_INCOMPLETE', evidence: null })
    expect(playback.memoryWrites[0].reasons).toEqual(expect.arrayContaining([
      'MEMORY_TRACE_CONTEXT_MISSING_OR_CONFLICTING',
      'MEMORY_TRACE_ACTION_MISSING_OR_CONFLICTING',
    ]))
  })

  it('hides memory writes after a tombstone and denies a late append', async () => {
    const referenceIds = ids()
    const input = writeInput()
    await appendParents(referenceIds, input)
    await appendTraceEvent(prisma, memoryEvent(referenceIds, { input }))
    await redactTraceTurn(prisma, { scope, turnId: referenceIds.turnId, now: new Date('2026-09-08T00:10:00.000Z') })

    const events = await readExecutionTrace(prisma, { scope, turnId: referenceIds.turnId })
    const playback = playbackTrace(events)
    expect(playback.memoryWrites).toEqual([])
    expect(playback.reasons).toContain('RETENTION_TOMBSTONE')
    await expect(appendTraceEvent(prisma, memoryEvent(referenceIds, { input })))
      .rejects.toMatchObject({ code: 'EXECUTION_TRACE_TURN_REDACTED', status: 409 })
  })
})
