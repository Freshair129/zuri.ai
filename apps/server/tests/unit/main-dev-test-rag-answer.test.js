import { describe, expect, it, vi } from 'vitest'
const recordDecision = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/modules/agent/main-dev-test-rag-decision', async original => ({ ...(await original()), recordMainDevTestRagDecision: recordDecision }))
import { createPhase1BusinessAgentPortsFromEnv } from '@/modules/agent/phase1-runtime'
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
  it('keeps RAG memory denied without the separate main-dev memory opt-in', async () => {
    const f = fixture()
    f.env.ZURI_MSP_THREAD_MEMORY_ENABLED = 'true'
    f.job.memorySyncOptIn = true
    f.job.account.memoryPolicy = 'ON'
    await expect(createServerLineAnswer({ env: f.env, runtimeFactory: f.runtimeFactory })(f.job))
      .rejects.toThrow(/LINE_ANSWER_UNAVAILABLE/)
    expect(f.runtimeFactory).not.toHaveBeenCalled()
    expect(recordDecision).not.toHaveBeenCalled()
  })
  it('composes authorized memory with pinned RAG evidence and keeps revalidation and receipts on the answer path', async () => {
    const f = fixture()
    f.env.ZURI_MAIN_DEV_LOCAL_OLLAMA_MEMORY_ENABLED = 'true'
    f.env.ZURI_MSP_THREAD_MEMORY_ENABLED = 'true'
    f.env.ZURI_MSP_THREAD_SERVICE_KEY = 't'.repeat(32)
    f.env.ZURI_MSP_THREAD_WORKSPACE_ID = 'msp-main-dev-workspace'
    f.job.memorySyncOptIn = true
    f.job.audienceKind = 'DIRECT'
    f.job.eventId = 'event-rag-memory'
    f.job.sourceUserId = 'line-user-rag-memory'
    f.job.channelAccountId = id(3)
    f.job.transportEpoch = 1
    f.job.inbound = { ...f.job.inbound, id: 'crm-inbound-rag-memory', conversation: {
      tenantId: id(1), businessId: id(2), channel: 'LINE', channelAccountId: id(3),
      externalThreadId: 'line-thread-rag-memory',
    } }
    f.job.account.memoryPolicy = 'ON'

    const events = []
    const ragRecords = [{ product_code: 'TEST-ONLY-RAG-001', name: 'TEST ONLY cup', unit: 'EA',
      sell_price: null, currency: null, moq: null, specification: {}, citationId: 'citation-1' }]
    const ragQuery = vi.fn(async () => {
      events.push('rag-query')
      return { records: ragRecords, retrievalRefs: [{ citationId: 'citation-1', sourceId: id(5) }],
        meta: { mode: 'GKS_CORPUS', source: 'GKS_CORPUS', reason: null, budgetMs: 10 } }
    })
    const ragRevalidate = vi.fn(async () => { events.push('rag-revalidate') })
    const binding = { schema: 'zuri.line-test-rag.binding.v1', denied: false,
      profileSha256: 'd'.repeat(64), sourceSha256: 'e'.repeat(64) }
    const mainDevTestRagReaderFactory = vi.fn(() => ({ query: ragQuery,
      revalidate: ragRevalidate, getBinding: () => binding }))
    const connection = { id: 'connection-main-dev-rag-memory', tenantId: id(1), businessId: id(2),
      purpose: 'PHASE1_LINE_LLM', role: 'PRIMARY', status: 'ACTIVE',
      metadataJson: JSON.stringify({ model: 'fixture' }), provider: { code: 'ollama', status: 'ACTIVE' }, credential: null }
    const integrationDb = {
      $queryRaw: vi.fn(async () => [{ databaseName: 'unit_rag' }]),
      integrationConnection: { findMany: vi.fn(async () => []) },
    }
    const connectionResolver = vi.fn(async () => connection)
    const fetchFn = vi.fn(async (_url, request) => {
      events.push('model')
      expect(request.body).toContain('remembered bounded thread context')
      expect(request.body).toContain('TEST ONLY cup')
      expect(request.body).not.toMatch(/sourceId|ingestionId|fileSha256|manifestHash|private-cost/)
      return new Response(JSON.stringify({ response: 'TEST ONLY cup', prompt_eval_count: 8, eval_count: 5 }), {
        headers: { 'content-type': 'application/json' },
      })
    })
    const mspCalls = []
    const mspTransport = vi.fn(async (name, input) => {
      mspCalls.push({ name, input })
      if (name === 'msp_thread_resolve') return { thread: { threadId: 'msp-rag-memory-thread', businessId: id(2), audienceKind: 'DIRECT' } }
      if (name === 'msp_thread_message_append') return {
        message: { messageId: input.message_id ?? `msp-${input.direction.toLowerCase()}`,
          exchangeId: input.exchange_id ?? 'msp-rag-memory-exchange' },
        session: { sessionId: input.session_id ?? 'msp-rag-memory-session' },
      }
      if (name === 'msp_thread_injection_record') return { receiptId: 'msp-rag-memory-receipt' }
      throw new Error(`unexpected MSP operation: ${name}`)
    })
    const identity = { principalId: id(9), verified: true }
    const thread = { threadId: 'msp-rag-memory-thread', businessId: id(2), audienceKind: 'DIRECT' }
    const authContext = { scope: { tenantId: id(1), businessId: id(2) },
      actor: { principalId: identity.principalId, identityVerified: true },
      policy: { decision: 'ALLOW', privateMemoryAllowed: true,
        mspAuthorization: { read: true, writePrivate: true }, version: 'rag-memory-policy-v1' } }
    const recentExchange = { exchangeId: 'previous-rag-memory-exchange', messages: [
      { sequence: 1, speakerKind: 'HUMAN', text: 'remembered bounded thread context' },
    ] }
    const contextAssembler = vi.fn(async input => {
      if (input.deferThreadRecall) {
        await input.threadMemory.resolveThread({ threadKind: 'DIRECT', audienceKind: 'DIRECT',
          channelType: 'LINE', channelAccountId: id(3), externalRoomRef: 'line-thread-rag-memory',
          tenantId: id(1), businessId: id(2) })
        return { identity, thread, authContext,
          policy: { version: 'rag-memory-policy-v1', privateMemoryAllowed: true } }
      }
      return { identity, thread, authContext,
        policy: { version: 'rag-memory-policy-v1', privateMemoryAllowed: true },
        threadMemory: { contextId: 'rag-memory-context', injectionId: 'rag-memory-injection',
          policyDecision: 'ALLOW', thread, identity,
          memory: { participants: [], recentExchanges: [recentExchange], summaries: [], protectedMemory: [] },
          manifest: { omittedRanges: [], coverageGap: false,
            budget: { maxContextBytes: 24000, estimator: 'utf8-bytes-upper-bound', truncated: false } } } }
    })
    const authorizationResolver = vi.fn(async () => ({ authContext, policy: {
      privateMemoryAllowed: true, mspAuthorization: { read: true, writePrivate: true }, version: 'rag-memory-policy-v1',
    } }))
    const projectionReceiptWriter = vi.fn()
    const runtimeFactory = vi.fn((env, dependencies) => createPhase1BusinessAgentPortsFromEnv(env, {
      ...dependencies, integrationDb, connectionResolver, fetchFn, mspTransport, mainDevTestRagReaderFactory,
    }))

    const answer = createServerLineAnswer({ env: f.env, runtimeFactory, contextAssembler,
      authorizationResolver, projectionReceiptWriter })
    await expect(answer(f.job, { trace: f.trace })).resolves.toBe('TEST ONLY cup')

    expect(runtimeFactory).toHaveBeenCalledOnce()
    expect(mainDevTestRagReaderFactory).toHaveBeenCalledOnce()
    expect(ragQuery).toHaveBeenCalledOnce()
    expect(ragRevalidate).toHaveBeenCalledTimes(3)
    expect(events).toEqual(['rag-query', 'rag-revalidate', 'model', 'rag-revalidate', 'rag-revalidate'])
    expect(f.trace.recordEvidence.mock.calls[0][2]).toMatchObject({ source: 'GKS_CORPUS', mode: 'GKS_CORPUS' })
    expect(recordDecision).toHaveBeenCalledOnce()
    expect(mspCalls.filter(call => call.name === 'msp_thread_injection_record').map(call => call.input.state))
      .toEqual(['RESOLVED', 'SUBMITTED', 'COMPLETED'])
    expect(projectionReceiptWriter.mock.calls.map(([receipt]) => receipt.direction)).toEqual(['INBOUND', 'OUTBOUND'])
  })
})
