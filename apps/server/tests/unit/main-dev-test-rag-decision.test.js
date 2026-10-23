import { describe, expect, it, vi } from 'vitest'
import { checkMainDevTestRagSend, recordMainDevTestRagDecision } from '@/modules/agent/main-dev-test-rag-decision'
import { readMainDevLocalOllamaProfile } from '@/modules/agent/main-dev-local-ollama'
import { mainDevTestRagProfileDigest } from '@/modules/agent/main-dev-test-rag-knowledge'
import { NO_EVIDENCE_REPLY } from '@/modules/agent/line-answer-policy'

const traceWrite = vi.hoisted(() => vi.fn(async (db, input) => {
  db.row = { ...input.scope, ...input, payloadJson: JSON.stringify(input.payload) }
  return db.row
}))
vi.mock('@/modules/agent/execution-trace', async original => ({ ...(await original()), appendTraceEvent: traceWrite }))
// @req FR-079 — content-free, execution-bound RAG decisions survive READY and are rechecked at send.
// @tested tests/unit/main-dev-test-rag-decision.test.js
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
function fixture() {
  const env = { ZURI_MAIN_DEV_LOCAL_OLLAMA_ENABLED: 'true', ZURI_PHASE1_RUNTIME_SOURCE: 'MAIN_DEV_LOCAL_OLLAMA',
    ZURI_MAIN_DEV_LOCAL_OLLAMA_EXPECTED_DATABASE: 'unit_rag', ZURI_MAIN_DEV_LOCAL_OLLAMA_BASE_URL: 'http://host.docker.internal:11434',
    ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_TENANT_IDS: JSON.stringify([id(1)]),
    ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_BUSINESS_IDS: JSON.stringify([id(2)]),
    ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_LINE_OA_ACCOUNT_IDS: JSON.stringify([id(3)]),
    ZURI_MAIN_DEV_LOCAL_OLLAMA_KNOWLEDGE_SOURCE: 'GENESISRAG17_TEST_ONLY',
    ZURI_MAIN_DEV_LOCAL_OLLAMA_RAG_MANIFEST_SHA256: 'b'.repeat(64),
    ZURI_MAIN_DEV_LOCAL_OLLAMA_RAG_PRODUCTS: JSON.stringify([{ productId: id(4), sku: 'TEST-ONLY-RAG-001',
      sourceId: id(5), ingestionId: id(6), fileSha256: 'c'.repeat(64) }]) }
  const job = { id: id(7), executionId: id(8), tenantId: id(1), businessId: id(2), accountId: id(3),
    executionMode: 'SERVER', runtimeOwner: 'SERVER', inbound: { body: 'ชื่อสินค้า TEST-ONLY-RAG-001' }, answerText: 'TEST ONLY cup',
    account: { id: id(3), tenantId: id(1), businessId: id(2), executionMode: 'SERVER', runtimeOwner: 'SERVER',
      serverEnabled: true, knowledgeGrounding: 'GKS_CORPUS', knowledgeGroundingShadow: false, memoryPolicy: 'OFF', memoryProjectId: null } }
  const binding = { schema: 'zuri.line-test-rag.binding.v1', denied: false,
    profileSha256: mainDevTestRagProfileDigest(readMainDevLocalOllamaProfile(env)), sourceSha256: 'd'.repeat(64) }
  const db = { row: null, $queryRaw: vi.fn(async () => [{ databaseName: 'unit_rag' }]),
    agentTraceEvent: { findUnique: vi.fn(async () => db.row) } }
  const snapshotReader = vi.fn(async () => ({ binding }))
  return { env, job, binding, db, snapshotReader }
}
describe('RAG send proof', () => {
  it('requires proof for the configured pilot, but leaves ordinary non-RAG jobs alone', async () => {
    const f = fixture()
    expect(await checkMainDevTestRagSend(f.db, f.job, { env: f.env })).toEqual({ required: true, allowed: false })
    expect(await checkMainDevTestRagSend(f.db, f.job, { env: {} })).toEqual({ required: false, allowed: true })
    expect(await checkMainDevTestRagSend(f.db, f.job, { env: {
      ZURI_MAIN_DEV_LOCAL_OLLAMA_KNOWLEDGE_SOURCE: 'GENESISRAG17_TEST_ONLY',
      ZURI_MAIN_DEV_LOCAL_OLLAMA_ENABLED: 'false',
      ZURI_MAIN_DEV_LOCAL_OLLAMA_RAG_PRODUCTS: 'invalid inactive configuration',
    } })).toEqual({ required: false, allowed: true })
  })
  it('binds the reply and execution, then validates current source on a later send', async () => {
    const f = fixture()
    await recordMainDevTestRagDecision(f.db, f.job, { binding: f.binding, replyText: f.job.answerText })
    expect(await checkMainDevTestRagSend(f.db, structuredClone(f.job), f)).toEqual({ required: true, allowed: true })
    expect(await checkMainDevTestRagSend(f.db, f.job, { ...f, env: {} })).toEqual({ required: true, allowed: false })
    f.job.answerText = 'changed'
    expect(await checkMainDevTestRagSend(f.db, f.job, f)).toEqual({ required: true, allowed: false })
  })
  it('permits a denied decision only for the fixed no-evidence answer', async () => {
    const f = fixture(); f.binding = { ...f.binding, denied: true, sourceSha256: null }; f.job.answerText = NO_EVIDENCE_REPLY
    await recordMainDevTestRagDecision(f.db, f.job, { binding: f.binding, replyText: f.job.answerText })
    expect(await checkMainDevTestRagSend(f.db, f.job, f)).toEqual({ required: true, allowed: true })
    expect(f.snapshotReader).not.toHaveBeenCalled()
    f.job.answerText = 'ราคา 999 บาท'
    expect(await checkMainDevTestRagSend(f.db, f.job, f)).toEqual({ required: true, allowed: false })
  })
})
