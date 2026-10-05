import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServerLineAnswer } from '@/modules/agent/server-line-answer'
import { createDeterministicBusinessModel } from '@/modules/agent/grounded-business-answer'
import { createCorePrepareTurn, corePrepareKnowledgeBudgetMs, CORE_PREPARE_CALL_TIMEOUT_MS,
  CORE_PREPARE_SAFETY_MARGIN_MS } from '@/modules/line-oa-studio/application/conversation-runtime-core'

// @req FR-149, FR-235 — Core `prepare` selects a runtime turn's evidence exactly as
// the legacy Server answer path (`createServerLineAnswer`) does, for every grounding
// mode: the same business-knowledge and GKS corpus reads, the same mode-gated
// fallback order, the same evidence records and the same per-hop EVIDENCE_SELECTED
// trace. Both paths run against the same fakes: the GKS corpus service
// (`queryKnowledgeCorpus`, which Core reaches through MSP) and the business
// knowledge reader. No live service and no database are involved.
// @spec ADR-106 D2, ADR-090 D1-D3, SEC-032
// @tested tests/integration/conversation-runtime-grounding-parity.test.js

vi.mock('@/lib/db', () => ({ default: {} }))

const queryKnowledgeCorpusMock = vi.hoisted(() => vi.fn())
vi.mock('@/modules/knowledge/knowledge-corpus-service', () => ({
  queryKnowledgeCorpus: (...args) => queryKnowledgeCorpusMock(...args),
}))

// Capture the evidence the legacy path hands to answerBusinessQuestion's decision,
// i.e. exactly what its single `knowledge.query` returned. Behaviour is unchanged.
const legacySelections = vi.hoisted(() => [])
vi.mock('@/modules/agent/grounded-business-answer', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, answerBusinessQuestion: async (input, deps) => {
    const result = await actual.answerBusinessQuestion(input, deps)
    legacySelections.push(result.evidence)
    return result
  } }
})

const tenantId = '11111111-1111-4111-8111-111111111111'
const businessId = '22222222-2222-4222-8222-222222222222'
const MODES = ['BUSINESS_KNOWLEDGE', 'GKS_CORPUS', 'GKS_THEN_BUSINESS_KNOWLEDGE']
const env = { ZURI_LINE_KNOWLEDGE_BUDGET_MS: '40' }

const productRecord = { name: 'แก้ว', product_code: 'AB-1', sell_price: 50, currency: 'THB', unit: 'ชิ้น', moq: 1, specification: {}, as_of: '2026-09-01T00:00:00Z' }
const corpusHit = (overrides = {}) => ({ id: 'hit-1', text: 'AB-1 คือแก้วน้ำ ราคา 50 บาท', score: 0.9,
  citationId: 'cit-1', sourceId: 'src-1', snapshotId: 'snap-1', generation: 1, ...overrides })
const corpusResult = (results) => ({ corpusGeneration: 4, manifestHash: 'h'.repeat(64), ranking: 'rrf-k60', results })

// Each scenario is one state of the two sources both paths read.
const SCENARIOS = {
  'corpus hit, business hit': { corpus: () => corpusResult([corpusHit(), corpusHit({ id: 'hit-2', citationId: 'cit-2', text: 'AB-1 ขั้นต่ำ 1 ชิ้น' })]), business: [productRecord] },
  'corpus empty, business hit': { corpus: () => corpusResult([]), business: [productRecord] },
  'corpus throws, business hit': { corpus: () => { throw new Error('SELECT secret FROM msp -- must never leak') }, business: [productRecord] },
  'corpus exceeds its budget, business hit': { corpus: () => new Promise(() => {}), business: [productRecord] },
  'corpus empty, business empty': { corpus: () => corpusResult([]), business: [] },
  'oversized corpus hit is dropped, the rest kept': { corpus: () => corpusResult([corpusHit({ text: 'x'.repeat(9000) }), corpusHit({ id: 'hit-2', citationId: 'cit-2' })]), business: [productRecord] },
}
const QUESTIONS = ['AB-1 ราคาเท่าไร', 'เทียบ AB-1 กับ CD-22 ต่างกันยังไง', 'แก้วน้ำสีฟ้า']

function recordingTrace() {
  const hops = []
  return {
    hops,
    recordEvidence: vi.fn(async (query, evidence, meta) => {
      // budgetMs is a measured wall-clock value, so only its presence is compared.
      const { budgetMs, ...rest } = meta ?? {}
      hops.push({ query, records: evidence?.records ?? null, meta: meta === undefined ? undefined : { ...rest, budgetMsType: typeof budgetMs } })
    }),
    recordThreadMemory: vi.fn(),
    recordContextReceipt: vi.fn(),
    assertHealthy: vi.fn(),
  }
}

function businessReader(records) {
  return { query: vi.fn(async () => ({ records: records.map(record => ({ ...record })) })) }
}

async function runLegacy({ mode, scenario, question }) {
  queryKnowledgeCorpusMock.mockReset()
  queryKnowledgeCorpusMock.mockImplementation(async () => scenario.corpus())
  legacySelections.length = 0
  const businessKnowledge = businessReader(scenario.business)
  const trace = recordingTrace()
  const answer = createServerLineAnswer({ env, runtimeFactory: vi.fn().mockResolvedValue({
    businessKnowledge, resolveModel: vi.fn().mockResolvedValue(createDeterministicBusinessModel()) }) })
  await answer({ tenantId, businessId, inbound: { body: question },
    account: { tenantId, businessId, knowledgeGrounding: mode } }, { trace })
  expect(legacySelections).toHaveLength(1)
  return { evidence: legacySelections[0], hops: trace.hops,
    corpusCalls: queryKnowledgeCorpusMock.mock.calls.map(([input, options]) => ({ input, viewer: options?.viewer })),
    businessCalls: businessKnowledge.query.mock.calls.map(([input]) => input) }
}

async function runCore({ mode, scenario, question }) {
  queryKnowledgeCorpusMock.mockReset()
  queryKnowledgeCorpusMock.mockImplementation(async () => scenario.corpus())
  const businessKnowledge = businessReader(scenario.business)
  const trace = recordingTrace()
  const traceFactory = vi.fn(() => trace)
  const prepare = createCorePrepareTurn({ db: {}, env, businessPorts: async () => ({ businessKnowledge }), traceFactory })
  const job = { id: 'job-1', executionId: 'execution-1', tenantId, businessId, audienceKind: 'DIRECT',
    inbound: { body: question }, account: { tenantId, businessId, knowledgeGrounding: mode } }
  const prepared = await prepare(job)
  expect(traceFactory).toHaveBeenCalledWith({ db: {}, job })
  return { prepared, hops: trace.hops,
    corpusCalls: queryKnowledgeCorpusMock.mock.calls.map(([input, options]) => ({ input, viewer: options?.viewer })),
    businessCalls: businessKnowledge.query.mock.calls.map(([input]) => input) }
}

beforeEach(() => { queryKnowledgeCorpusMock.mockReset() })

describe('Core prepare grounding parity with the legacy Server answer path', () => {
  for (const mode of MODES) {
    for (const [name, scenario] of Object.entries(SCENARIOS)) {
      for (const question of QUESTIONS) {
        it(`${mode} — ${name} — "${question}"`, async () => {
          const legacy = await runLegacy({ mode, scenario, question })
          const core = await runCore({ mode, scenario, question })

          // The evidence the runtime receives is exactly the evidence the legacy
          // path selected (records only: the runtime never sees retrievalRefs/meta).
          expect(core.prepared.evidence).toEqual({ records: legacy.evidence.records ?? [] })
          expect(core.prepared).toMatchObject({ question, slices: [], authorized: true, audienceKind: 'DIRECT',
            threadId: null, maxBudgetChars: 0, workCommand: null })
          // Same sources read, in the same order, with the same scoped inputs.
          expect(core.corpusCalls).toEqual(legacy.corpusCalls)
          expect(core.businessCalls).toEqual(legacy.businessCalls)
          // Same EVIDENCE_SELECTED hops (source, reason, mode, retrievalRefs, query).
          expect(core.hops).toEqual(legacy.hops)
        })
      }
    }
  }

  it('the fixtures exercise every fallback branch the legacy reader has', async () => {
    const reasons = new Set()
    for (const mode of MODES) {
      for (const scenario of Object.values(SCENARIOS)) {
        const { hops } = await runLegacy({ mode, scenario, question: QUESTIONS[0] })
        for (const hop of hops) reasons.add(`${mode}:${hop.meta?.source ?? 'BUSINESS_QUERY'}:${hop.meta?.reason ?? null}`)
      }
    }
    expect([...reasons].sort()).toEqual([
      'BUSINESS_KNOWLEDGE:BUSINESS_QUERY:null',
      'GKS_CORPUS:GKS_CORPUS:GKS_UNAVAILABLE',
      'GKS_CORPUS:GKS_CORPUS:NO_EVIDENCE',
      'GKS_CORPUS:GKS_CORPUS:null',
      'GKS_CORPUS:NONE:NO_EVIDENCE',
      'GKS_THEN_BUSINESS_KNOWLEDGE:BUSINESS_KNOWLEDGE:GKS_UNAVAILABLE',
      'GKS_THEN_BUSINESS_KNOWLEDGE:BUSINESS_KNOWLEDGE:NO_EVIDENCE',
      'GKS_THEN_BUSINESS_KNOWLEDGE:GKS_CORPUS:GKS_UNAVAILABLE',
      'GKS_THEN_BUSINESS_KNOWLEDGE:GKS_CORPUS:NO_EVIDENCE',
      'GKS_THEN_BUSINESS_KNOWLEDGE:GKS_CORPUS:null',
      'GKS_THEN_BUSINESS_KNOWLEDGE:NONE:NO_EVIDENCE',
    ])
  })

  it('the GKS read is scoped to the job\'s own Business through a read-only viewer, and its error never leaks', async () => {
    const core = await runCore({ mode: 'GKS_CORPUS', scenario: SCENARIOS['corpus throws, business hit'], question: QUESTIONS[0] })
    expect(core.corpusCalls).toEqual([{ input: { businessId, query: 'AB-1', topK: 5 }, viewer: { visibleBusinessIds: [businessId] } }])
    expect(core.prepared.evidence).toEqual({ records: [] })
    expect(JSON.stringify(core)).not.toContain('secret')
  })

  it('an unrecognised stored mode is refused by Core (admission keeps it SERVER, where it resolves to BUSINESS_KNOWLEDGE)', async () => {
    const prepare = createCorePrepareTurn({ db: {}, env, businessPorts: async () => ({ businessKnowledge: businessReader([productRecord]) }),
      traceFactory: () => recordingTrace() })
    await expect(prepare({ id: 'job-1', tenantId, businessId, audienceKind: 'DIRECT', inbound: { body: QUESTIONS[0] },
      account: { tenantId, businessId, knowledgeGrounding: 'NOT_A_REAL_MODE' } }))
      .rejects.toMatchObject({ code: 'RUNTIME_GROUNDING_MODE_NOT_SUPPORTED', status: 409 })
    expect(queryKnowledgeCorpusMock).not.toHaveBeenCalled()
  })

  it('a Work command never reads knowledge in any mode', async () => {
    for (const mode of MODES) {
      const businessKnowledge = businessReader([productRecord])
      const traceFactory = vi.fn(() => recordingTrace())
      const prepare = createCorePrepareTurn({ db: {}, env, businessPorts: async () => ({ businessKnowledge }), traceFactory })
      const prepared = await prepare({ id: 'job-1', tenantId, businessId, audienceKind: 'DIRECT', inbound: { body: '/projects' },
        account: { tenantId, businessId, knowledgeGrounding: mode } })
      expect(prepared.workCommand).toEqual({ operation: 'read', input: { kind: 'projects', query: '' } })
      expect(businessKnowledge.query).not.toHaveBeenCalled()
      expect(traceFactory).not.toHaveBeenCalled()
    }
    expect(queryKnowledgeCorpusMock).not.toHaveBeenCalled()
  })
})

describe('Core prepare stays inside the runtime prepare call', () => {
  const at = new Date('2026-09-27T12:00:00.000Z')
  const inMs = ms => new Date(at.getTime() + ms).toISOString()
  const job = (mode, ...rest) => ({ id: 'job-1', executionId: 'execution-1', tenantId, businessId, audienceKind: 'DIRECT',
    inbound: { body: rest.length ? rest[0] : QUESTIONS[0] }, account: { tenantId, businessId, knowledgeGrounding: mode } })
  const build = ({ budgetMs, business = [productRecord] } = {}) => {
    const trace = recordingTrace()
    const businessKnowledge = businessReader(business)
    const prepare = createCorePrepareTurn({ db: {}, env: { ZURI_LINE_KNOWLEDGE_BUDGET_MS: String(budgetMs) }, now: () => at,
      businessPorts: async () => ({ businessKnowledge }), traceFactory: () => trace })
    return { prepare, trace, businessKnowledge }
  }
  afterEach(() => { vi.useRealTimers() })

  it('clamps the configured budget below the runtime call timeout and the envelope deadline, less a safety margin', () => {
    const ceiling = CORE_PREPARE_CALL_TIMEOUT_MS - CORE_PREPARE_SAFETY_MARGIN_MS
    expect(ceiling).toBe(7_500)
    const now = () => at
    expect(corePrepareKnowledgeBudgetMs(2_500, { deadlineAt: inMs(60_000), now })).toBe(2_500) // legacy default untouched
    expect(corePrepareKnowledgeBudgetMs(60_000, { deadlineAt: inMs(3_600_000), now })).toBe(ceiling)
    expect(corePrepareKnowledgeBudgetMs(60_000, { now })).toBe(ceiling) // no envelope deadline
    expect(corePrepareKnowledgeBudgetMs(60_000, { deadlineAt: 'not-a-date', now })).toBe(ceiling)
    expect(corePrepareKnowledgeBudgetMs(60_000, { deadlineAt: inMs(4_000), now })).toBe(4_000 - CORE_PREPARE_SAFETY_MARGIN_MS)
    expect(corePrepareKnowledgeBudgetMs(60_000, { deadlineAt: inMs(CORE_PREPARE_SAFETY_MARGIN_MS), now })).toBe(0)
    expect(corePrepareKnowledgeBudgetMs(60_000, { deadlineAt: inMs(-1), now })).toBe(0)
  })

  it('GKS_THEN_BUSINESS_KNOWLEDGE with a 60 s configured budget: a hanging corpus hop is abandoned at the clamped budget and falls back', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    queryKnowledgeCorpusMock.mockImplementation(() => new Promise(() => {}))
    const { prepare, trace } = build({ budgetMs: 60_000 })
    let settled = null
    const pending = prepare(job('GKS_THEN_BUSINESS_KNOWLEDGE'), { deadlineAt: inMs(3_600_000) }).then(value => { settled = value })
    await vi.advanceTimersByTimeAsync(CORE_PREPARE_CALL_TIMEOUT_MS - CORE_PREPARE_SAFETY_MARGIN_MS - 1)
    expect(settled).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(settled.evidence).toEqual({ records: [productRecord] })
    expect(trace.hops.map(hop => [hop.meta.source, hop.meta.reason])).toEqual([
      ['GKS_CORPUS', 'GKS_UNAVAILABLE'], ['BUSINESS_KNOWLEDGE', 'GKS_UNAVAILABLE']])
  })

  it('a near envelope deadline shortens the GKS hop further', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    queryKnowledgeCorpusMock.mockImplementation(() => new Promise(() => {}))
    const { prepare } = build({ budgetMs: 60_000 })
    let settled = null
    const pending = prepare(job('GKS_CORPUS'), { deadlineAt: inMs(CORE_PREPARE_SAFETY_MARGIN_MS + 300) }).then(value => { settled = value })
    await vi.advanceTimersByTimeAsync(299)
    expect(settled).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(settled.evidence).toEqual({ records: [] })
  })

  it('with no time left before the deadline, a GKS mode reads and traces nothing', async () => {
    const { prepare, trace, businessKnowledge } = build({ budgetMs: 2_500 })
    for (const mode of ['GKS_CORPUS', 'GKS_THEN_BUSINESS_KNOWLEDGE']) {
      await expect(prepare(job(mode), { deadlineAt: inMs(CORE_PREPARE_SAFETY_MARGIN_MS) }))
        .rejects.toMatchObject({ code: 'CONTRACT_DEADLINE_EXPIRED', status: 408 })
    }
    expect(queryKnowledgeCorpusMock).not.toHaveBeenCalled()
    expect(businessKnowledge.query).not.toHaveBeenCalled()
    expect(trace.hops).toEqual([])
  })

  for (const body of ['', '   ', undefined, null, 42]) {
    it(`an inbound body of ${JSON.stringify(body) ?? 'undefined'} fails LINE_ANSWER_INPUT_INVALID before any read, as the legacy path does`, async () => {
      for (const mode of MODES) {
        const legacy = createServerLineAnswer({ env, runtimeFactory: vi.fn() })
        await expect(legacy({ tenantId, businessId, inbound: { body }, account: { tenantId, businessId, knowledgeGrounding: mode } }))
          .rejects.toMatchObject({ code: 'LINE_ANSWER_INPUT_INVALID' })
        const { prepare, trace, businessKnowledge } = build({ budgetMs: 2_500 })
        await expect(prepare(job(mode, body), { deadlineAt: inMs(60_000) }))
          .rejects.toMatchObject({ code: 'LINE_ANSWER_INPUT_INVALID', status: 422 })
        expect(businessKnowledge.query).not.toHaveBeenCalled()
        expect(trace.hops).toEqual([])
      }
      expect(queryKnowledgeCorpusMock).not.toHaveBeenCalled()
    })
  }
})
