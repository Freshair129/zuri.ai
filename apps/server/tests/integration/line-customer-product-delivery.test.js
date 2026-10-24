import { randomUUID } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { NO_EVIDENCE_REPLY } from '@/modules/agent/line-answer-policy'
import { readMainDevLocalOllamaProfile } from '@/modules/agent/main-dev-local-ollama'
import { sha256, appendTraceEvent } from '@/modules/agent/execution-trace'
import { hashGenesisRag17Json } from '@/modules/knowledge/genesisrag17-contract'
import { admitLineConversation, runLineConversationWorker } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { recordLineProductFactsDecision } from '@/modules/line-oa-studio/application/line-product-facts-decision'
import { createIntegrationConnection, LINE_OA_PROVIDER_CODE, registerIntegrationProvider } from '@/platform/integrations/core/integration-registry'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'

// @req FR-079, FR-235 — customer-product answers need an execution-bound current proof at the real LINE send fence.
// @spec SEC-001, SEC-032 — only digests and the exact binding persist; stale proof cancels before transport.
// @tested tests/integration/line-customer-product-delivery.test.js

const engine = inject('testDatabaseEngine') ?? 'sqlite'
const lineEnv = { ZURI_LINE_REPLY_SEAL_KEY: 'd2'.repeat(32) }
const at = new Date('2026-10-24T02:00:00.000Z')
const later = ms => new Date(at.getTime() + ms)
const randomPart = () => randomUUID().replaceAll('-', '').slice(0, 12)
const ANSWER = 'ชื่อสินค้า: TEST ONLY mug'

let db, expectedDatabase, tenant, business, provider
let next = 0
const jobIds = []
const accountIds = []
const connectionIds = []

/** SQLite substitutes database identity only; PostgreSQL proves its own name. */
function sqliteIdentityDb(client, databaseName) {
  return new Proxy(client, { get(target, property) {
    const value = Reflect.get(target, property, target)
    if (property === '$queryRaw') return (query, ...args) => String(query).includes('current_database()')
      ? Promise.resolve([{ databaseName }]) : value.call(target, query, ...args)
    if (property === '$transaction' && typeof value === 'function') return (input, ...args) => typeof input === 'function'
      ? value.call(target, tx => input(sqliteIdentityDb(tx, databaseName)), ...args)
      : value.call(target, input, ...args)
    return typeof value === 'function' ? value.bind(target) : value
  } })
}

function profileEnvFor(account) {
  return {
    ZURI_MAIN_DEV_LOCAL_OLLAMA_ENABLED: 'true',
    ZURI_PHASE1_RUNTIME_SOURCE: 'MAIN_DEV_LOCAL_OLLAMA',
    ZURI_MAIN_DEV_LOCAL_OLLAMA_EXPECTED_DATABASE: expectedDatabase,
    ZURI_MAIN_DEV_LOCAL_OLLAMA_BASE_URL: 'http://host.docker.internal:11434',
    ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_TENANT_IDS: JSON.stringify([tenant.id]),
    ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_BUSINESS_IDS: JSON.stringify([business.id]),
    ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_LINE_OA_ACCOUNT_IDS: JSON.stringify([account.id]),
    ZURI_MAIN_DEV_LOCAL_OLLAMA_KNOWLEDGE_SOURCE: 'GENESISRAG17_CUSTOMER_PRODUCTS',
  }
}

function customerBinding(env, over = {}) {
  const profile = readMainDevLocalOllamaProfile(env)
  return {
    schema: 'zuri.line-customer-products.binding.v1',
    denied: false,
    profileSha256: hashGenesisRag17Json(profile),
    policyId: randomUUID(),
    policyVersion: 3,
    policySha256: 'a'.repeat(64),
    sourceSha256: 'b'.repeat(64),
    projectionSha256: 'c'.repeat(64),
    ...over,
  }
}

async function recordDecision(job, binding, replyText) {
  return appendTraceEvent(db, {
    scope: { tenantId: job.tenantId, businessId: job.businessId },
    turnId: job.id,
    executionId: job.executionId,
    kind: 'TOOL_RESULT',
    idempotencyKey: `${job.id}:line-customer-products:${job.executionId}`,
    occurredAt: at,
    payload: {
      tool: 'LINE_CUSTOMER_PRODUCT_DISCLOSURE', decision: 'READ', binding,
      requestSha256: sha256(job.inbound.body), replySha256: sha256(replyText),
    },
  })
}

async function createAccount({ runtimeOwner = 'SERVER', businessHours = null } = {}) {
  const suffix = `${Date.now()}-${++next}-${randomPart()}`
  const connection = await createIntegrationConnection({
    tenantId: tenant.id,
    businessId: business.id,
    providerId: provider.id,
    name: `LINE customer-product delivery ${suffix}`,
    externalAccountId: `line-customer-product-${suffix}`,
    status: 'ACTIVE',
  })
  connectionIds.push(connection.id)
  const account = await prisma.lineOaAccount.create({ data: {
    tenantId: tenant.id,
    businessId: business.id,
    integrationConnectionId: connection.id,
    code: `LCPD-${suffix}`,
    bindingCode: `LCPD-BIND-${suffix}`,
    displayName: `LINE customer-product delivery ${suffix}`,
    status: 'CONNECTED',
    transportMode: 'CLOUD',
    serverEnabled: true,
    executionMode: 'SERVER',
    runtimeOwner,
    modelAccess: 'LOCAL_ONLY',
    knowledgeGrounding: 'GKS_CORPUS',
    knowledgeGroundingShadow: false,
    memoryPolicy: 'OFF',
    allowDelayedPush: true,
  } })
  accountIds.push(account.id)
  return businessHours ? prisma.lineOaAccount.update({ where: { id: account.id }, data: businessHours }) : account
}

function event(label, messageText = null) {
  const id = `line-customer-product-${label}-${++next}-${randomPart()}`
  return {
    type: 'message',
    webhookEventId: `event-${id}`,
    replyToken: `reply-token-${id}`,
    timestamp: at.getTime(),
    source: { type: 'user', userId: `user-${id}` },
    message: { type: 'text', id: `message-${id}`, text: messageText ?? `What is the TEST ONLY product name? ${id}` },
  }
}

async function admit(account, label, env = lineEnv, messageText = null) {
  const admitted = await admitLineConversation({ account, event: event(label, messageText), correlationId: `corr-${randomPart()}`, now: at, env, db })
  jobIds.push(admitted.jobId)
  return admitted
}

function worker(over = {}) {
  return {
    db,
    env: lineEnv,
    now: () => at,
    workerId: `line-customer-product-${randomPart()}`,
    answer: vi.fn(async () => ({ text: ANSWER })),
    resolveAccount: id => prisma.lineOaAccount.findUnique({ where: { id } }),
    replyTransport: { send: vi.fn(async () => ({ status: 'ACCEPTED_BY_LINE', requestId: 'customer-product-reply' })) },
    pushTransport: { send: vi.fn(async () => ({ status: 'ACCEPTED_BY_LINE', requestId: 'customer-product-push' })) },
    ...over,
  }
}

beforeAll(async () => {
  const suffix = randomPart()
  const portfolio = await createPortfolio({ code: `PF-LCPD-${suffix}`, name: 'LINE customer-product delivery' })
  tenant = await createTenant({ portfolioId: portfolio.id, code: `TNT-LCPD-${suffix}`, name: 'LINE customer-product delivery' })
  business = await createBusiness({ tenantId: tenant.id, code: `BUS-LCPD-${suffix}`, name: 'LINE customer-product delivery' })
  provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE Official Account' })
  if (engine === 'postgresql') {
    const rows = await prisma.$queryRaw`SELECT current_database() AS "databaseName"`
    expectedDatabase = rows[0]?.databaseName
    db = prisma
  } else {
    expectedDatabase = 'line_customer_product_sqlite'
    db = sqliteIdentityDb(prisma, expectedDatabase)
  }
}, 60_000)

afterEach(async () => {
  if (jobIds.length) {
    await prisma.agentTraceEvent.deleteMany({ where: { turnId: { in: [...jobIds] } } })
    await prisma.auditEvent.deleteMany({ where: { entityType: 'LINE_PRODUCT_FACTS_READ', entityId: { in: [...jobIds] } } })
    await prisma.lineConversationJob.deleteMany({ where: { id: { in: [...jobIds] } } })
  }
  if (accountIds.length) await prisma.lineOaAccount.deleteMany({ where: { id: { in: [...accountIds] } } })
  if (connectionIds.length) await prisma.integrationConnection.deleteMany({ where: { id: { in: [...connectionIds] } } })
  jobIds.splice(0)
  accountIds.splice(0)
  connectionIds.splice(0)
})

describe('LINE customer-product durable send fence', () => {
  it('preserves the admission-time fixed out-of-hours reply without requiring a customer-product proof', async () => {
    const account = await createAccount({ businessHours: {
      businessHoursOpen: '09:30', businessHoursClose: '18:00', outOfHoursReplyText: 'ขณะนี้ปิดทำการ',
    } })
    const env = { ...lineEnv, ...profileEnvFor(account) }
    const admitted = await admit(account, 'fixed-out-of-hours', env)
    expect(await prisma.lineConversationJob.findUnique({ where: { id: admitted.jobId } })).toMatchObject({
      status: 'READY', answerText: 'ขณะนี้ปิดทำการ', executionId: null,
    })
    const answer = vi.fn(async () => { throw new Error('OUT_OF_HOURS_MUST_NOT_RUN_MODEL') })
    const customerSnapshotReader = vi.fn(async () => { throw new Error('OUT_OF_HOURS_MUST_NOT_READ_CUSTOMER_PRODUCTS') })
    const replySend = vi.fn(async () => ({ status: 'ACCEPTED_BY_LINE', requestId: 'fixed-out-of-hours-reply' }))
    await runLineConversationWorker(worker({
      env, answer,
      customerProductOptions: { snapshotReader: customerSnapshotReader },
      replyTransport: { send: replySend },
    }))
    expect(answer).not.toHaveBeenCalled()
    expect(customerSnapshotReader).not.toHaveBeenCalled()
    expect(replySend).toHaveBeenCalledWith(expect.objectContaining({ messages: [{ type: 'text', text: 'ขณะนี้ปิดทำการ' }] }))
    expect(await prisma.lineConversationJob.findUnique({ where: { id: admitted.jobId } })).toMatchObject({ status: 'RECORDED' })
  })

  it('sends a current owner-approved decision through the normal LINE transport', async () => {
    const account = await createAccount()
    const admitted = await admit(account, 'current-proof')
    const env = { ...lineEnv, ...profileEnvFor(account) }
    const binding = customerBinding(env)
    const snapshotReader = vi.fn(async () => ({ binding }))
    const replySend = vi.fn(async () => ({ status: 'ACCEPTED_BY_LINE', requestId: 'approved-product-reply' }))
    const result = await runLineConversationWorker(worker({
      env,
      answer: vi.fn(async job => { await recordDecision(job, binding, ANSWER); return { text: ANSWER } }),
      customerProductOptions: { snapshotReader },
      replyTransport: { send: replySend },
    }))
    expect(result).toMatchObject({ id: admitted.jobId, status: 'RECORDED', acceptance: 'ACCEPTED_BY_LINE' })
    expect(snapshotReader).toHaveBeenCalledTimes(1)
    expect(snapshotReader).toHaveBeenCalledWith({
      job: expect.objectContaining({ id: admitted.jobId }), db: expect.anything(), env, policyId: binding.policyId,
    })
    expect(replySend).toHaveBeenCalledWith(expect.objectContaining({ messages: [{ type: 'text', text: ANSWER }] }))
  })

  it('preserves an existing stock-facts decision under customer-product mode without requiring customer proof', async () => {
    const account = await createAccount()
    const env = { ...lineEnv, ...profileEnvFor(account) }
    const request = `#product ${JSON.stringify({ sku: 'SKU-TEST', facets: ['availability'] })}`
    const admitted = await admit(account, 'stock-facts', env, request)
    const replyText = 'สินค้ามีพร้อมจำหน่าย'
    const replySend = vi.fn(async () => ({ status: 'ACCEPTED_BY_LINE', requestId: 'stock-facts-reply' }))
    const revalidateProductFacts = vi.fn(async () => true)
    const customerSnapshotReader = vi.fn(async () => { throw new Error('CUSTOMER_PRODUCT_PROOF_NOT_REQUIRED_FOR_STOCK_FACTS') })
    const result = await runLineConversationWorker(worker({
      env,
      answer: vi.fn(async job => {
        await recordLineProductFactsDecision(db, job, {
          binding: {
            schema: 'zuri.line-product-facts.binding.v1', jobId: job.id, executionId: job.executionId,
            requestDigest: 'a'.repeat(64), authorityDigest: 'b'.repeat(64), productRefDigest: 'c'.repeat(64),
            stockPolicyVersion: 1, stockObservationDigest: 'd'.repeat(64), publicationDigest: null, resultDigest: 'e'.repeat(64),
          },
          replyText,
          now: () => at,
        })
        return { text: replyText }
      }),
      revalidateProductFacts,
      customerProductOptions: { snapshotReader: customerSnapshotReader },
      replyTransport: { send: replySend },
    }))
    expect(result).toMatchObject({ id: admitted.jobId, status: 'RECORDED', acceptance: 'ACCEPTED_BY_LINE' })
    expect(revalidateProductFacts).toHaveBeenCalledTimes(1)
    expect(customerSnapshotReader).not.toHaveBeenCalled()
    expect(replySend).toHaveBeenCalledWith(expect.objectContaining({ messages: [{ type: 'text', text: replyText }] }))
  })

  it('preserves deterministic Project Work command replies under customer-product mode', async () => {
    const account = await createAccount()
    const env = { ...lineEnv, ...profileEnvFor(account) }
    const admitted = await admit(account, 'project-work-command', env, '/work-create invalid-id Create a task')
    const answer = vi.fn(async () => { throw new Error('PROJECT_WORK_COMMAND_MUST_NOT_RUN_MODEL') })
    const customerSnapshotReader = vi.fn(async () => { throw new Error('PROJECT_WORK_MUST_NOT_READ_CUSTOMER_PRODUCTS') })
    const replySend = vi.fn(async () => ({ status: 'ACCEPTED_BY_LINE', requestId: 'project-work-command-reply' }))
    await runLineConversationWorker(worker({
      env, answer,
      customerProductOptions: { snapshotReader: customerSnapshotReader },
      replyTransport: { send: replySend },
    }))
    expect(answer).not.toHaveBeenCalled()
    expect(customerSnapshotReader).not.toHaveBeenCalled()
    expect(replySend).toHaveBeenCalledTimes(1)
    expect(await prisma.lineConversationJob.findUnique({ where: { id: admitted.jobId } })).toMatchObject({ status: 'RECORDED' })
  })

  it('cancels configured customer-product delivery when no execution-bound decision exists', async () => {
    const account = await createAccount()
    const admitted = await admit(account, 'missing-proof')
    const env = { ...lineEnv, ...profileEnvFor(account) }
    const replySend = vi.fn(async () => ({ status: 'ACCEPTED_BY_LINE', requestId: 'unexpected-reply' }))
    const pushSend = vi.fn(async () => ({ status: 'ACCEPTED_BY_LINE', requestId: 'unexpected-push' }))
    await runLineConversationWorker(worker({
      env,
      answer: vi.fn(async () => ({ text: ANSWER })),
      replyTransport: { send: replySend },
      pushTransport: { send: pushSend },
    }))
    expect(await prisma.lineConversationJob.findUnique({ where: { id: admitted.jobId } })).toMatchObject({
      status: 'CANCELLED', answerText: null, sealedReplyToken: null,
      errorCode: 'LINE_CUSTOMER_PRODUCT_AUTHORITY_REVOKED',
    })
    expect(replySend).not.toHaveBeenCalled()
    expect(pushSend).not.toHaveBeenCalled()
  })

  it('cancels before LINE send when the current source binding changes at final revalidation', async () => {
    const account = await createAccount()
    const admitted = await admit(account, 'stale-source')
    const env = { ...lineEnv, ...profileEnvFor(account) }
    const binding = customerBinding(env)
    const freshBinding = { ...binding, sourceSha256: 'd'.repeat(64) }
    const snapshotReader = vi.fn(async () => ({ binding: freshBinding }))
    const replySend = vi.fn(async () => ({ status: 'ACCEPTED_BY_LINE', requestId: 'unexpected-reply' }))
    const pushSend = vi.fn(async () => ({ status: 'ACCEPTED_BY_LINE', requestId: 'unexpected-push' }))
    await runLineConversationWorker(worker({
      env,
      answer: vi.fn(async job => { await recordDecision(job, binding, ANSWER); return { text: ANSWER } }),
      customerProductOptions: { snapshotReader },
      replyTransport: { send: replySend },
      pushTransport: { send: pushSend },
    }))
    expect(snapshotReader).toHaveBeenCalled()
    expect(await prisma.lineConversationJob.findUnique({ where: { id: admitted.jobId } })).toMatchObject({
      status: 'CANCELLED', answerText: null, sealedReplyToken: null,
      errorCode: 'LINE_CUSTOMER_PRODUCT_AUTHORITY_REVOKED',
    })
    expect(replySend).not.toHaveBeenCalled()
    expect(pushSend).not.toHaveBeenCalled()
  })

  it('still requires historical proof when the main-dev customer-product profile is disabled before delayed Push', async () => {
    const account = await createAccount()
    const admitted = await admit(account, 'profile-transition')
    const env = { ...lineEnv, ...profileEnvFor(account) }
    const binding = customerBinding(env)
    const snapshotReader = vi.fn(async () => ({ binding }))
    const failedReply = vi.fn(async () => ({ status: 'PERMANENT_FAILURE', code: 'LINE_HTTP_400', requestId: 'expired-token' }))
    const prepared = await runLineConversationWorker(worker({
      env,
      answer: vi.fn(async job => { await recordDecision(job, binding, ANSWER); return { text: ANSWER } }),
      customerProductOptions: { snapshotReader },
      replyTransport: { send: failedReply },
    }))
    expect(prepared).toMatchObject({ id: admitted.jobId, status: 'READY' })
    const job = await prisma.lineConversationJob.findUnique({ where: { id: admitted.jobId } })
    expect(job).toMatchObject({ status: 'READY', sendMethod: 'PUSH', answerText: ANSWER })

    const pushSend = vi.fn(async () => ({ status: 'ACCEPTED_BY_LINE', requestId: 'unexpected-delayed-push' }))
    await runLineConversationWorker(worker({
      env: lineEnv,
      now: () => later(60_000),
      answer: vi.fn(async () => { throw new Error('READY_RETRY_MUST_NOT_RECOMPUTE_ANSWER') }),
      customerProductOptions: { snapshotReader },
      pushTransport: { send: pushSend },
    }))
    expect(await prisma.lineConversationJob.findUnique({ where: { id: admitted.jobId } })).toMatchObject({
      status: 'CANCELLED', answerText: null, sealedReplyToken: null,
      errorCode: 'LINE_CUSTOMER_PRODUCT_AUTHORITY_REVOKED',
    })
    expect(pushSend).not.toHaveBeenCalled()
  })

  it('sends a denied decision only with the fixed no-evidence reply and rechecks the denied binding', async () => {
    const account = await createAccount()
    const admitted = await admit(account, 'denied-proof')
    const env = { ...lineEnv, ...profileEnvFor(account) }
    const profile = readMainDevLocalOllamaProfile(env)
    const binding = {
      schema: 'zuri.line-customer-products.binding.v1', denied: true,
      profileSha256: hashGenesisRag17Json(profile),
      policyId: null, policyVersion: null, policySha256: null, sourceSha256: null, projectionSha256: null,
    }
    const snapshotReader = vi.fn(async () => ({ binding }))
    const replySend = vi.fn(async () => ({ status: 'ACCEPTED_BY_LINE', requestId: 'no-evidence-reply' }))
    const result = await runLineConversationWorker(worker({
      env,
      answer: vi.fn(async job => { await recordDecision(job, binding, NO_EVIDENCE_REPLY); return { text: NO_EVIDENCE_REPLY } }),
      customerProductOptions: { snapshotReader },
      replyTransport: { send: replySend },
    }))
    expect(result).toMatchObject({ id: admitted.jobId, status: 'RECORDED', acceptance: 'ACCEPTED_BY_LINE' })
    expect(snapshotReader).toHaveBeenCalledTimes(1)
    expect(replySend).toHaveBeenCalledWith(expect.objectContaining({ messages: [{ type: 'text', text: NO_EVIDENCE_REPLY }] }))
    expect(JSON.stringify(binding)).not.toContain(NO_EVIDENCE_REPLY)
  })

  it('keeps customer-product requests on the Server when the account was assigned to the Conversation Runtime', async () => {
    const account = await createAccount({ runtimeOwner: 'CONVERSATION_RUNTIME' })
    const env = { ...lineEnv, ...profileEnvFor(account) }
    const admitted = await admit(account, 'runtime-admission', env)
    const job = await prisma.lineConversationJob.findUnique({ where: { id: admitted.jobId } })
    expect(job.runtimeOwner).toBe('SERVER')
  })
})
