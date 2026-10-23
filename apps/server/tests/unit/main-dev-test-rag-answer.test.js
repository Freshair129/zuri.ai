import { describe, expect, it, vi } from 'vitest'
const recordDecision = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/modules/agent/main-dev-test-rag-decision', async original => ({ ...(await original()), recordMainDevTestRagDecision: recordDecision }))
import { createServerLineAnswer } from '@/modules/agent/server-line-answer'
import { NO_EVIDENCE_REPLY } from '@/modules/agent/line-answer-policy'

// @req FR-079, FR-235 — composition uses filtered RAG evidence and the existing composer, never a fixture fallback.
// @tested tests/unit/main-dev-test-rag-answer.test.js
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
function fixture(records = [{ product_code: 'TEST-ONLY-RAG-001', name: 'TEST ONLY cup', unit: 'EA',
  sell_price: null, currency: null, moq: null, specification: {}, citationId: 'citation-1' }]) {
  recordDecision.mockClear()
  const env = { ZURI_PHASE1_RUNTIME_SOURCE: 'MAIN_DEV_LOCAL_OLLAMA', ZURI_MAIN_DEV_LOCAL_OLLAMA_ENABLED: 'true',
    ZURI_MAIN_DEV_LOCAL_OLLAMA_EXPECTED_DATABASE: 'unit_rag', ZURI_MAIN_DEV_LOCAL_OLLAMA_BASE_URL: 'http://host.docker.internal:11434',
    ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_TENANT_IDS: JSON.stringify([id(1)]),
    ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_BUSINESS_IDS: JSON.stringify([id(2)]),
    ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_LINE_OA_ACCOUNT_IDS: JSON.stringify([id(3)]),
    ZURI_MAIN_DEV_LOCAL_OLLAMA_KNOWLEDGE_SOURCE: 'GENESISRAG17_TEST_ONLY',
    ZURI_MAIN_DEV_LOCAL_OLLAMA_RAG_MANIFEST_SHA256: 'b'.repeat(64),
    ZURI_MAIN_DEV_LOCAL_OLLAMA_RAG_PRODUCTS: JSON.stringify([{ productId: id(4), sku: 'TEST-ONLY-RAG-001',
      sourceId: id(5), ingestionId: id(6), fileSha256: 'c'.repeat(64) }]) }
  const job = { id: id(7), executionId: id(8), tenantId: id(1), businessId: id(2), accountId: id(3),
    executionMode: 'SERVER', runtimeOwner: 'SERVER', inbound: { body: 'ขอชื่อสินค้า TEST-ONLY-RAG-001' },
    account: { id: id(3), tenantId: id(1), businessId: id(2), executionMode: 'SERVER', runtimeOwner: 'SERVER',
      serverEnabled: true, knowledgeGrounding: 'GKS_CORPUS', knowledgeGroundingShadow: false, memoryPolicy: 'OFF', memoryProjectId: null } }
  const generate = vi.fn(async () => ({ provider: 'ollama', model: 'fixture', status: 'ok', text: 'TEST ONLY cup' }))
  const revalidateKnowledge = vi.fn(async () => {})
  const query = vi.fn(async () => ({ records, retrievalRefs: [{ citationId: 'citation-1', sourceId: id(5) }],
    meta: { mode: 'GKS_CORPUS', source: 'GKS_CORPUS', reason: records.length ? null : 'NO_EVIDENCE', budgetMs: 10 } }))
  const getKnowledgeBinding = () => ({ schema: 'zuri.line-test-rag.binding.v1', denied: !records.length,
    profileSha256: 'd'.repeat(64), sourceSha256: records.length ? 'e'.repeat(64) : null })
  const runtimeFactory = vi.fn(() => ({ businessKnowledge: { query },
    resolveModel: async () => ({ provider: 'ollama', model: 'fixture', generate }), revalidateKnowledge, getKnowledgeBinding }))
  const trace = { recordEvidence: vi.fn(), recordContextReceipt: vi.fn(), assertHealthy: vi.fn() }
  return { env, job, generate, revalidateKnowledge, query, runtimeFactory, trace }
}
describe('LINE test RAG composition', () => {
  it('uses permitted model fields, records GKS provenance outside the prompt and persists a delivery decision', async () => {
    const f = fixture()
    const answer = createServerLineAnswer({ env: f.env, runtimeFactory: f.runtimeFactory })
    expect(await answer(f.job, { trace: f.trace })).toBe('TEST ONLY cup')
    expect(f.generate).toHaveBeenCalledOnce()
    expect(f.trace.recordEvidence.mock.calls[0][2]).toMatchObject({ source: 'GKS_CORPUS', mode: 'GKS_CORPUS' })
    expect(JSON.stringify(f.generate.mock.calls[0][0].evidence)).not.toMatch(/sourceId|ingestionId|fileSha256|manifestHash|provenance/)
    expect(f.revalidateKnowledge).toHaveBeenCalledOnce()
    expect(recordDecision).toHaveBeenCalledOnce()
  })
  it('returns fixed no-evidence and never invokes Ollama or a fixture when retrieval yields no permitted evidence', async () => {
    const f = fixture([])
    expect(await createServerLineAnswer({ env: f.env, runtimeFactory: f.runtimeFactory })(f.job, { trace: f.trace })).toBe(NO_EVIDENCE_REPLY)
    expect(f.generate).not.toHaveBeenCalled()
    expect(f.revalidateKnowledge).not.toHaveBeenCalled()
    expect(recordDecision.mock.calls[0][2].binding.denied).toBe(true)
  })
  it('refuses non-matching account grounding before constructing ports', async () => {
    const f = fixture(); f.job.account.knowledgeGrounding = 'GKS_THEN_BUSINESS_KNOWLEDGE'
    await expect(createServerLineAnswer({ env: f.env, runtimeFactory: f.runtimeFactory })(f.job)).rejects.toThrow(/LINE_ANSWER_UNAVAILABLE/)
    expect(f.runtimeFactory).not.toHaveBeenCalled()
  })
})
