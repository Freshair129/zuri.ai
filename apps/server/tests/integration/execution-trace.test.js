import { describe, it, expect, beforeAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import {
  appendTraceEvent,
  canonicalJson,
  MAX_TRACE_PAYLOAD_BYTES,
  playbackTrace,
  readExecutionTrace,
  redactTraceTurn,
  sha256,
  TRACE_EVENT_KINDS,
  validateContextManifest,
} from '@/modules/agent/execution-trace'

// @req FR-171 — durable, replayable execution evidence is scoped, bounded,
// idempotent and retention-aware.
// @spec ADR-070, SEC-001 — context snapshots are hashed; replay never executes
// tools or exposes a partial/latest answer after an incomplete trace.

let scope

beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8)
  const portfolio = await createPortfolio({ name: `Trace Group ${suffix}`, code: `PF-TRACE-${suffix}` })
  const tenant = await createTenant({ portfolioId: portfolio.id, name: `Trace Tenant ${suffix}`, code: `TNT-TRACE-${suffix}` })
  const business = await createBusiness({ tenantId: tenant.id, name: `Trace Business ${suffix}`, code: `BUS-TRACE-${suffix}` })
  scope = { tenantId: tenant.id, businessId: business.id }
})

function input(overrides = {}) {
  return {
    scope,
    turnId: randomUUID(),
    executionId: randomUUID(),
    kind: 'TURN_RECEIVED',
    idempotencyKey: randomUUID(),
    payload: { accepted: true, userText: 'ข้อมูลลูกค้าเป็นข้อมูลที่ถูกต้องตามบริบท' },
    occurredAt: new Date('2026-09-07T00:00:00.000Z'),
    ...overrides,
  }
}

function contextPayload(ctxId, modelCallId, requestBody = { model: 'test-model', input: 'hello' }) {
  return {
    ctxId,
    modelCallId,
    requestBody,
    requestHash: sha256(requestBody),
    contextManifest: {
      memoryVersion: 'memory-v1',
      docVersion: 'docs-v3',
      artifactVersion: 'artifact-v2',
      retrievalRun: 'retrieval-v4',
      soul: null,
      systemPrompt: 'prompt-v7',
    },
  }
}

describe('AgentTraceEvent journal (FR-171)', () => {
  it('keeps the event vocabulary narrow and stores stable, bounded JSON', async () => {
    expect(TRACE_EVENT_KINDS).toContain('EVIDENCE_SELECTED')
    expect(TRACE_EVENT_KINDS).toContain('OUTBOUND_RECORDED')
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}')

    const firstInput = input({ payload: { b: 2, a: 1 } })
    const first = await appendTraceEvent(prisma, firstInput)
    const replay = await appendTraceEvent(prisma, { ...firstInput, payload: { a: 1, b: 2 } })
    expect(replay.id).toBe(first.id)
    expect(replay.payloadJson).toBe('{"a":1,"b":2}')

    await expect(appendTraceEvent(prisma, { ...firstInput, payload: { a: 2, b: 2 } }))
      .rejects.toMatchObject({ code: 'EXECUTION_TRACE_IDEMPOTENCY_CONFLICT', status: 409 })

    await expect(appendTraceEvent(prisma, input({ kind: 'UNKNOWN_KIND' })))
      .rejects.toMatchObject({ code: 'EXECUTION_TRACE_KIND_INVALID' })
    await expect(appendTraceEvent(prisma, input({ payload: { replyToken: 'never-store' } })))
      .rejects.toMatchObject({ code: 'EXECUTION_TRACE_SECRET_FIELD' })
    await expect(appendTraceEvent(prisma, input({ payload: { body: 'x'.repeat(MAX_TRACE_PAYLOAD_BYTES) } })))
      .rejects.toMatchObject({ code: 'EXECUTION_TRACE_PAYLOAD_TOO_LARGE' })
  })

  it('reads only the exact tenant and business scope and works with a caller transaction', async () => {
    const turnId = randomUUID()
    const created = await prisma.$transaction(async (tx) => appendTraceEvent(tx, input({ turnId, kind: 'EXECUTION_STARTED' })))
    const other = await appendTraceEvent(prisma, input({ kind: 'EXECUTION_STARTED' }))

    const events = await readExecutionTrace(prisma, { scope, turnId })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ id: created.id, tenantId: scope.tenantId, businessId: scope.businessId, turnId })
    expect(events[0].payload).toEqual({ accepted: true, userText: 'ข้อมูลลูกค้าเป็นข้อมูลที่ถูกต้องตามบริบท' })
    expect(Object.isFrozen(events)).toBe(true)
    expect(Object.isFrozen(events[0].payload)).toBe(true)

    const wrongBusiness = randomUUID()
    const fakeDb = {
      agentTraceEvent: {
        findMany: async () => [{ ...other, businessId: wrongBusiness }],
        create: async () => { throw new Error('not used') },
      },
    }
    await expect(readExecutionTrace(fakeDb, { scope, turnId: other.turnId }))
      .rejects.toMatchObject({ code: 'EXECUTION_TRACE_SCOPE_MISMATCH', status: 403 })
  })

  it('validates public context references and groups complete, failed and deterministic calls', async () => {
    expect(validateContextManifest({
      memoryVersion: 'memory-v1', docVersion: 'docs-v3', artifactVersion: 'artifact-v2',
      retrievalRun: 'retrieval-v4', soul: null, systemPrompt: 'prompt-v7',
    })).toMatchObject({ memoryVersion: 'memory-v1', systemPrompt: 'prompt-v7' })
    expect(() => validateContextManifest({ memoryVersion: 7 })).toThrow()

    const turnId = randomUUID()
    const executionOne = randomUUID()
    const executionTwo = randomUUID()
    const ctxOne = randomUUID()
    const callOne = randomUUID()
    const ctxTwo = randomUUID()
    const callTwo = randomUUID()
    await appendTraceEvent(prisma, input({ turnId, executionId: executionOne, kind: 'CONTEXT_COMMITTED', idempotencyKey: randomUUID(), payload: contextPayload(ctxOne, callOne) }))
    await appendTraceEvent(prisma, input({ turnId, executionId: executionOne, kind: 'MODEL_COMPLETED', idempotencyKey: randomUUID(), payload: { ctxId: ctxOne, modelCallId: callOne, outputText: 'first answer', timingMs: 9 } }))
    await appendTraceEvent(prisma, input({ turnId, executionId: executionTwo, kind: 'CONTEXT_COMMITTED', idempotencyKey: randomUUID(), payload: contextPayload(ctxTwo, callTwo) }))
    await appendTraceEvent(prisma, input({ turnId, executionId: executionTwo, kind: 'MODEL_FAILED', idempotencyKey: randomUUID(), payload: { ctxId: ctxTwo, modelCallId: callTwo, errorCode: 'MODEL_TIMEOUT', timingMs: 11 } }))

    const complete = playbackTrace(await readExecutionTrace(prisma, { scope, turnId }))
    expect(complete.status).toBe('REPLAY_INCOMPLETE')
    expect(complete.executions).toHaveLength(2)
    expect(complete.modelCalls).toHaveLength(2)
    expect(complete.modelCalls.find((call) => call.modelCallId === callOne)).toMatchObject({ status: 'REPLAY_COMPLETE', output: { outputText: 'first answer' } })
    expect(complete.modelCalls.find((call) => call.modelCallId === callTwo)).toMatchObject({ status: 'REPLAY_INCOMPLETE', output: null })
    expect(Object.isFrozen(complete)).toBe(true)
    expect(Object.isFrozen(complete.modelCalls[0])).toBe(true)

    const deterministic = playbackTrace([{
      executionId: randomUUID(),
      kind: 'ANSWER_READY',
      payload: { text: 'local deterministic answer' },
    }])
    expect(deterministic).toMatchObject({ status: 'REPLAY_COMPLETE', context: null, output: { text: 'local deterministic answer' } })
  })

  it('withholds output when context is missing or its stable hash is wrong', () => {
    const ctxId = randomUUID()
    const callId = randomUUID()
    const missing = playbackTrace([{ kind: 'MODEL_COMPLETED', payload: { ctxId, modelCallId: callId, outputText: 'unsafe' } }])
    expect(missing).toMatchObject({ status: 'REPLAY_INCOMPLETE', output: null })

    const wrongContext = contextPayload(ctxId, callId)
    wrongContext.requestHash = sha256({ model: 'different-model' })
    const mismatched = playbackTrace([
      { kind: 'CONTEXT_COMMITTED', payload: wrongContext },
      { kind: 'MODEL_COMPLETED', payload: { ctxId, modelCallId: callId, outputText: 'unsafe' } },
    ])
    expect(mismatched).toMatchObject({ status: 'REPLAY_INCOMPLETE', output: null })
    expect(mismatched.reasons).toContain('CONTEXT_HASH_MISMATCH')
  })

  it('redacts payloads, leaves journal metadata and permanently closes the turn', async () => {
    const turnId = randomUUID()
    const executionId = randomUUID()
    await appendTraceEvent(prisma, input({ turnId, executionId, kind: 'ANSWER_READY', idempotencyKey: randomUUID(), payload: { answer: 'private answer' } }))
    await appendTraceEvent(prisma, input({ turnId, executionId, kind: 'SEND_RESULT', idempotencyKey: randomUUID(), payload: { providerAcceptance: 'ACCEPTED_BY_LINE' } }))

    const retention = await redactTraceTurn(prisma, { scope, turnId, now: new Date('2026-09-07T01:00:00.000Z') })
    expect(retention.redactedCount).toBe(2)
    expect(retention.tombstone.kind).toBe('RETENTION_TOMBSTONE')
    const events = await readExecutionTrace(prisma, { scope, turnId })
    expect(events).toHaveLength(3)
    expect(events.filter((event) => event.kind !== 'RETENTION_TOMBSTONE').every((event) => event.payload.redacted === true)).toBe(true)
    expect(events.some((event) => event.payloadJson.includes('private answer'))).toBe(false)
    expect(playbackTrace(events)).toMatchObject({ status: 'REPLAY_INCOMPLETE', output: null })
    await expect(appendTraceEvent(prisma, input({ turnId, executionId, kind: 'ANSWER_READY', idempotencyKey: randomUUID(), payload: { answer: 'late callback' } })))
      .rejects.toMatchObject({ code: 'EXECUTION_TRACE_TURN_REDACTED', status: 409 })
  })
})
