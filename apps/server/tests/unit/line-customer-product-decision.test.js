import { describe, expect, it, vi } from 'vitest'
import { readMainDevLocalOllamaProfile } from '@/modules/agent/main-dev-local-ollama'
import { appendTraceEvent, sha256 } from '@/modules/agent/execution-trace'
import { hashGenesisRag17Json } from '@/modules/knowledge/genesisrag17-contract'
import { NO_EVIDENCE_REPLY } from '@/modules/agent/line-answer-policy'
import { runLineConversationWorker } from '@/modules/line-oa-studio/application/line-conversation-jobs'

// @req FR-079, FR-235 — customer-product send decisions are content-free, execution-bound, and revalidated at delivery.
// @spec SEC-001, SEC-032 — a historical decision remains required and a denied decision can carry only fixed no-evidence.
// @tested tests/unit/line-customer-product-decision.test.js

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const decisionModule = import('@/modules/agent/line-customer-product-decision').catch(() => null)

function fixture() {
  const env = {
    ZURI_MAIN_DEV_LOCAL_OLLAMA_ENABLED: 'true',
    ZURI_PHASE1_RUNTIME_SOURCE: 'MAIN_DEV_LOCAL_OLLAMA',
    ZURI_MAIN_DEV_LOCAL_OLLAMA_EXPECTED_DATABASE: 'unit_customer_product',
    ZURI_MAIN_DEV_LOCAL_OLLAMA_BASE_URL: 'http://host.docker.internal:11434',
    ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_TENANT_IDS: JSON.stringify([id(1)]),
    ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_BUSINESS_IDS: JSON.stringify([id(2)]),
    ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_LINE_OA_ACCOUNT_IDS: JSON.stringify([id(3)]),
    ZURI_MAIN_DEV_LOCAL_OLLAMA_KNOWLEDGE_SOURCE: 'GENESISRAG17_CUSTOMER_PRODUCTS',
  }
  const profile = readMainDevLocalOllamaProfile(env)
  const binding = {
    schema: 'zuri.line-customer-products.binding.v1', denied: false,
    profileSha256: hashGenesisRag17Json(profile),
    policyId: id(4), policyVersion: 5, policySha256: 'a'.repeat(64),
    sourceSha256: 'b'.repeat(64), projectionSha256: 'c'.repeat(64),
  }
  const job = {
    id: id(5), executionId: id(6), tenantId: id(1), businessId: id(2), accountId: id(3),
    executionMode: 'SERVER', runtimeOwner: 'SERVER', inbound: { body: 'What is TEST ONLY mug?' },
    answerText: 'ชื่อสินค้า: TEST ONLY mug',
    account: { id: id(3), tenantId: id(1), businessId: id(2), executionMode: 'SERVER', runtimeOwner: 'SERVER',
      serverEnabled: true, knowledgeGrounding: 'GKS_CORPUS', knowledgeGroundingShadow: false,
      memoryPolicy: 'OFF', memoryProjectId: null },
  }
  const db = { row: null, $queryRaw: vi.fn(async () => [{ databaseName: 'unit_customer_product' }]) }
  db.agentTraceEvent = {
    findMany: vi.fn(async () => []),
    findFirst: vi.fn(async ({ where }) => where.idempotencyKey === db.row?.idempotencyKey ? db.row : null),
    findUnique: vi.fn(async () => db.row),
    create: vi.fn(async ({ data }) => { db.row = { ...data }; return db.row }),
  }
  const snapshotReader = vi.fn(async () => ({ binding }))
  return { env, profile, binding, job, db, snapshotReader }
}

function deniedBinding(profile) {
  return {
    schema: 'zuri.line-customer-products.binding.v1', denied: true,
    profileSha256: hashGenesisRag17Json(profile),
    policyId: null, policyVersion: null, policySha256: null, sourceSha256: null, projectionSha256: null,
  }
}

describe('LINE customer-product durable send decision', () => {
  it('preserves legacy delayed Push recovery without an execution when this mode is off', async () => {
    const { checkLineCustomerProductSend } = await decisionModule
    const { db, job } = fixture()
    expect(await checkLineCustomerProductSend(db, { ...job, executionId: null }, { env: {} }))
      .toEqual({ required: false, allowed: true })
  })
  it('rejects unknown properties in the private customer-product snapshot-reader seam', async () => {
    await expect(runLineConversationWorker({ customerProductOptions: { snapshotReader: () => {}, unrestricted: true } }))
      .rejects.toMatchObject({ message: 'LINE_CUSTOMER_PRODUCT_OPTIONS_INVALID' })
  })

  it('records only execution-bound request/reply digests and the exact source binding', async () => {
    const api = await decisionModule
    expect(typeof api?.recordLineCustomerProductDecision).toBe('function')
    const f = fixture()
    await api.recordLineCustomerProductDecision(f.db, f.job, {
      binding: f.binding, replyText: f.job.answerText, now: () => new Date('2026-10-24T03:00:00.000Z'),
    })
    expect(f.db.agentTraceEvent.create).toHaveBeenCalledTimes(1)
    expect(f.db.row).toMatchObject({
      tenantId: f.job.tenantId, businessId: f.job.businessId,
      turnId: f.job.id, executionId: f.job.executionId, kind: 'TOOL_RESULT',
      idempotencyKey: `${f.job.id}:line-customer-products:${f.job.executionId}`,
      occurredAt: new Date('2026-10-24T03:00:00.000Z'),
    })
    expect(JSON.parse(f.db.row.payloadJson)).toEqual({
      tool: 'LINE_CUSTOMER_PRODUCT_DISCLOSURE', decision: 'READ', binding: f.binding,
      requestSha256: sha256(f.job.inbound.body), replySha256: sha256(f.job.answerText),
    })
    expect(f.db.row.payloadJson).not.toContain(f.job.inbound.body)
    expect(f.db.row.payloadJson).not.toContain(f.job.answerText)
  })

  it('refuses a denied decision whose reply is not the fixed no-evidence text', async () => {
    const api = await decisionModule
    expect(typeof api?.recordLineCustomerProductDecision).toBe('function')
    const f = fixture()
    await expect(api.recordLineCustomerProductDecision(f.db, f.job, {
      binding: deniedBinding(f.profile), replyText: 'invented customer prose',
    })).rejects.toMatchObject({ code: 'LINE_CUSTOMER_PRODUCT_DECISION_INVALID' })
    expect(f.db.agentTraceEvent.create).not.toHaveBeenCalled()
    expect(NO_EVIDENCE_REPLY).not.toBe('invented customer prose')
  })

  it('requires a proof in the configured mode and keeps historical proof required after the mode is disabled', async () => {
    const api = await decisionModule
    expect(typeof api?.checkLineCustomerProductSend).toBe('function')
    const f = fixture()
    expect(await api.checkLineCustomerProductSend(f.db, f.job, { env: f.env, snapshotReader: f.snapshotReader }))
      .toEqual({ required: true, allowed: false })
    expect(await api.checkLineCustomerProductSend(f.db, f.job, { env: {}, snapshotReader: f.snapshotReader }))
      .toEqual({ required: false, allowed: true })
    await api.recordLineCustomerProductDecision(f.db, f.job, { binding: f.binding, replyText: f.job.answerText })
    expect(await api.checkLineCustomerProductSend(f.db, f.job, { env: {}, snapshotReader: f.snapshotReader }))
      .toEqual({ required: true, allowed: false })
  })

  it('can skip only the current-mode requirement for a deterministic answer while retaining historical proof checks', async () => {
    const api = await decisionModule
    expect(typeof api?.checkLineCustomerProductSend).toBe('function')
    const f = fixture()
    expect(await api.checkLineCustomerProductSend(f.db, f.job, {
      env: f.env, snapshotReader: f.snapshotReader, requireWhenConfigured: false,
    })).toEqual({ required: false, allowed: true })
    await api.recordLineCustomerProductDecision(f.db, f.job, { binding: f.binding, replyText: f.job.answerText })
    expect(await api.checkLineCustomerProductSend(f.db, f.job, {
      env: f.env, snapshotReader: f.snapshotReader, requireWhenConfigured: false,
    })).toEqual({ required: true, allowed: true })
    f.job.inbound.body = '#product {"sku":"TEST","facets":["availability"]}'
    expect(await api.checkLineCustomerProductSend(f.db, f.job, {
      env: f.env, snapshotReader: f.snapshotReader, requireWhenConfigured: false,
    })).toEqual({ required: true, allowed: false })
  })

  it('checks the current profile, database and fresh exact binding even for a denied proof', async () => {
    const api = await decisionModule
    expect(typeof api?.checkLineCustomerProductSend).toBe('function')
    const f = fixture()
    f.binding = deniedBinding(f.profile)
    f.job.answerText = NO_EVIDENCE_REPLY
    f.snapshotReader.mockResolvedValue({ binding: f.binding })
    await api.recordLineCustomerProductDecision(f.db, f.job, { binding: f.binding, replyText: NO_EVIDENCE_REPLY })
    expect(await api.checkLineCustomerProductSend(f.db, f.job, { env: f.env, snapshotReader: f.snapshotReader }))
      .toEqual({ required: true, allowed: true })
    expect(f.db.$queryRaw).toHaveBeenCalledTimes(1)
    expect(f.snapshotReader).toHaveBeenCalledWith({ job: f.job, db: f.db, env: f.env, policyId: null })

    f.snapshotReader.mockResolvedValue({ binding: { ...f.binding, profileSha256: 'd'.repeat(64) } })
    expect(await api.checkLineCustomerProductSend(f.db, f.job, { env: f.env, snapshotReader: f.snapshotReader }))
      .toEqual({ required: true, allowed: false })
  })

  it('accepts only the product snapshot module envelope shapes while comparing the exact binding', async () => {
    const api = await decisionModule
    expect(typeof api?.checkLineCustomerProductSend).toBe('function')
    const f = fixture()
    await api.recordLineCustomerProductDecision(f.db, f.job, { binding: f.binding, replyText: f.job.answerText })
    f.snapshotReader.mockResolvedValue({ profile: f.profile, policy: { id: f.binding.policyId },
      source: { retrievalRef: { sourceId: 'internal' } }, binding: f.binding })
    expect(await api.checkLineCustomerProductSend(f.db, f.job, { env: f.env, snapshotReader: f.snapshotReader }))
      .toEqual({ required: true, allowed: true })
    f.snapshotReader.mockResolvedValue({ binding: f.binding, unapproved: 'unexpected' })
    expect(await api.checkLineCustomerProductSend(f.db, f.job, { env: f.env, snapshotReader: f.snapshotReader }))
      .toEqual({ required: true, allowed: false })
  })

  it('cancels proof validation when the current database or customer-product profile guard fails', async () => {
    const api = await decisionModule
    expect(typeof api?.checkLineCustomerProductSend).toBe('function')
    const f = fixture()
    await api.recordLineCustomerProductDecision(f.db, f.job, { binding: f.binding, replyText: f.job.answerText })
    f.db.$queryRaw.mockResolvedValue([{ databaseName: 'wrong_database' }])
    expect(await api.checkLineCustomerProductSend(f.db, f.job, { env: f.env, snapshotReader: f.snapshotReader }))
      .toEqual({ required: true, allowed: false })
    f.db.$queryRaw.mockResolvedValue([{ databaseName: 'unit_customer_product' }])
    const changedEnv = { ...f.env, ZURI_MAIN_DEV_LOCAL_OLLAMA_KNOWLEDGE_SOURCE: 'GENESISRAG17_TEST_ONLY' }
    expect(await api.checkLineCustomerProductSend(f.db, f.job, { env: changedEnv, snapshotReader: f.snapshotReader }))
      .toEqual({ required: true, allowed: false })
  })
})
