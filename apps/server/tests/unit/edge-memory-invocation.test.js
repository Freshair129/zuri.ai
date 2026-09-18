import { describe, it, expect, vi } from 'vitest'
import { validateEdgeMemoryInvocation } from '@/modules/agent/edge-memory-invocation'
import { createHash } from 'node:crypto'
vi.mock('@/modules/agent/edge-invocation-trace', () => ({ enqueueEdgeInvocationTrace: vi.fn() }))

// @req FR-232, FR-234
// @spec SEC-018, SEC-025, ADR-091 D7
// @tested this file
const executionId = '00000000-0000-4000-8000-000000000001'
const input = { version: 2, executionId, contextHash: 'a'.repeat(64) }
const deviceContext = { isEdgeDevice: true, credentialId: 'device', tenantId: 't', businessId: 'b' }
const job = () => ({ id: 'job', memorySyncOptIn: true, leaseExpiresAt: new Date(Date.now() + 100000),
  expiresAt: new Date(Date.now() + 100000), replyExpiresAt: new Date(Date.now() + 40000), transportEpoch: 3,
  account: { serverEnabled: true, status: 'CONNECTED', transportMode: 'CLOUD', transportEpoch: 3 } })
const commitment = (answerDeadlineAt = new Date(Date.now() + 35000), deliveryMode = 'REPLY') => ({
  payloadJson: JSON.stringify({ contractVersion: '2', memoryContextHash: input.contextHash,
    executionBudget: { answerDeadlineAt: answerDeadlineAt.toISOString(), deliveryMode } }),
})
const database = () => ({ lineConversationJob: { findFirst: vi.fn(async () => job()) },
  agentTraceEvent: { findFirst: vi.fn(async () => commitment()) } })
describe('memory invocation fence', () => {
  it('refuses content-bearing model and receipt tags before reading the claim', async () => {
    const db = database()
    for (const tags of [{ id: 'receipt', modelRef: 'customer secret\ntext' }, { id: 'receipt secret', modelRef: 'local:model' }]) {
      await expect(validateEdgeMemoryInvocation('job', { ...input, injection: {
        ...tags, state: 'SUBMITTED', mspRefs: [] } }, { deviceContext, db })).rejects.toThrow()
    }
    expect(db.lineConversationJob.findFirst).not.toHaveBeenCalled()
  })
  it('records exact selected MSP slices under each actual invocation id, refusing fabricated refs', async () => {
    const recordInjection = vi.fn(async () => ({}))
    const slices = [{ id: 'kept', threadId: 'thread', text: 'included memory' }, { id: 'trimmed', threadId: 'thread', text: 'excluded memory' }]
    const contextBuilder = async (_job, options) => {
      options.onContextResolved({ port: { recordInjection }, threadId: 'thread', exchangeId: 'exchange',
        authorization: { authContext: {} }, requesterId: 'person', slices })
      return { contextHash: input.contextHash }
    }
    const db = database()
    for (const state of ['RESOLVED', 'SUBMITTED', 'COMPLETED']) {
      await validateEdgeMemoryInvocation('job', { ...input, injection: { id: 'ctxrcpt_test',
        modelRef: 'openai-compatible:qwen3.5:9b', state, mspRefs: ['kept'] } }, { deviceContext, db, contextBuilder })
    }
    const expectedHash = createHash('sha256').update(JSON.stringify({ threadId: 'thread', slices: slices.slice(0, 1) })).digest('hex')
    expect(recordInjection.mock.calls.map(([call]) => call.state)).toEqual(['RESOLVED', 'SUBMITTED', 'COMPLETED'])
    expect(recordInjection.mock.calls.every(([call]) => call.packetHash === expectedHash && call.injectionId === 'ctxrcpt_test')).toBe(true)
    await expect(validateEdgeMemoryInvocation('job', { ...input, injection: { id: 'ctxrcpt_test', modelRef: 'local:model',
      state: 'RESOLVED', mspRefs: ['fabricated'] } }, { deviceContext, db, contextBuilder })).rejects.toMatchObject({ status: 409 })
    expect(recordInjection).toHaveBeenCalledTimes(3)
  })
  it('binds the exact Edge execution and returns nothing for unchanged authorized context', async () => {
    const db = database()
    const contextBuilder = vi.fn(async () => ({ contextHash: input.contextHash }))
    expect(await validateEdgeMemoryInvocation('job', input, { deviceContext, db, contextBuilder })).toBeUndefined()
    expect(db.lineConversationJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      tenantId: 't', businessId: 'b', claimantId: 'device', version: 2, executionId, status: 'CLAIMED', executionMode: 'EDGE' }) }))
    expect(db.agentTraceEvent.findFirst).toHaveBeenCalledWith({ where: {
      turnId: 'job', executionId, tenantId: 't', businessId: 'b', kind: 'CONTEXT_COMMITTED',
      idempotencyKey: `job:execution:${executionId}:contract`,
    } })
  })
  it('refuses revoked/expired claims before memory reads and modified context before model use', async () => {
    const contextBuilder = vi.fn(async () => ({ contextHash: 'b'.repeat(64) }))
    const db = database()
    await expect(validateEdgeMemoryInvocation('job', input, { deviceContext: {}, db, contextBuilder })).rejects.toMatchObject({ status: 401 })
    for (const row of [null, { ...job(), memorySyncOptIn: false }, { ...job(), errorCode: 'PDPA_ERASURE' },
      { ...job(), account: { ...job().account, transportEpoch: 4 } }, { ...job(), leaseExpiresAt: new Date(0) }]) {
      db.lineConversationJob.findFirst.mockResolvedValueOnce(row)
      await expect(validateEdgeMemoryInvocation('job', input, { deviceContext, db, contextBuilder })).rejects.toMatchObject({ status: 409 })
    }
    expect(contextBuilder).not.toHaveBeenCalled()
    await expect(validateEdgeMemoryInvocation('job', input, { deviceContext, db, contextBuilder })).rejects.toMatchObject({ status: 409 })
  })
  it.each(['REPLY', 'DELAYED_PUSH'])('uses the persisted %s deadline without restarting the budget', async deliveryMode => {
    const db = database()
    const deadline = new Date(Date.now() + 2000)
    db.agentTraceEvent.findFirst.mockResolvedValue(commitment(deadline, deliveryMode))
    db.lineConversationJob.findFirst.mockResolvedValue({ ...job(), replyExpiresAt: new Date(0) })
    const contextBuilder = vi.fn(async () => ({ contextHash: input.contextHash }))
    await validateEdgeMemoryInvocation('job', input, { deviceContext, db, contextBuilder })
    expect(contextBuilder.mock.calls[0][0].answerDeadlineAt).toBe(deadline.toISOString())
    expect(contextBuilder.mock.calls[0][1].budgetMs).toBeLessThanOrEqual(2000)
    await expect(validateEdgeMemoryInvocation('job', input, { deviceContext, db, contextBuilder,
      now: () => deadline })).rejects.toMatchObject({ status: 409 })
    expect(contextBuilder).toHaveBeenCalledTimes(1)
  })
  it('refuses a missing or mismatched commitment before consulting memory', async () => {
    const db = database()
    const contextBuilder = vi.fn()
    for (const row of [null, { payloadJson: '{invalid' }, { payloadJson: JSON.stringify({ contractVersion: '2',
      memoryContextHash: 'b'.repeat(64), executionBudget: { answerDeadlineAt: new Date(Date.now() + 2000).toISOString(), deliveryMode: 'REPLY' } }) }]) {
      db.agentTraceEvent.findFirst.mockResolvedValueOnce(row)
      await expect(validateEdgeMemoryInvocation('job', input, { deviceContext, db, contextBuilder })).rejects.toMatchObject({ status: 409 })
    }
    expect(contextBuilder).not.toHaveBeenCalled()
  })
  it('fails closed when the committed deadline expires while writing the receipt', async () => {
    const db = database()
    let current = new Date()
    const deadline = new Date(current.getTime() + 1000)
    db.agentTraceEvent.findFirst.mockResolvedValue(commitment(deadline))
    const recordInjection = vi.fn(async () => { current = deadline })
    const contextBuilder = async (_job, options) => {
      options.onContextResolved({ port: { recordInjection }, threadId: 'thread', exchangeId: 'exchange', slices: [] })
      return { contextHash: input.contextHash }
    }
    await expect(validateEdgeMemoryInvocation('job', { ...input, injection: { id: 'receipt', modelRef: 'local:model',
      state: 'SUBMITTED', mspRefs: [] } }, { deviceContext, db, contextBuilder, now: () => current })).rejects.toMatchObject({ status: 409 })
    expect(recordInjection).toHaveBeenCalledTimes(1)
  })
})
