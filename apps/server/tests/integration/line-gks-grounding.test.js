import { describe, expect, it, vi } from 'vitest'
import { createServerLineAnswer } from '@/modules/agent/server-line-answer'
import { createDeterministicBusinessModel } from '@/modules/agent/grounded-business-answer'

// @req FR-235 — LINE answer grounding from the published knowledge corpus,
// exercised end to end through createServerLineAnswer: mode selection, the
// corpus reader, the mode-gated fallback, the budget and every trace hop.
// @req FR-265 — these cases reached the business-knowledge reader through the
// `modelAccess: 'LOCAL_ONLY'` branch. That branch is retired (ADR-100 D3), so they
// now reach the same reader through the composed runtime, which is what a real turn
// does, with the deterministic model standing in for the provider. Every grounding
// assertion — mode selection, hops, fallback, budget, receipts — is unchanged.
// @spec ADR-090 D1-D5, ADR-100 D3, SEC-032, SDD-099
// @tested tests/integration/line-gks-grounding.test.js

vi.mock('@/lib/db', () => ({ default: {} }))

const queryKnowledgeCorpusMock = vi.hoisted(() => vi.fn())
vi.mock('@/modules/knowledge/knowledge-corpus-service', () => ({
  queryKnowledgeCorpus: (...args) => queryKnowledgeCorpusMock(...args),
}))

const tenantId = '11111111-1111-4111-8111-111111111111'
const businessId = '22222222-2222-4222-8222-222222222222'
const otherBusinessId = '33333333-3333-4333-8333-333333333333'

/** A composed runtime whose business-knowledge reader is `knowledge`. */
function runtimeWith(knowledge) {
  return vi.fn().mockResolvedValue({
    businessKnowledge: knowledge,
    resolveModel: vi.fn().mockResolvedValue(createDeterministicBusinessModel()),
  })
}

function job({ knowledgeGrounding, tenant = tenantId, business = businessId } = {}) {
  return {
    tenantId: tenant, businessId: business,
    inbound: { body: 'AB-1 ราคาเท่าไร' },
    account: { tenantId: tenant, businessId: business, ...(knowledgeGrounding !== undefined ? { knowledgeGrounding } : {}) },
  }
}

function businessKnowledgeEvidence() {
  return { records: [{ name: 'แก้ว', product_code: 'AB-1', sell_price: 50, currency: 'THB', unit: 'ชิ้น', moq: 1, specification: {}, as_of: '2026-09-01T00:00:00Z' }] }
}

function corpusHit(overrides = {}) {
  return { id: 'hit-1', text: 'AB-1 คือแก้วน้ำ ราคา 50 บาท', score: 0.9, citationId: 'cit-1', sourceId: 'src-1', snapshotId: 'snap-1', generation: 1, ...overrides }
}

function fakeTrace() {
  return {
    recordThreadMemory: vi.fn(),
    recordEvidence: vi.fn(),
    recordContextReceipt: vi.fn(),
    assertHealthy: vi.fn(),
  }
}

describe('FR-235 — LINE knowledge grounding modes', () => {
  it('BUSINESS_KNOWLEDGE (default, no account field): byte-identical trace — one BUSINESS_QUERY hop, no corpus call, no ContextReceipt', async () => {
    queryKnowledgeCorpusMock.mockClear()
    const knowledge = { query: vi.fn().mockResolvedValue(businessKnowledgeEvidence()) }
    const trace = fakeTrace()
    const answer = createServerLineAnswer({ runtimeFactory: runtimeWith(knowledge) })
    const text = await answer(job(), { trace })

    expect(text).toContain('AB-1')
    expect(queryKnowledgeCorpusMock).not.toHaveBeenCalled()
    expect(trace.recordEvidence).toHaveBeenCalledTimes(1)
    const [, evidence, meta] = trace.recordEvidence.mock.calls[0]
    expect(evidence).toEqual(businessKnowledgeEvidence())
    expect(meta).toBeUndefined() // the pre-FR-235 call shape: (query, evidence) only
    expect(trace.recordContextReceipt).not.toHaveBeenCalled()
  })

  it('BUSINESS_KNOWLEDGE (explicit): same byte-identical behaviour as an account with no grounding field', async () => {
    queryKnowledgeCorpusMock.mockClear()
    const knowledge = { query: vi.fn().mockResolvedValue(businessKnowledgeEvidence()) }
    const trace = fakeTrace()
    const answer = createServerLineAnswer({ runtimeFactory: runtimeWith(knowledge) })
    await answer(job({ knowledgeGrounding: 'BUSINESS_KNOWLEDGE' }), { trace })
    expect(queryKnowledgeCorpusMock).not.toHaveBeenCalled()
    expect(trace.recordEvidence).toHaveBeenCalledTimes(1)
  })

  it('an unrecognised grounding value fails closed to BUSINESS_KNOWLEDGE, never to a corpus read', async () => {
    queryKnowledgeCorpusMock.mockClear()
    const knowledge = { query: vi.fn().mockResolvedValue(businessKnowledgeEvidence()) }
    const answer = createServerLineAnswer({ runtimeFactory: runtimeWith(knowledge) })
    await answer(job({ knowledgeGrounding: 'NOT_A_REAL_MODE' }))
    expect(queryKnowledgeCorpusMock).not.toHaveBeenCalled()
  })

  it('GKS_CORPUS (not memory-opt-in): reads the published corpus, traces one GKS_CORPUS hop tagged with the mode, answers from the chunk, and records no ContextReceipt', async () => {
    queryKnowledgeCorpusMock.mockClear()
    queryKnowledgeCorpusMock.mockResolvedValue({ corpusGeneration: 4, manifestHash: 'h'.repeat(64), ranking: 'rrf-k60', results: [corpusHit()] })
    const knowledge = { query: vi.fn() } // must never be read in GKS_CORPUS mode
    const trace = fakeTrace()
    const answer = createServerLineAnswer({ runtimeFactory: runtimeWith(knowledge) })
    const text = await answer(job({ knowledgeGrounding: 'GKS_CORPUS' }), { trace })

    expect(knowledge.query).not.toHaveBeenCalled()
    expect(queryKnowledgeCorpusMock).toHaveBeenCalledTimes(1)
    expect(queryKnowledgeCorpusMock.mock.calls[0][0]).toEqual({ businessId, query: 'AB-1', topK: 5 })
    expect(text).toContain('AB-1')

    expect(trace.recordEvidence).toHaveBeenCalledTimes(1)
    const [, evidence, meta] = trace.recordEvidence.mock.calls[0]
    expect(evidence.records).toHaveLength(1)
    expect(meta).toMatchObject({ mode: 'GKS_CORPUS', source: 'GKS_CORPUS', reason: null })
    expect(meta.retrievalRefs).toEqual([{ citationId: 'cit-1', sourceId: 'src-1', snapshotId: 'snap-1', generation: 1, corpusGeneration: 4, manifestHash: 'h'.repeat(64) }])
    expect(typeof meta.budgetMs).toBe('number')

    // @req FR-234/SDD-100 — no MSP packet exists on a non-memory-opt-in turn
    // to compose this evidence with, so no ContextReceipt is recorded here;
    // that composition and receipt are owned entirely by the memory-opt-in
    // path (see the "memory-opt-in" describe block below), never duplicated.
    expect(trace.recordContextReceipt).not.toHaveBeenCalled()
  })

  it('GKS_CORPUS: no evidence yields the deterministic reply and zero model calls, with no fallback reader touched', async () => {
    queryKnowledgeCorpusMock.mockClear()
    queryKnowledgeCorpusMock.mockResolvedValue({ corpusGeneration: 1, manifestHash: 'h'.repeat(64), ranking: 'rrf-k60', results: [] })
    const generate = vi.fn()
    const resolveModel = vi.fn().mockResolvedValue({ provider: 'openai', model: 'fixture', generate })
    const runtimeFactory = vi.fn().mockResolvedValue({ businessKnowledge: { query: vi.fn() }, resolveModel })
    const trace = fakeTrace()
    const answer = createServerLineAnswer({ runtimeFactory })
    const text = await answer(job({ knowledgeGrounding: 'GKS_CORPUS'}), { trace })

    expect(text).toContain('ยังไม่พบข้อมูลสินค้า')
    expect(generate).not.toHaveBeenCalled()
    expect(trace.recordEvidence).toHaveBeenCalledTimes(2)
    expect(trace.recordEvidence.mock.calls[0][2]).toMatchObject({ mode: 'GKS_CORPUS', source: 'GKS_CORPUS', reason: 'NO_EVIDENCE' })
    expect(trace.recordEvidence.mock.calls[1][2]).toMatchObject({ mode: 'GKS_CORPUS', source: 'NONE', reason: 'NO_EVIDENCE' })
    expect(trace.recordContextReceipt).not.toHaveBeenCalled()
  })

  it('GKS_THEN_BUSINESS_KNOWLEDGE: a timed-out corpus hop is GKS_UNAVAILABLE, traced, and falls back to business knowledge', async () => {
    queryKnowledgeCorpusMock.mockClear()
    queryKnowledgeCorpusMock.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ corpusGeneration: 1, manifestHash: 'h'.repeat(64), ranking: 'rrf-k60', results: [corpusHit()] }), 100)))
    const knowledge = { query: vi.fn().mockResolvedValue(businessKnowledgeEvidence()) }
    const trace = fakeTrace()
    const answer = createServerLineAnswer({ runtimeFactory: runtimeWith(knowledge), env: { ZURI_LINE_KNOWLEDGE_BUDGET_MS: '5' } })
    const text = await answer(job({ knowledgeGrounding: 'GKS_THEN_BUSINESS_KNOWLEDGE' }), { trace })

    expect(text).toContain('AB-1')
    expect(knowledge.query).toHaveBeenCalledTimes(1)
    expect(trace.recordEvidence).toHaveBeenCalledTimes(2)
    expect(trace.recordEvidence.mock.calls[0][2]).toMatchObject({ mode: 'GKS_THEN_BUSINESS_KNOWLEDGE', source: 'GKS_CORPUS', reason: 'GKS_UNAVAILABLE' })
    expect(trace.recordEvidence.mock.calls[1][2]).toMatchObject({ mode: 'GKS_THEN_BUSINESS_KNOWLEDGE', source: 'BUSINESS_KNOWLEDGE', reason: 'GKS_UNAVAILABLE' })
  })

  it('GKS_THEN_BUSINESS_KNOWLEDGE: no evidence anywhere yields the deterministic reply and zero model calls', async () => {
    queryKnowledgeCorpusMock.mockClear()
    queryKnowledgeCorpusMock.mockResolvedValue({ corpusGeneration: 1, manifestHash: 'h'.repeat(64), ranking: 'rrf-k60', results: [] })
    const generate = vi.fn()
    const resolveModel = vi.fn().mockResolvedValue({ provider: 'openai', model: 'fixture', generate })
    const runtimeFactory = vi.fn().mockResolvedValue({ businessKnowledge: { query: async () => ({ records: [] }) }, resolveModel })
    const trace = fakeTrace()
    const answer = createServerLineAnswer({ runtimeFactory })
    const text = await answer(job({ knowledgeGrounding: 'GKS_THEN_BUSINESS_KNOWLEDGE'}), { trace })

    expect(text).toContain('ยังไม่พบข้อมูลสินค้า')
    expect(generate).not.toHaveBeenCalled()
    expect(trace.recordEvidence).toHaveBeenCalledTimes(3)
    expect(trace.recordEvidence.mock.calls[2][2]).toMatchObject({ source: 'NONE', reason: 'NO_EVIDENCE' })
  })

  it('never reads another Business\'s corpus: two jobs for different Businesses each query only their own scope', async () => {
    queryKnowledgeCorpusMock.mockClear()
    queryKnowledgeCorpusMock.mockImplementation(async ({ businessId: requested }) => ({
      corpusGeneration: 1, manifestHash: 'h'.repeat(64), ranking: 'rrf-k60',
      results: [corpusHit({ text: `evidence for ${requested}` })],
    }))
    const answer = createServerLineAnswer({ runtimeFactory: runtimeWith({ query: vi.fn() }) })
    await answer(job({ knowledgeGrounding: 'GKS_CORPUS', business: businessId }))
    await answer(job({ knowledgeGrounding: 'GKS_CORPUS', business: otherBusinessId }))

    expect(queryKnowledgeCorpusMock).toHaveBeenCalledTimes(2)
    expect(queryKnowledgeCorpusMock.mock.calls[0][0].businessId).toBe(businessId)
    expect(queryKnowledgeCorpusMock.mock.calls[0][1].viewer).toEqual({ visibleBusinessIds: [businessId] })
    expect(queryKnowledgeCorpusMock.mock.calls[1][0].businessId).toBe(otherBusinessId)
    expect(queryKnowledgeCorpusMock.mock.calls[1][1].viewer).toEqual({ visibleBusinessIds: [otherBusinessId] })
  })

  it('an account scope mismatch is rejected before any corpus or business-knowledge read', async () => {
    queryKnowledgeCorpusMock.mockClear()
    const knowledge = { query: vi.fn() }
    const answer = createServerLineAnswer({ runtimeFactory: runtimeWith(knowledge) })
    const input = job({ knowledgeGrounding: 'GKS_CORPUS' })
    input.account.businessId = otherBusinessId
    await expect(answer(input)).rejects.toThrow('LINE_ANSWER_SCOPE_MISMATCH')
    expect(queryKnowledgeCorpusMock).not.toHaveBeenCalled()
    expect(knowledge.query).not.toHaveBeenCalled()
  })
})

// @req FR-234/SDD-100 — a memory-opt-in turn composes the MSP packet and (for
// a corpus-grounding mode) this turn's knowledge evidence in exactly ONE
// composeContext call, under one budget, and records exactly one
// ContextReceipt — never two for one model invocation, and never one when no
// model will be called.
describe('FR-235 + FR-234 — memory-opt-in turns compose knowledge evidence with MSP under one budget', () => {
  function memoryJob({ knowledgeGrounding, audienceKind = 'DIRECT' } = {}) {
    return {
      tenantId, businessId,
      memorySyncOptIn: true, audienceKind, eventId: `event-${audienceKind}`, sourceUserId: `user-${audienceKind}`,
      account: { tenantId, businessId, bindingCode: 'memory-binding', ...(knowledgeGrounding !== undefined ? { knowledgeGrounding } : {}) },
      channelAccountId: 'memory-binding', transportEpoch: 1, executionMode: 'SERVER',
      inbound: { id: `inbound-${audienceKind}`, body: 'AB-1 ราคาเท่าไร', conversation: { tenantId, businessId,
        channel: 'LINE', channelAccountId: 'memory-binding', externalThreadId: `thread-${audienceKind}` } },
    }
  }

  // A non-empty MSP packet (one participant) so a receipt that "lists both
  // MSP refs and citations" has an MSP ref to list in the first place.
  function memoryPorts({ audienceKind = 'DIRECT' } = {}) {
    const appendMessage = vi.fn(async (input) => input.direction === 'INBOUND'
      ? { message: { messageId: 'msp-inbound', exchangeId: 'msp-exchange' }, session: { sessionId: 'msp-session' } }
      : { message: { messageId: 'msp-agent', exchangeId: 'msp-exchange' }, session: { sessionId: 'msp-session' } })
    const threadMemory = { appendMessage, withInjectionReceipt: vi.fn(({ model }) => model) }
    const contextAssembler = vi.fn(async (input) => ({
      identity: { principalId: 'person-memory', verified: true },
      thread: { threadId: 'msp-thread', businessId, audienceKind },
      authContext: { scope: { tenantId, businessId } },
      policy: { version: 'memory-policy-v1', privateMemoryAllowed: audienceKind === 'DIRECT' },
      threadMemory: {
        policyDecision: audienceKind === 'DIRECT' ? 'ALLOW' : 'DENY',
        thread: { threadId: 'msp-thread', businessId, audienceKind },
        identity: { principalId: 'person-memory', verified: true },
        memory: { participants: [{ principalId: 'person-memory', name: 'Customer' }], recentExchanges: [], summaries: [], protectedMemory: [] },
      },
      input,
    }))
    const authorizationResolver = vi.fn(async ({ serverScope }) => ({
      authContext: { scope: { tenantId, businessId }, transport: { signatureVerified: true } },
      policy: { decision: audienceKind === 'DIRECT' ? 'ALLOW' : 'DENY', privateMemoryAllowed: audienceKind === 'DIRECT',
        mspAuthorization: { read: audienceKind === 'DIRECT', writePrivate: false, writeShared: false } },
      serverScope,
    }))
    return { threadMemory, contextAssembler, authorizationResolver }
  }

  it('memory-opt-in + GKS_CORPUS with evidence: exactly one ContextReceipt listing both the MSP participant and the citation', async () => {
    queryKnowledgeCorpusMock.mockClear()
    queryKnowledgeCorpusMock.mockResolvedValue({ corpusGeneration: 4, manifestHash: 'h'.repeat(64), ranking: 'rrf-k60', results: [corpusHit()] })
    const trace = fakeTrace()
    const answer = createServerLineAnswer({ ...memoryPorts(), runtimeFactory: runtimeWith({ query: vi.fn() }) })
    const text = await answer(memoryJob({ knowledgeGrounding: 'GKS_CORPUS' }), { trace })

    expect(text).toContain('AB-1')
    expect(trace.recordContextReceipt).toHaveBeenCalledTimes(1)
    const receipt = trace.recordContextReceipt.mock.calls[0][0]
    expect(receipt.refs.msp).toEqual(['participant:person-memory'])
    expect(receipt.refs.citations).toEqual(['cit-1'])
    // No content anywhere in the receipt.
    expect(JSON.stringify(receipt)).not.toContain('AB-1')
  })

  it('memory-opt-in + GKS_CORPUS with no evidence: zero ContextReceipts and zero model calls', async () => {
    queryKnowledgeCorpusMock.mockClear()
    queryKnowledgeCorpusMock.mockResolvedValue({ corpusGeneration: 1, manifestHash: 'h'.repeat(64), ranking: 'rrf-k60', results: [] })
    const generate = vi.fn()
    const answer = createServerLineAnswer({ ...memoryPorts(),
      runtimeFactory: vi.fn().mockResolvedValue({ businessKnowledge: { query: vi.fn() }, resolveModel: vi.fn().mockResolvedValue({ provider: 'openai', model: 'fixture', generate }) }) })
    const trace = fakeTrace()
    const text = await answer(memoryJob({ knowledgeGrounding: 'GKS_CORPUS'}), { trace })

    expect(text).toContain('ยังไม่พบข้อมูลสินค้า')
    expect(generate).not.toHaveBeenCalled()
    expect(trace.recordContextReceipt).not.toHaveBeenCalled()
  })

  it('memory-opt-in + GKS_THEN_BUSINESS_KNOWLEDGE falling back: one ContextReceipt over the fallback evidence, not the empty corpus hop', async () => {
    queryKnowledgeCorpusMock.mockClear()
    queryKnowledgeCorpusMock.mockResolvedValue({ corpusGeneration: 1, manifestHash: 'h'.repeat(64), ranking: 'rrf-k60', results: [] })
    const trace = fakeTrace()
    const answer = createServerLineAnswer({ ...memoryPorts(), runtimeFactory: runtimeWith({ query: vi.fn().mockResolvedValue(businessKnowledgeEvidence()) }) })
    const text = await answer(memoryJob({ knowledgeGrounding: 'GKS_THEN_BUSINESS_KNOWLEDGE' }), { trace })

    expect(text).toContain('AB-1')
    expect(trace.recordContextReceipt).toHaveBeenCalledTimes(1)
    const receipt = trace.recordContextReceipt.mock.calls[0][0]
    expect(receipt.refs.msp).toEqual(['participant:person-memory'])
    // The fallback business-knowledge record carries no citationId, so its
    // knowledge ref falls back to the composer's own slice id.
    expect(receipt.refs.citations).toEqual(['knowledge:0'])
  })

  it('a GROUP audience denied private memory still gets a correct, receipted product answer from the corpus', async () => {
    queryKnowledgeCorpusMock.mockClear()
    queryKnowledgeCorpusMock.mockResolvedValue({ corpusGeneration: 4, manifestHash: 'h'.repeat(64), ranking: 'rrf-k60', results: [corpusHit()] })
    const trace = fakeTrace()
    const answer = createServerLineAnswer({ ...memoryPorts({ audienceKind: 'GROUP' }), runtimeFactory: runtimeWith({ query: vi.fn() }) })
    const text = await answer(memoryJob({ knowledgeGrounding: 'GKS_CORPUS', audienceKind: 'GROUP' }), { trace })

    expect(text).toContain('AB-1')
    expect(trace.recordContextReceipt).toHaveBeenCalledTimes(1)
    const receipt = trace.recordContextReceipt.mock.calls[0][0]
    // MSP contributes nothing (audience denied private memory), but the
    // Business's own product knowledge is unaffected by that denial.
    expect(receipt.refs.msp).toEqual([])
    expect(receipt.refs.citations).toEqual(['cit-1'])
  })

  it('BUSINESS_KNOWLEDGE mode composes only MSP, exactly as before FR-235 (byte-identical)', async () => {
    queryKnowledgeCorpusMock.mockClear()
    const trace = fakeTrace()
    const answer = createServerLineAnswer({ ...memoryPorts(), runtimeFactory: runtimeWith({ query: vi.fn().mockResolvedValue(businessKnowledgeEvidence()) }) })
    await answer(memoryJob({}), { trace })
    expect(queryKnowledgeCorpusMock).not.toHaveBeenCalled()
    expect(trace.recordContextReceipt).toHaveBeenCalledTimes(1)
    const receipt = trace.recordContextReceipt.mock.calls[0][0]
    expect(receipt.refs.citations).toEqual([])
  })
})

// @req FR-235 — changing the grounding mode is not a transport, credential or
// execution-permission change: it must never cancel work customers are
// already waiting for.
describe('FR-235 — CONFIGURE_KNOWLEDGE_GROUNDING never fences in-flight work', () => {
  it('does not appear as a fencing action', async () => {
    const { LINE_OA_ACCOUNT_ACTIONS } = await import('@/lib/validation/enums')
    expect(LINE_OA_ACCOUNT_ACTIONS).toContain('CONFIGURE_KNOWLEDGE_GROUNDING')
    // The exact predicate line-oa-account-service.js uses to decide whether an
    // action fences (cancels QUEUED/CLAIMED/READY jobs and bumps the transport
    // epoch) must explicitly exclude this action, not merely omit it by luck.
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('../../src/modules/line-oa-studio/application/line-oa-account-service.js', import.meta.url), 'utf8')
    expect(source).toMatch(/fencesWork\s*=\s*LINE_OA_ACCOUNT_ACTIONS\.filter\([^)]*CONFIGURE_KNOWLEDGE_GROUNDING/)
  })
})
