import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createDeterministicBusinessModel } from '@/modules/agent/grounded-business-answer'

// @req FR-277 — the shadow-compare harness never touches a real database or a
// real corpus reader in a unit test; both are faked so every branch (paired
// mode resolution, GKS_UNAVAILABLE fallback, timeout, a thrown reader error,
// a failed write) is exercised deterministically.
// @tested tests/unit/line-grounding-shadow-compare.test.js

vi.mock('@/lib/db', () => ({ default: {} }))

const createCorpusKnowledgeReaderMock = vi.fn()
vi.mock('@/modules/knowledge', () => ({
  createCorpusKnowledgeReader: (...args) => createCorpusKnowledgeReaderMock(...args),
}))

const {
  otherGroundingMode,
  runLineGroundingShadowCompare,
  lineGroundingShadowTimeoutMsFromEnv,
  LINE_GROUNDING_SHADOW_DEFAULT_TIMEOUT_MS,
} = await import('@/modules/agent/line-grounding-shadow-compare')

const tenantId = '11111111-1111-4111-8111-111111111111'
const businessId = '22222222-2222-4222-8222-222222222222'
const jobId = 'job-1'

function fakeDb() {
  const store = new Map()
  return {
    store,
    lineGroundingShadowComparison: {
      upsert: vi.fn(async ({ where, create }) => {
        store.set(where.jobId, create)
        return create
      }),
    },
  }
}

function fakeReader(records) {
  return { query: vi.fn(async () => ({ records })) }
}

function throwingReader(error) {
  return { query: vi.fn(async () => { throw error }) }
}

function baseJob({ shadow = true } = {}) {
  return { id: jobId, accountId: 'acct-1', account: { id: 'acct-1', knowledgeGroundingShadow: shadow } }
}

const record = { name: 'แก้ว', product_code: 'AB-1', sell_price: 50, currency: 'THB', unit: 'ชิ้น', moq: 1, specification: {}, as_of: '2026-09-01T00:00:00Z' }

beforeEach(() => {
  createCorpusKnowledgeReaderMock.mockReset()
})

describe('otherGroundingMode', () => {
  it('pairs BUSINESS_KNOWLEDGE and GKS_THEN_BUSINESS_KNOWLEDGE symmetrically', () => {
    expect(otherGroundingMode('BUSINESS_KNOWLEDGE')).toBe('GKS_THEN_BUSINESS_KNOWLEDGE')
    expect(otherGroundingMode('GKS_THEN_BUSINESS_KNOWLEDGE')).toBe('BUSINESS_KNOWLEDGE')
  })

  it('GKS_CORPUS and an unrecognised mode have no defined shadow partner', () => {
    expect(otherGroundingMode('GKS_CORPUS')).toBeNull()
    expect(otherGroundingMode('NOT_A_MODE')).toBeNull()
    expect(otherGroundingMode(undefined)).toBeNull()
  })
})

describe('lineGroundingShadowTimeoutMsFromEnv', () => {
  it('defaults and falls back on an invalid override, never a permissive guess', () => {
    expect(lineGroundingShadowTimeoutMsFromEnv({})).toBe(LINE_GROUNDING_SHADOW_DEFAULT_TIMEOUT_MS)
    expect(lineGroundingShadowTimeoutMsFromEnv({ ZURI_LINE_GROUNDING_SHADOW_TIMEOUT_MS: '3000' })).toBe(3000)
    expect(lineGroundingShadowTimeoutMsFromEnv({ ZURI_LINE_GROUNDING_SHADOW_TIMEOUT_MS: '-1' })).toBe(LINE_GROUNDING_SHADOW_DEFAULT_TIMEOUT_MS)
  })
})

describe('runLineGroundingShadowCompare — disabled by default, never a regression for an untouched account', () => {
  it('is a silent no-op when the account has no knowledgeGroundingShadow flag at all', async () => {
    const db = fakeDb()
    const result = await runLineGroundingShadowCompare({
      job: { id: jobId, accountId: 'acct-1', account: { id: 'acct-1' } },
      primaryMode: 'BUSINESS_KNOWLEDGE', primaryAnswerText: 'x', tenantId, businessId, question: 'q',
      model: createDeterministicBusinessModel(), businessKnowledgeReader: fakeReader([]), db,
    })
    expect(result).toBeNull()
    expect(db.lineGroundingShadowComparison.upsert).not.toHaveBeenCalled()
    expect(createCorpusKnowledgeReaderMock).not.toHaveBeenCalled()
  })

  it('is a silent no-op when the flag is explicitly false', async () => {
    const db = fakeDb()
    const result = await runLineGroundingShadowCompare({
      job: baseJob({ shadow: false }),
      primaryMode: 'BUSINESS_KNOWLEDGE', primaryAnswerText: 'x', tenantId, businessId, question: 'q',
      model: createDeterministicBusinessModel(), businessKnowledgeReader: fakeReader([]), db,
    })
    expect(result).toBeNull()
    expect(db.lineGroundingShadowComparison.upsert).not.toHaveBeenCalled()
  })

  it('is a silent no-op for GKS_CORPUS — no defined shadow partner — even with the flag on', async () => {
    const db = fakeDb()
    const result = await runLineGroundingShadowCompare({
      job: baseJob(), primaryMode: 'GKS_CORPUS', primaryAnswerText: 'x', tenantId, businessId, question: 'q',
      model: createDeterministicBusinessModel(), businessKnowledgeReader: fakeReader([]), db,
    })
    expect(result).toBeNull()
    expect(db.lineGroundingShadowComparison.upsert).not.toHaveBeenCalled()
  })

  it('is a silent no-op with missing required arguments (never throws on a malformed call)', async () => {
    const db = fakeDb()
    await expect(runLineGroundingShadowCompare({ job: baseJob(), primaryMode: 'BUSINESS_KNOWLEDGE', db })).resolves.toBeNull()
    expect(db.lineGroundingShadowComparison.upsert).not.toHaveBeenCalled()
  })
})

describe('runLineGroundingShadowCompare — enabled, completed comparisons', () => {
  it('shadow-compares BUSINESS_KNOWLEDGE (primary) against GKS_THEN_BUSINESS_KNOWLEDGE (shadow) with corpus evidence', async () => {
    createCorpusKnowledgeReaderMock.mockReturnValue({
      query: vi.fn(async () => ({ records: [{ kind: 'CORPUS_CHUNK', text: 'จากคลังความรู้', citationId: 'cit-1' }], retrievalRefs: [{ citationId: 'cit-1' }] })),
    })
    const db = fakeDb()
    const model = createDeterministicBusinessModel()
    const result = await runLineGroundingShadowCompare({
      job: baseJob(), primaryMode: 'BUSINESS_KNOWLEDGE', primaryAnswerText: 'คำตอบเดิม',
      tenantId, businessId, question: 'AB-1 ราคาเท่าไร', model,
      businessKnowledgeReader: fakeReader([record]), db,
    })
    expect(result.status).toBe('COMPLETED')
    expect(result.shadowMode).toBe('GKS_THEN_BUSINESS_KNOWLEDGE')
    expect(db.lineGroundingShadowComparison.upsert).toHaveBeenCalledTimes(1)
    const written = db.store.get(jobId)
    expect(written.tenantId).toBe(tenantId)
    expect(written.businessId).toBe(businessId)
    expect(written.accountId).toBe('acct-1')
    expect(written.primaryMode).toBe('BUSINESS_KNOWLEDGE')
    expect(written.shadowMode).toBe('GKS_THEN_BUSINESS_KNOWLEDGE')
    expect(written.status).toBe('COMPLETED')
    expect(written.shadowEvidenceSource).toBe('GKS_CORPUS')
    expect(written.primaryAnswerText).toBe('คำตอบเดิม')
    expect(typeof written.shadowAnswerText).toBe('string')
    expect(written.answersDiverge).toBe(true) // the deterministic fallback text differs from 'คำตอบเดิม'
    expect(typeof written.latencyMs).toBe('number')
    expect(written.errorCode).toBeNull()
  })

  it('records NO_EVIDENCE on both sides when neither mode has anything to answer from', async () => {
    createCorpusKnowledgeReaderMock.mockReturnValue(fakeReader([]))
    const db = fakeDb()
    const result = await runLineGroundingShadowCompare({
      job: baseJob(), primaryMode: 'GKS_THEN_BUSINESS_KNOWLEDGE', primaryAnswerText: 'ยังไม่พบข้อมูลสินค้า',
      tenantId, businessId, question: 'AB-1 ราคาเท่าไร', model: createDeterministicBusinessModel(),
      businessKnowledgeReader: fakeReader([]), db,
    })
    expect(result.status).toBe('COMPLETED')
    expect(result.shadowMode).toBe('BUSINESS_KNOWLEDGE')
    const written = db.store.get(jobId)
    expect(written.shadowEvidenceSource).toBe('NONE')
    expect(written.shadowEvidenceReason).toBe('NO_EVIDENCE')
  })

  it('falls back to business knowledge when the corpus hop is unavailable, mirroring the primary path', async () => {
    createCorpusKnowledgeReaderMock.mockReturnValue(throwingReader(new Error('worker unreachable, credential=abc')))
    const db = fakeDb()
    const result = await runLineGroundingShadowCompare({
      job: baseJob(), primaryMode: 'BUSINESS_KNOWLEDGE', primaryAnswerText: 'คำตอบเดิม',
      tenantId, businessId, question: 'AB-1 ราคาเท่าไร', model: createDeterministicBusinessModel(),
      businessKnowledgeReader: fakeReader([record]), db,
    })
    expect(result.status).toBe('COMPLETED')
    const written = db.store.get(jobId)
    // The fallback reason names the corpus outage, never the thrown error's own message.
    expect(written.shadowEvidenceSource).toBe('BUSINESS_KNOWLEDGE')
    expect(written.shadowEvidenceReason).toBe('GKS_UNAVAILABLE')
    expect(JSON.stringify(written)).not.toMatch(/credential=abc/)
  })
})

describe('runLineGroundingShadowCompare — failure modes never escape and never touch the primary answer', () => {
  it('records FAILED, never leaking the underlying error, when the shadow reader itself throws', async () => {
    const db = fakeDb()
    const result = await runLineGroundingShadowCompare({
      job: baseJob(), primaryMode: 'GKS_THEN_BUSINESS_KNOWLEDGE', primaryAnswerText: 'คำตอบเดิม',
      tenantId, businessId, question: 'AB-1 ราคาเท่าไร', model: createDeterministicBusinessModel(),
      businessKnowledgeReader: throwingReader(new Error('db down, password=hunter2')), db,
    })
    expect(result.status).toBe('FAILED')
    const written = db.store.get(jobId)
    expect(written.status).toBe('FAILED')
    expect(written.errorCode).toBe('LINE_GROUNDING_SHADOW_UNAVAILABLE')
    expect(written.shadowAnswerText).toBeNull()
    expect(JSON.stringify(written)).not.toMatch(/password/)
  })

  it('records TIMED_OUT when the shadow model hangs past the budget', async () => {
    const db = fakeDb()
    const hangingModel = { provider: 'test', model: 'hang', generate: () => new Promise(() => {}) }
    // shadowMode resolves to BUSINESS_KNOWLEDGE here — the raw reader, no corpus
    // mock required — so only the model's own hang is under test.
    const result = await runLineGroundingShadowCompare({
      job: baseJob(), primaryMode: 'GKS_THEN_BUSINESS_KNOWLEDGE', primaryAnswerText: 'คำตอบเดิม',
      tenantId, businessId, question: 'AB-1 ราคาเท่าไร', model: hangingModel,
      businessKnowledgeReader: fakeReader([record]), db, timeoutMs: 20,
    })
    expect(result.status).toBe('TIMED_OUT')
    expect(db.store.get(jobId).errorCode).toBe('LINE_GROUNDING_SHADOW_TIMED_OUT')
  })

  it('resolves (never rejects) and reports persisted:false when the write itself fails', async () => {
    const db = fakeDb()
    db.lineGroundingShadowComparison.upsert.mockRejectedValueOnce(new Error('table missing — migration not applied'))
    const result = await runLineGroundingShadowCompare({
      job: baseJob(), primaryMode: 'GKS_THEN_BUSINESS_KNOWLEDGE', primaryAnswerText: 'คำตอบเดิม',
      tenantId, businessId, question: 'AB-1 ราคาเท่าไร', model: createDeterministicBusinessModel(),
      businessKnowledgeReader: fakeReader([]), db,
    })
    expect(result.status).toBe('COMPLETED')
    expect(result.persisted).toBe(false)
  })

  it('never returns a rejected promise even with a completely malformed model', async () => {
    const db = fakeDb()
    await expect(runLineGroundingShadowCompare({
      job: baseJob(), primaryMode: 'GKS_THEN_BUSINESS_KNOWLEDGE', primaryAnswerText: 'x',
      tenantId, businessId, question: 'q', model: { generate: () => { throw new Error('boom') } },
      businessKnowledgeReader: fakeReader([record]), db,
    })).resolves.toMatchObject({ status: 'COMPLETED' }) // answerBusinessQuestion itself catches a non-ollama model throw
  })
})

describe('runLineGroundingShadowCompare — concurrency and answer text handling', () => {
  it('writes an independent row per job id for concurrent messages on the same account', async () => {
    createCorpusKnowledgeReaderMock.mockReturnValue(fakeReader([]))
    const db = fakeDb()
    const account = { id: 'acct-1', knowledgeGroundingShadow: true }
    const [a, b] = await Promise.all([
      runLineGroundingShadowCompare({
        job: { id: 'job-a', accountId: 'acct-1', account }, primaryMode: 'BUSINESS_KNOWLEDGE', primaryAnswerText: 'x',
        tenantId, businessId, question: 'q1', model: createDeterministicBusinessModel(), businessKnowledgeReader: fakeReader([]), db,
      }),
      runLineGroundingShadowCompare({
        job: { id: 'job-b', accountId: 'acct-1', account }, primaryMode: 'BUSINESS_KNOWLEDGE', primaryAnswerText: 'y',
        tenantId, businessId, question: 'q2', model: createDeterministicBusinessModel(), businessKnowledgeReader: fakeReader([]), db,
      }),
    ])
    expect(a.status).toBe('COMPLETED')
    expect(b.status).toBe('COMPLETED')
    expect(db.store.has('job-a')).toBe(true)
    expect(db.store.has('job-b')).toBe(true)
    expect(db.lineGroundingShadowComparison.upsert).toHaveBeenCalledTimes(2)
  })

  it('truncates a very long answer rather than storing it unbounded', async () => {
    createCorpusKnowledgeReaderMock.mockReturnValue(fakeReader([]))
    const db = fakeDb()
    const longText = 'a'.repeat(5000)
    await runLineGroundingShadowCompare({
      job: baseJob(), primaryMode: 'BUSINESS_KNOWLEDGE', primaryAnswerText: longText,
      tenantId, businessId, question: 'q', model: createDeterministicBusinessModel(), businessKnowledgeReader: fakeReader([]), db,
    })
    const written = db.store.get(jobId)
    expect(written.primaryAnswerText.length).toBeLessThan(longText.length)
  })

  it('never sends anything anywhere — the function has no send/reply port at all, by construction', async () => {
    // This is a structural guarantee, asserted by inspecting the module's own
    // exports: nothing here accepts a LINE reply/push transport, a CRM writer
    // or an MSP thread port, so there is no argument through which a shadow
    // answer could reach the customer even by mistake.
    const mod = await import('@/modules/agent/line-grounding-shadow-compare')
    expect(Object.keys(mod).sort()).toEqual([
      'LINE_GROUNDING_SHADOW_DEFAULT_TIMEOUT_MS',
      'lineGroundingShadowTimeoutMsFromEnv',
      'otherGroundingMode',
      'runLineGroundingShadowCompare',
    ])
  })
})
