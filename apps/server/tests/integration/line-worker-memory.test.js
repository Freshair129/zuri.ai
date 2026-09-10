import { randomUUID } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { admitLineConversation, runLineConversationWorker, readLineConversationTrace } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { reconcileLineMemoryDeliveries } from '@/modules/line-oa-studio/application/line-memory-delivery'
import { redactLineConversationJobs } from '@/modules/line-oa-studio/application/line-job-erasure'
import { createServerLineAnswer } from '@/modules/agent/server-line-answer'
import { playbackTrace } from '@/modules/agent/execution-trace'

// @req FR-149, FR-171 — immutable per-job MSP enrollment, scoped server composition and durable receipt recovery.
// @spec ADR-061, ADR-070, SEC-001, SEC-005 — CRM/provider acceptance remains local truth; MSP receives a bounded receipt only.
// @tested tests/integration/line-worker-memory.test.js

const sealEnv = { ZURI_LINE_REPLY_SEAL_KEY: 'c7'.repeat(32) }
const now = new Date('2026-09-11T00:00:00.000Z')
let tenant
let business
let provider
let sequence = 0

async function account() {
  const suffix = `${Date.now()}-${++sequence}-${randomUUID().slice(0, 8)}`
  const connection = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id,
    providerId: provider.id, name: `Memory connection ${suffix}`, externalAccountId: `memory-${suffix}`, status: 'ACTIVE' })
  return prisma.lineOaAccount.create({ data: {
    tenantId: tenant.id, businessId: business.id, integrationConnectionId: connection.id,
    code: `memory-${suffix}`, bindingCode: `binding-${suffix}`, displayName: 'Memory OA',
    serverEnabled: true, transportMode: 'CLOUD', status: 'CONNECTED', executionMode: 'SERVER',
    modelAccess: 'LOCAL_ONLY', transportEpoch: 1,
  } })
}

function event(suffix, source = 'user') {
  const sourceRow = source === 'group'
    ? { type: 'group', groupId: `group-${suffix}`, userId: `user-${suffix}` }
    : source === 'room'
      ? { type: 'room', roomId: `room-${suffix}`, userId: `user-${suffix}` }
      : { type: 'user', userId: `user-${suffix}` }
  return { type: 'message', webhookEventId: `event-${suffix}`, replyToken: `reply-${suffix}`,
    source: sourceRow, message: { type: 'text', id: `message-${suffix}`,
      text: source === 'group' ? 'ซูริ AB-1 ราคาเท่าไร' : 'AB-1 ราคาเท่าไร' } }
}

async function admittedFixture({ optIn = true, source = 'user' } = {}) {
  const oa = await account()
  const suffix = `${++sequence}-${randomUUID().slice(0, 8)}`
  const admitted = await admitLineConversation({ account: oa, event: event(suffix, source), correlationId: `corr-${suffix}`,
    now, env: { ...sealEnv, ...(optIn ? { ZURI_MSP_THREAD_MEMORY_ENABLED: 'true' } : {}) } })
  return { oa, ...admitted, env: { ...sealEnv, ...(optIn ? { ZURI_MSP_THREAD_MEMORY_ENABLED: 'true' } : {}) } }
}

function workerFor(fixture, over = {}) {
  const answer = vi.fn(async () => ({ text: `durable answer ${fixture.jobId}` }))
  const send = vi.fn(async () => ({ status: 'ACCEPTED_BY_LINE', requestId: `line-request-${fixture.jobId}`, messageId: `line-message-${fixture.jobId}` }))
  return {
    db: prisma, env: fixture.env, now: () => now, workerId: `worker-${fixture.jobId}`,
    answer, resolveAccount: vi.fn(async id => prisma.lineOaAccount.findUnique({ where: { id } })),
    replyTransport: { send }, pushTransport: { send: vi.fn() }, send, ...over,
  }
}

function policyFor(audienceKind = 'DIRECT', overrides = {}) {
  return vi.fn(async ({ serverScope }) => ({
    authContext: { scope: { tenantId: tenant.id, businessId: business.id }, transport: { signatureVerified: true } },
    policy: {
      decision: audienceKind === 'DIRECT' ? 'ALLOW' : 'DENY',
      privateMemoryAllowed: audienceKind === 'DIRECT',
      mspAuthorization: { read: audienceKind === 'DIRECT', writePrivate: false, writeShared: false },
      ...overrides,
    },
    serverScope,
  }))
}

function traceViewer() {
  return makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: ['line-oa'] })
}

async function runToPending(fixture) {
  const worker = workerFor(fixture)
  const result = await runLineConversationWorker(worker)
  expect(result).toMatchObject({ status: 'RECORDED' })
  const row = await prisma.lineConversationJob.findUnique({ where: { id: fixture.jobId } })
  expect(row).toMatchObject({ memorySyncOptIn: true, memoryDeliveryState: 'PENDING', memoryDeliveryAttempts: 0 })
  return { worker, row }
}

beforeAll(async () => {
  const portfolio = await createPortfolio({ code: 'PF-LINE-MEMORY', name: 'LINE memory' })
  tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-LINE-MEMORY', name: 'LINE memory' })
  business = await createBusiness({ tenantId: tenant.id, code: 'BUS-LINE-MEMORY', name: 'LINE memory' })
  provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA memory' })
})

afterEach(async () => {
  await prisma.lineConversationJob.deleteMany({ where: { tenantId: tenant.id } })
})

describe('LINE memory enrollment and receipt recovery', () => {
  it('captures admission once: later flag changes neither enroll old work nor drop an opted-in job', async () => {
    const off = await admittedFixture({ optIn: false })
    const offRow = await prisma.lineConversationJob.findUnique({ where: { id: off.jobId } })
    expect(offRow).toMatchObject({ memorySyncOptIn: false, memoryDeliveryState: 'NONE', audienceKind: 'DIRECT' })

    const on = await admittedFixture({ optIn: true })
    const onRow = await prisma.lineConversationJob.findUnique({ where: { id: on.jobId } })
    expect(onRow).toMatchObject({ memorySyncOptIn: true, memoryDeliveryState: 'NONE', audienceKind: 'DIRECT' })
    await admitLineConversation({ account: on.oa, event: event('unused-different-event'), correlationId: 'different',
      now, env: sealEnv })
    expect(await prisma.lineConversationJob.findUnique({ where: { id: on.jobId } })).toMatchObject({ memorySyncOptIn: true })
  })

  it('reconciles the persisted CRM body once and acknowledges only a valid MSP receipt', async () => {
    const fixture = await admittedFixture()
    const { worker } = await runToPending(fixture)
    const pendingTrace = await readLineConversationTrace(fixture.jobId, { viewer: traceViewer() })
    expect(pendingTrace.playback.memoryDelivery[0]).toMatchObject({ jobId: fixture.jobId, state: 'PENDING' })
    const outbound = await prisma.message.findFirst({ where: { conversationId: (await prisma.message.findUnique({ where: { id: fixture.inboundMessageId } })).conversationId, direction: 'OUTBOUND' } })
    await prisma.lineConversationJob.update({ where: { id: fixture.jobId }, data: { answerText: 'tampered answer must not be read' } })
    const recordDelivery = vi.fn(async input => ({ receiptId: input.receiptId, messageId: 'msp-message-1', outcome: 'ACCEPTED' }))
    const result = await reconcileLineMemoryDeliveries({ db: prisma, threadMemory: { recordDelivery }, now: () => now,
      workerId: 'scanner-1', policyResolver: policyFor() })
    expect(result).toMatchObject({ scanned: 1, acknowledged: 1, pending: 0 })
    expect(recordDelivery).toHaveBeenCalledOnce()
    expect(recordDelivery.mock.calls[0][0]).toMatchObject({ receiptId: outbound.id, text: `durable answer ${fixture.jobId}`,
      inboundMessageId: fixture.inboundMessageId })
    expect(recordDelivery.mock.calls[0][0].text).not.toContain('tampered')
    expect(await prisma.lineConversationJob.findUnique({ where: { id: fixture.jobId } })).toMatchObject({ memoryDeliveryState: 'ACKNOWLEDGED', memoryDeliveryLeaseUntil: null })
    expect((await reconcileLineMemoryDeliveries({ db: prisma, threadMemory: { recordDelivery }, now: () => now,
      workerId: 'scanner-2', policyResolver: policyFor() })).scanned).toBe(0)
    expect(recordDelivery).toHaveBeenCalledOnce()
    expect(worker.send).toHaveBeenCalledOnce()
    const events = await readLineConversationTrace(fixture.jobId, { viewer: traceViewer() })
    const memoryEvents = events.events.filter(item => item.kind.startsWith('MEMORY_DELIVERY_'))
    expect(memoryEvents.map(item => item.kind)).toEqual(['MEMORY_DELIVERY_PENDING', 'MEMORY_DELIVERY_ATTEMPT', 'MEMORY_DELIVERY_ACKNOWLEDGED'])
    expect(memoryEvents.every(item => !JSON.stringify(item.payload).includes('tampered'))).toBe(true)
  })

  it('accepts durable PENDING_INBOUND but leaves malformed or mismatched receipts pending', async () => {
    const fixture = await admittedFixture()
    await runToPending(fixture)
    const malformed = vi.fn(async input => ({ receiptId: input.receiptId }))
    const first = await reconcileLineMemoryDeliveries({ db: prisma, threadMemory: { recordDelivery: malformed }, now: () => now,
      policyResolver: policyFor(), workerId: 'scanner-malformed' })
    expect(first).toMatchObject({ scanned: 1, pending: 1, acknowledged: 0, unknown: 1 })
    expect(await prisma.lineConversationJob.findUnique({ where: { id: fixture.jobId } })).toMatchObject({ memoryDeliveryState: 'PENDING', memoryDeliveryAttempts: 1 })
    const unknownTrace = await readLineConversationTrace(fixture.jobId, { viewer: traceViewer() })
    expect(unknownTrace.playback.memoryDelivery[0].state).toBe('UNKNOWN')

    await prisma.lineConversationJob.update({ where: { id: fixture.jobId }, data: { memoryDeliveryNextAttemptAt: new Date(now.getTime() - 1) } })
    const inboundPending = vi.fn(async input => ({ receiptId: input.receiptId, status: 'PENDING_INBOUND' }))
    const second = await reconcileLineMemoryDeliveries({ db: prisma, threadMemory: { recordDelivery: inboundPending }, now: () => now,
      policyResolver: policyFor(), workerId: 'scanner-pending-inbound' })
    expect(second).toMatchObject({ scanned: 1, acknowledged: 1, pending: 0 })
    const trace = await readLineConversationTrace(fixture.jobId, { viewer: traceViewer() })
    expect(trace.events.find(item => item.kind === 'MEMORY_DELIVERY_ACKNOWLEDGED').payload).toMatchObject({ outcome: 'PENDING_INBOUND' })
  })

  it('loses a stale claim before MSP when a competing local update advances the version', async () => {
    const fixture = await admittedFixture()
    await runToPending(fixture)
    const recordDelivery = vi.fn()
    let policyCalls = 0
    const policyResolver = vi.fn(async input => {
      policyCalls += 1
      if (policyCalls === 1) await prisma.lineConversationJob.update({ where: { id: fixture.jobId }, data: { version: { increment: 1 } } })
      return policyFor()(input)
    })
    const result = await reconcileLineMemoryDeliveries({ db: prisma, threadMemory: { recordDelivery }, now: () => now,
      policyResolver, workerId: 'scanner-stale' })
    expect(result).toMatchObject({ scanned: 1, acknowledged: 0 })
    expect(recordDelivery).not.toHaveBeenCalled()
    expect((await prisma.lineConversationJob.findUnique({ where: { id: fixture.jobId } })).memoryDeliveryState).toBe('PENDING')
  })

  it('closes disabled-account and erasure races without calling MSP or recreating text', async () => {
    const disabled = await admittedFixture()
    await runToPending(disabled)
    await prisma.lineOaAccount.update({ where: { id: disabled.oa.id }, data: { serverEnabled: false, transportEpoch: { increment: 1 } } })
    const disabledRecord = vi.fn()
    const disabledResult = await reconcileLineMemoryDeliveries({ db: prisma, threadMemory: { recordDelivery: disabledRecord }, now: () => now,
      policyResolver: policyFor(), workerId: 'scanner-disabled' })
    expect(disabledResult.closed).toBe(1)
    expect(disabledRecord).not.toHaveBeenCalled()
    expect((await prisma.lineConversationJob.findUnique({ where: { id: disabled.jobId } })).memoryDeliveryState).toBe('CLOSED')

    const erased = await admittedFixture()
    await runToPending(erased)
    const inbound = await prisma.message.findUnique({ where: { id: erased.inboundMessageId } })
    await prisma.$transaction(tx => redactLineConversationJobs(tx, { tenantId: tenant.id, conversationIds: [inbound.conversationId] }))
    const erasedRecord = vi.fn()
    expect((await prisma.lineConversationJob.findUnique({ where: { id: erased.jobId } })).memoryDeliveryState).toBe('CLOSED')
    expect((await reconcileLineMemoryDeliveries({ db: prisma, threadMemory: { recordDelivery: erasedRecord }, now: () => now,
      policyResolver: policyFor(), workerId: 'scanner-erased' })).scanned).toBe(0)
    expect(erasedRecord).not.toHaveBeenCalled()
    expect(JSON.stringify(await readLineConversationTrace(erased.jobId, { viewer: traceViewer() }))).not.toContain('durable answer')
  })

  it('requires an affirmative shared transcript grant for signed group receipts', async () => {
    const fixture = await admittedFixture({ source: 'group' })
    await runToPending(fixture)
    const recordDelivery = vi.fn()
    const result = await reconcileLineMemoryDeliveries({ db: prisma, threadMemory: { recordDelivery }, now: () => now,
      policyResolver: policyFor('GROUP'), workerId: 'scanner-group-denied' })
    expect(result).toMatchObject({ scanned: 1, closed: 1, acknowledged: 0 })
    expect(recordDelivery).not.toHaveBeenCalled()
    expect((await prisma.lineConversationJob.findUnique({ where: { id: fixture.jobId } })).memoryDeliveryState).toBe('CLOSED')
  })
})

describe('server answer memory composition', () => {
  function answerJob(audienceKind = 'DIRECT') {
    return { tenantId: tenant.id, businessId: business.id, account: { tenantId: tenant.id, businessId: business.id, bindingCode: 'memory-binding' },
      channelAccountId: 'memory-binding', transportEpoch: 1, executionMode: 'SERVER', modelAccess: 'LOCAL_ONLY',
      memorySyncOptIn: true, audienceKind, eventId: `event-${audienceKind}`, sourceUserId: `user-${audienceKind}`,
      inbound: { id: `inbound-${audienceKind}`, body: 'AB-1 ราคาเท่าไร', conversation: { tenantId: tenant.id, businessId: business.id,
        channel: 'LINE', channelAccountId: 'memory-binding', externalThreadId: `thread-${audienceKind}` } } }
  }

  function composed(audienceKind, authorizationOverrides = {}) {
    const appendMessage = vi.fn(async input => input.direction === 'INBOUND'
      ? { message: { messageId: 'msp-inbound', exchangeId: 'msp-exchange' }, session: { sessionId: 'msp-session' } }
      : { message: { messageId: 'msp-agent', exchangeId: 'msp-exchange' }, session: { sessionId: 'msp-session' } })
    const threadMemory = { appendMessage, withInjectionReceipt: vi.fn(({ model }) => model) }
    const contextAssembler = vi.fn(async input => ({
      identity: { principalId: 'person-memory', verified: true }, thread: { threadId: 'msp-thread' },
      authContext: { scope: { tenantId: tenant.id, businessId: business.id } },
      policy: { version: 'memory-policy-v1', privateMemoryAllowed: audienceKind === 'DIRECT' },
      threadMemory: { policyDecision: audienceKind === 'DIRECT' ? 'ALLOW' : 'DENY', thread: { threadId: 'msp-thread', audienceKind }, memory: {} },
      input,
    }))
    const authorizationResolver = policyFor(audienceKind, authorizationOverrides)
    const answer = createServerLineAnswer({ threadMemory, contextAssembler, authorizationResolver,
      knowledge: { query: vi.fn(async () => ({ records: [{ name: 'แก้ว', product_code: 'AB-1', sell_price: 50,
        currency: 'THB', unit: 'ชิ้น', moq: 1, specification: {}, as_of: now.toISOString() }] })) } })
    return { answer, appendMessage, contextAssembler, authorizationResolver, threadMemory }
  }

  it('projects the admitted CRM inbound once, uses the trusted packet and queues one agent message', async () => {
    const composedAnswer = composed('DIRECT')
    const trace = { recordThreadMemory: vi.fn(), recordEvidence: vi.fn(), assertHealthy: vi.fn() }
    const result = await composedAnswer.answer(answerJob(), { trace })
    expect(result).toContain('AB-1')
    expect(composedAnswer.appendMessage).toHaveBeenCalledTimes(2)
    expect(composedAnswer.appendMessage.mock.calls[0][0]).toMatchObject({ direction: 'INBOUND', messageId: 'inbound-DIRECT', speakerKind: 'HUMAN' })
    expect(composedAnswer.appendMessage.mock.calls[1][0]).toMatchObject({ direction: 'OUTBOUND', deliveryState: 'QUEUED', replyToMessageId: 'msp-inbound' })
    expect(trace.recordThreadMemory).toHaveBeenCalledWith(expect.objectContaining({ inboundMessageId: 'msp-inbound', exchangeId: 'msp-exchange' }))
  })

  it('keeps group and room context denied even when transport signature is verified', async () => {
    for (const audienceKind of ['GROUP', 'ROOM']) {
      const composedAnswer = composed(audienceKind)
      const result = await composedAnswer.answer(answerJob(audienceKind))
      expect(result).toContain('AB-1')
      expect(composedAnswer.contextAssembler.mock.calls[1][0].threadRoute).toMatchObject({ audienceKind })
      expect(composedAnswer.appendMessage.mock.calls[0][0]).toMatchObject({ direction: 'INBOUND' })
      expect(composedAnswer.appendMessage.mock.calls[1][0]).toMatchObject({ direction: 'OUTBOUND', deliveryState: 'QUEUED' })
    }
    const deniedByAudience = composed('GROUP', { decision: 'ALLOW', privateMemoryAllowed: true, mspAuthorization: { read: true } })
    await expect(deniedByAudience.answer(answerJob('GROUP'))).rejects.toThrow('LINE_ANSWER_UNAVAILABLE')
    expect(deniedByAudience.appendMessage).toHaveBeenCalledOnce()
    expect(deniedByAudience.appendMessage.mock.calls[0][0].direction).toBe('INBOUND')
  })

  it('fails closed when direct private policy is revoked before the agent append', async () => {
    const composedAnswer = composed('DIRECT')
    composedAnswer.authorizationResolver.mockResolvedValueOnce({
      authContext: { scope: { tenantId: tenant.id, businessId: business.id }, transport: { signatureVerified: true } },
      policy: { decision: 'DENY', privateMemoryAllowed: false, mspAuthorization: { read: false } },
    })
    await expect(composedAnswer.answer(answerJob('DIRECT'))).rejects.toThrow('LINE_ANSWER_UNAVAILABLE')
    expect(composedAnswer.appendMessage).toHaveBeenCalledOnce()
    expect(composedAnswer.appendMessage.mock.calls[0][0].direction).toBe('INBOUND')
  })

  it('fails closed when the opted-in adapter has no injection receipt boundary', async () => {
    const appendMessage = vi.fn()
    const answer = createServerLineAnswer({
      threadMemory: { appendMessage },
      knowledge: { query: vi.fn(async () => ({ records: [] })) },
      contextAssembler: vi.fn(), authorizationResolver: vi.fn(),
    })
    await expect(answer(answerJob())).rejects.toThrow('LINE_ANSWER_UNAVAILABLE')
    expect(appendMessage).not.toHaveBeenCalled()
  })

  it('keeps an unknown model injection receipt UNKNOWN and never sends or reinvokes it', async () => {
    const fixture = await admittedFixture()
    const appendMessage = vi.fn(async input => input.direction === 'INBOUND'
      ? { message: { messageId: 'msp-inbound-unknown', exchangeId: 'msp-exchange-unknown' }, session: { sessionId: 'msp-session-unknown' } }
      : { message: { messageId: 'msp-agent-unknown', exchangeId: 'msp-exchange-unknown' }, session: { sessionId: 'msp-session-unknown' } })
    const threadMemory = {
      appendMessage,
      withInjectionReceipt: vi.fn(({ model }) => ({ ...model,
        async generate() { throw Object.assign(new Error('receipt outcome unknown'), { code: 'MSP_INJECTION_RECEIPT_UNKNOWN' }) },
      })),
    }
    const contextAssembler = vi.fn(async () => ({
      identity: { principalId: 'person-memory-unknown', verified: true },
      thread: { threadId: 'msp-thread-unknown' },
      authContext: { scope: { tenantId: tenant.id, businessId: business.id } },
      policy: { version: 'memory-policy-unknown', privateMemoryAllowed: true },
      threadMemory: { policyDecision: 'ALLOW', thread: { threadId: 'msp-thread-unknown' }, memory: [] },
    }))
    const answer = vi.fn(createServerLineAnswer({ threadMemory, contextAssembler,
      knowledge: { query: vi.fn(async () => ({ records: [{ name: 'แก้ว', product_code: 'AB-1', sell_price: 50,
        currency: 'THB', unit: 'ชิ้น', moq: 1, specification: {}, as_of: now.toISOString() }] })) } }))
    const worker = workerFor(fixture, { answer })
    const first = await runLineConversationWorker(worker)
    expect(first).toMatchObject({ id: fixture.jobId, status: 'UNKNOWN', executed: 1, sent: 0 })
    expect(answer).toHaveBeenCalledOnce()
    expect(threadMemory.withInjectionReceipt).toHaveBeenCalledOnce()
    expect(appendMessage).toHaveBeenCalledOnce()
    expect(worker.send).not.toHaveBeenCalled()
    expect(await prisma.lineConversationJob.findUnique({ where: { id: fixture.jobId } })).toMatchObject({
      status: 'UNKNOWN', errorCode: 'MSP_INJECTION_RECEIPT_UNKNOWN', answerText: null,
    })
    const trace = await readLineConversationTrace(fixture.jobId, { viewer: traceViewer() })
    expect(trace.events.find(item => item.kind === 'EXECUTION_FAILED').payload).toMatchObject({
      errorCode: 'MSP_INJECTION_RECEIPT_UNKNOWN', outcome: 'UNKNOWN',
    })
    expect(trace.playback.status).toBe('REPLAY_INCOMPLETE')

    const second = await runLineConversationWorker(worker)
    expect(second).toEqual({ status: 'IDLE' })
    expect(answer).toHaveBeenCalledOnce()
    expect(worker.send).not.toHaveBeenCalled()
  })

  it('rechecks the claimed job before each memory boundary and stops after erasure', async () => {
    const composedAnswer = composed('DIRECT')
    let reads = 0
    const memoryStateReader = vi.fn(async () => {
      reads += 1
      return reads < 3
        ? { memorySyncOptIn: true, status: 'CLAIMED', version: 7 }
        : { memorySyncOptIn: true, status: 'CLAIMED', version: 7, errorCode: 'PDPA_ERASURE' }
    })
    await expect(composedAnswer.answer({ ...answerJob(), version: 7 }, { memoryStateReader })).rejects.toThrow('LINE_ANSWER_UNAVAILABLE')
    expect(reads).toBe(3)
    expect(composedAnswer.appendMessage).toHaveBeenCalledOnce()
    expect(composedAnswer.appendMessage.mock.calls[0][0].direction).toBe('INBOUND')
  })

  it('rejects an unknown MSP agent append response instead of claiming queued memory', async () => {
    const composedAnswer = composed('DIRECT')
    composedAnswer.appendMessage.mockResolvedValueOnce({ message: { messageId: 'msp-inbound', exchangeId: 'msp-exchange' }, session: { sessionId: 'msp-session' } })
      .mockResolvedValueOnce({ message: { messageId: 'msp-agent', exchangeId: 'wrong-exchange' }, session: { sessionId: 'msp-session' } })
    await expect(composedAnswer.answer(answerJob())).rejects.toThrow('LINE_ANSWER_UNAVAILABLE')
    expect(composedAnswer.appendMessage).toHaveBeenCalledTimes(2)
  })

  it('renders a synthetic memory checkpoint status without treating provider acceptance as delivery', () => {
    const jobId = randomUUID()
    const pending = playbackTrace([
      { id: 'memory-pending', executionId: null, kind: 'MEMORY_DELIVERY_PENDING', payload: { jobId } },
      { id: 'memory-attempt', executionId: null, kind: 'MEMORY_DELIVERY_ATTEMPT', payload: { jobId, attemptNumber: 1, outcome: 'UNKNOWN' } },
    ])
    expect(pending.memoryDelivery[0]).toMatchObject({ jobId, state: 'UNKNOWN' })
    expect(pending.deliveries).toEqual([])
  })
})
