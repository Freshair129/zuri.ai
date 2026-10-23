import { createHash, randomUUID } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { NO_EVIDENCE_REPLY } from '@/modules/agent/line-answer-policy'
import { createMainDevTestRagKnowledgeReader, mainDevTestRagProfileDigest } from '@/modules/agent/main-dev-test-rag-knowledge'
import { readMainDevLocalOllamaProfile } from '@/modules/agent/main-dev-local-ollama'
import { recordMainDevTestRagDecision } from '@/modules/agent/main-dev-test-rag-decision'
import { sha256 } from '@/modules/agent/execution-trace'
import { createServerLineAnswer } from '@/modules/agent/server-line-answer'
import { createCategory, createProduct, createProductMaster } from '@/modules/inventory/application/inventory-catalog-service'
import { readAuthorizedKnowledgeManifest, withdrawKnowledgeSource } from '@/modules/knowledge/knowledge-corpus-service'
import {
  admitLineConversation,
  runLineConversationWorker,
} from '@/modules/line-oa-studio/application/line-conversation-jobs'
import {
  createIntegrationConnection,
  LINE_OA_PROVIDER_CODE,
  registerIntegrationProvider,
} from '@/platform/integrations/core/integration-registry'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { createPublishedPriceCatalogFixture } from '../factories/published-price-catalog'
import { makeViewer } from '../factories/viewer'

// @req FR-079, FR-235 — a TEST ONLY GenesisRAG17 answer needs durable, current
//   source proof at the real LINE send fence; normal non-RAG sends stay unchanged.
// @spec SEC-001, SEC-032 — delivery tests control the snapshot boundary. The
//   catalog case uses real publication, manifest and PCAT bytes, but controls
//   queryCorpus and does not claim native GenesisRAG17 retrieval acceptance.
// @tested tests/integration/main-dev-test-rag-delivery.test.js

const engine = inject('testDatabaseEngine') ?? 'sqlite'
const lineEnv = { ZURI_LINE_REPLY_SEAL_KEY: 'd2'.repeat(32) }
const at = new Date('2026-10-24T02:00:00.000Z')
const later = ms => new Date(at.getTime() + ms)
const randomPart = () => randomUUID().replaceAll('-', '').slice(0, 12)
const SOURCE_A = 'a'.repeat(64)
const SOURCE_B = 'b'.repeat(64)
const ANSWER = 'TEST ONLY: product metadata from the authorized source.'

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
    ZURI_MAIN_DEV_LOCAL_OLLAMA_KNOWLEDGE_SOURCE: 'GENESISRAG17_TEST_ONLY',
    ZURI_MAIN_DEV_LOCAL_OLLAMA_RAG_MANIFEST_SHA256: 'c'.repeat(64),
    ZURI_MAIN_DEV_LOCAL_OLLAMA_RAG_PRODUCTS: JSON.stringify([{
      productId: randomUUID(),
      sku: `TEST-ONLY-LTDR-${randomPart()}`,
      sourceId: randomUUID(),
      ingestionId: randomUUID(),
      fileSha256: 'd'.repeat(64),
    }]),
  }
}

function decisionBinding(profileEnv, { denied = false, sourceSha256 = SOURCE_A } = {}) {
  const profile = readMainDevLocalOllamaProfile(profileEnv)
  return {
    schema: 'zuri.line-test-rag.binding.v1',
    denied,
    profileSha256: mainDevTestRagProfileDigest(profile),
    sourceSha256: denied ? null : sourceSha256,
  }
}

function snapshotReader(sourceState) {
  return vi.fn(async ({ profile }) => ({ binding: {
    schema: 'zuri.line-test-rag.binding.v1',
    denied: false,
    profileSha256: mainDevTestRagProfileDigest(profile),
    sourceSha256: sourceState.value,
  } }))
}

async function createAccount({ rag = true, allowDelayedPush = true } = {}) {
  const suffix = `${Date.now()}-${++next}-${randomPart()}`
  const connection = await createIntegrationConnection({
    tenantId: tenant.id,
    businessId: business.id,
    providerId: provider.id,
    name: `LINE test RAG delivery ${suffix}`,
    externalAccountId: `line-test-rag-${suffix}`,
    status: 'ACTIVE',
  })
  connectionIds.push(connection.id)
  const account = await prisma.lineOaAccount.create({ data: {
    tenantId: tenant.id,
    businessId: business.id,
    integrationConnectionId: connection.id,
    code: `LTDR-${suffix}`,
    bindingCode: `LTDR-BIND-${suffix}`,
    displayName: `LINE test RAG delivery ${suffix}`,
    status: 'CONNECTED',
    transportMode: 'CLOUD',
    serverEnabled: true,
    executionMode: 'SERVER',
    runtimeOwner: 'SERVER',
    modelAccess: 'LOCAL_ONLY',
    knowledgeGrounding: rag ? 'GKS_CORPUS' : 'BUSINESS_KNOWLEDGE',
    knowledgeGroundingShadow: false,
    memoryPolicy: 'OFF',
    allowDelayedPush,
  } })
  accountIds.push(account.id)
  return account
}

function event(label) {
  const id = `main-dev-test-rag-${label}-${++next}-${randomPart()}`
  return {
    type: 'message',
    webhookEventId: `event-${id}`,
    replyToken: `reply-token-${id}`,
    timestamp: at.getTime(),
    source: { type: 'user', userId: `user-${id}` },
    message: { type: 'text', id: `message-${id}`, text: `What is the TEST ONLY product metadata? ${id}` },
  }
}

async function admit(account, label) {
  const incoming = event(label)
  const admitted = await admitLineConversation({
    account,
    event: incoming,
    correlationId: `corr-${randomPart()}`,
    now: at,
    env: lineEnv,
    db,
  })
  jobIds.push(admitted.jobId)
  return admitted
}

function worker(over = {}) {
  return {
    db,
    env: lineEnv,
    now: () => at,
    workerId: `main-dev-test-rag-${randomPart()}`,
    answer: vi.fn(async () => ({ text: ANSWER })),
    resolveAccount: id => prisma.lineOaAccount.findUnique({ where: { id } }),
    replyTransport: { send: vi.fn(async () => ({ status: 'ACCEPTED_BY_LINE', requestId: 'test-rag-reply' })) },
    pushTransport: { send: vi.fn(async () => ({ status: 'ACCEPTED_BY_LINE', requestId: 'test-rag-push' })) },
    ...over,
  }
}

/** Run a real worker through Reply→Push, leaving a durable READY job for a fresh worker. */
async function prepareReadyJob({ label = 'prepared', replyText = ANSWER, denied = false } = {}) {
  const account = await createAccount()
  const admitted = await admit(account, label)
  const profileEnv = profileEnvFor(account)
  const sourceState = { value: SOURCE_A }
  const reader = snapshotReader(sourceState)
  const binding = decisionBinding(profileEnv, { denied, sourceSha256: sourceState.value })
  const answer = vi.fn(async job => {
    await recordMainDevTestRagDecision(db, job, { binding, replyText, now: () => at })
    return { text: replyText }
  })
  const replySend = vi.fn(async () => ({
    status: 'PERMANENT_FAILURE', code: 'LINE_HTTP_400', requestId: `dead-reply-${randomPart()}`,
  }))
  const firstWorker = worker({
    env: { ...lineEnv, ...profileEnv },
    answer,
    replyTransport: { send: replySend },
    testRagOptions: { snapshotReader: reader },
  })
  const first = await runLineConversationWorker(firstWorker)
  expect(first).toMatchObject({ id: admitted.jobId, status: 'READY' })
  expect(replySend).toHaveBeenCalledTimes(1)
  expect(await prisma.lineConversationJob.findUnique({ where: { id: admitted.jobId } }))
    .toMatchObject({ status: 'READY', sendMethod: 'PUSH', answerText: replyText })
  return { account, admitted, profileEnv, sourceState, reader, binding, replyText }
}

async function sendReadyJob(prepared, over = {}) {
  const answer = vi.fn(async () => { throw new Error('READY_RETRY_MUST_NOT_RECOMPUTE_ANSWER') })
  const replySend = vi.fn(async () => ({ status: 'ACCEPTED_BY_LINE', requestId: 'unexpected-ready-reply' }))
  const pushSend = vi.fn(async () => ({ status: 'ACCEPTED_BY_LINE', requestId: `fresh-push-${randomPart()}` }))
  const outcome = await runLineConversationWorker(worker({
    now: () => later(60_000),
    workerId: `fresh-test-rag-worker-${randomPart()}`,
    answer,
    env: { ...lineEnv, ...prepared.profileEnv },
    replyTransport: { send: replySend },
    pushTransport: { send: pushSend },
    testRagOptions: { snapshotReader: prepared.reader },
    ...over,
  }))
  return { outcome, answer, replySend, pushSend }
}

beforeAll(async () => {
  const suffix = randomPart()
  const portfolio = await createPortfolio({ code: `PF-LTDR-${suffix}`, name: 'LINE TEST ONLY RAG delivery' })
  tenant = await createTenant({ portfolioId: portfolio.id, code: `TNT-LTDR-${suffix}`, name: 'LINE TEST ONLY RAG delivery' })
  business = await createBusiness({ tenantId: tenant.id, code: `BUS-LTDR-${suffix}`, name: 'LINE TEST ONLY RAG delivery' })
  provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE Official Account' })
  if (engine === 'postgresql') {
    const rows = await prisma.$queryRaw`SELECT current_database() AS "databaseName"`
    expectedDatabase = rows[0]?.databaseName
    db = prisma
  } else {
    expectedDatabase = 'main_dev_test_rag_sqlite'
    db = sqliteIdentityDb(prisma, expectedDatabase)
  }
}, 60_000)

afterEach(async () => {
  if (jobIds.length) {
    await prisma.agentTraceEvent.deleteMany({ where: { turnId: { in: [...jobIds] } } })
    await prisma.lineConversationJob.deleteMany({ where: { id: { in: [...jobIds] } } })
  }
  if (accountIds.length) await prisma.lineOaAccount.deleteMany({ where: { id: { in: [...accountIds] } } })
  if (connectionIds.length) await prisma.integrationConnection.deleteMany({ where: { id: { in: [...connectionIds] } } })
  jobIds.splice(0)
  accountIds.splice(0)
  connectionIds.splice(0)
})

describe('main-dev TEST ONLY GenesisRAG17 LINE delivery fence', () => {
  it('reads the durable content-free proof from a fresh worker before the delayed Push', async () => {
    const prepared = await prepareReadyJob({ label: 'durable-proof' })
    const job = await prisma.lineConversationJob.findUnique({ where: { id: prepared.admitted.jobId } })
    const decision = await prisma.agentTraceEvent.findUnique({ where: {
      tenantId_businessId_idempotencyKey: {
        tenantId: tenant.id,
        businessId: business.id,
        idempotencyKey: `${job.id}:line-test-rag:${job.executionId}`,
      },
    } })
    expect(decision).toMatchObject({ turnId: job.id, executionId: job.executionId, kind: 'TOOL_RESULT' })
    const payload = JSON.parse(decision.payloadJson)
    expect(payload).toMatchObject({
      tool: 'LINE_TEST_ONLY_RAG', decision: 'READ',
      binding: prepared.binding,
      requestSha256: sha256((await prisma.message.findUnique({ where: { id: job.inboundMessageId } })).body),
      replySha256: sha256(prepared.replyText),
    })
    expect(decision.payloadJson).not.toContain(prepared.replyText)

    const sent = await sendReadyJob(prepared)
    expect(sent.outcome).toMatchObject({ id: job.id, status: 'RECORDED', acceptance: 'ACCEPTED_BY_LINE' })
    expect(sent.answer).not.toHaveBeenCalled()
    expect(sent.replySend).not.toHaveBeenCalled()
    expect(sent.pushSend).toHaveBeenCalledWith(expect.objectContaining({
      messages: [{ type: 'text', text: prepared.replyText }],
    }))
  })

  it('sends only the fixed no-evidence text from a denied proof and skips source revalidation', async () => {
    const prepared = await prepareReadyJob({ label: 'denied-proof', replyText: NO_EVIDENCE_REPLY, denied: true })
    expect(prepared.reader).not.toHaveBeenCalled()
    const sent = await sendReadyJob(prepared)
    expect(sent.outcome).toMatchObject({ id: prepared.admitted.jobId, status: 'RECORDED', acceptance: 'ACCEPTED_BY_LINE' })
    expect(sent.pushSend).toHaveBeenCalledWith(expect.objectContaining({
      messages: [{ type: 'text', text: NO_EVIDENCE_REPLY }],
    }))
    expect(prepared.reader).not.toHaveBeenCalled()
  })

  it('cancels configured RAG delivery when the durable decision is missing', async () => {
    const account = await createAccount()
    const admitted = await admit(account, 'missing-proof')
    const profileEnv = profileEnvFor(account)
    const reader = snapshotReader({ value: SOURCE_A })
    const replySend = vi.fn()
    const pushSend = vi.fn()
    await runLineConversationWorker(worker({
      env: { ...lineEnv, ...profileEnv },
      answer: vi.fn(async () => ({ text: ANSWER })),
      replyTransport: { send: replySend },
      pushTransport: { send: pushSend },
      testRagOptions: { snapshotReader: reader },
    }))
    expect(await prisma.lineConversationJob.findUnique({ where: { id: admitted.jobId } })).toMatchObject({
      status: 'CANCELLED', answerText: null, sealedReplyToken: null,
      errorCode: 'MAIN_DEV_TEST_RAG_AUTHORITY_REVOKED',
    })
    expect(replySend).not.toHaveBeenCalled()
    expect(pushSend).not.toHaveBeenCalled()
  })

  it.each([
    ['current source snapshot changed', async prepared => { prepared.sourceState.value = SOURCE_B }],
    ['private manifest profile changed', async prepared => {
      prepared.profileEnv.ZURI_MAIN_DEV_LOCAL_OLLAMA_RAG_MANIFEST_SHA256 = 'e'.repeat(64)
    }],
    ['persisted account grounding policy changed', async prepared => {
      await prisma.lineOaAccount.update({ where: { id: prepared.account.id }, data: { knowledgeGrounding: 'BUSINESS_KNOWLEDGE' } })
    }],
    ['inbound request changed', async prepared => {
      const job = await prisma.lineConversationJob.findUnique({ where: { id: prepared.admitted.jobId } })
      await prisma.message.update({ where: { id: job.inboundMessageId }, data: { body: 'a different request' } })
    }],
    ['prepared reply changed', async prepared => {
      await prisma.lineConversationJob.update({ where: { id: prepared.admitted.jobId }, data: { answerText: 'changed answer' } })
    }],
    ['execution identity changed', async prepared => {
      await prisma.lineConversationJob.update({ where: { id: prepared.admitted.jobId }, data: { executionId: randomUUID() } })
    }],
    ['durable proof malformed', async prepared => {
      const job = await prisma.lineConversationJob.findUnique({ where: { id: prepared.admitted.jobId } })
      await prisma.agentTraceEvent.update({ where: {
        tenantId_businessId_idempotencyKey: {
          tenantId: tenant.id, businessId: business.id,
          idempotencyKey: `${job.id}:line-test-rag:${job.executionId}`,
        },
      }, data: { payloadJson: '{malformed' } })
    }],
  ])('cancels before LINE send when %s', async (_label, tamper) => {
    const prepared = await prepareReadyJob({ label: `tamper-${_label.replaceAll(' ', '-')}` })
    await tamper(prepared)
    const sent = await sendReadyJob(prepared)
    expect(sent.pushSend).not.toHaveBeenCalled()
    expect(sent.replySend).not.toHaveBeenCalled()
    expect(sent.answer).not.toHaveBeenCalled()
    expect(await prisma.lineConversationJob.findUnique({ where: { id: prepared.admitted.jobId } })).toMatchObject({
      status: 'CANCELLED', answerText: null, sealedReplyToken: null,
      errorCode: 'MAIN_DEV_TEST_RAG_AUTHORITY_REVOKED',
    })
  })

  it('binds real ProductMaster bytes and sends durable fixed no-evidence after a real zero-hit query', async () => {
    const suffix = randomPart()
    const account = await createAccount()
    const viewer = makeViewer({
      visibleBusinessIds: [business.id],
      ownedBusinessIds: [business.id],
      visibleDomains: ['commerce', 'inventory', 'knowledge'],
    })
    const category = await createCategory({
      businessId: business.id, code: `line-rag-${suffix}`, nameTh: 'TEST ONLY', nameEn: 'Test only',
    }, { viewer, db })
    const master = await createProductMaster({
      businessId: business.id, code: `PM-RAG-${suffix}`, categoryId: category.id,
      nameTh: 'TEST ONLY product', nameEn: 'Test only product',
    }, { viewer, db })
    const product = await createProduct({
      businessId: business.id, productMasterId: master.id, code: `TEST-ONLY-${suffix}`,
      name: 'Test only product', unit: 'piece',
    }, { viewer, db })
    const publication = await createPublishedPriceCatalogFixture({
      business, product, viewer, quantity: 100, quantities: [100],
      publicationExternalId: `commerce-sku:${product.id}`, db, now: new Date(),
    })
    const manifest = await readAuthorizedKnowledgeManifest({ businessId: business.id, projectId: null }, {
      db, viewer, env: publication.env,
    })
    const productEntry = manifest.entries.find(entry => entry.title === `ProductMaster commerce-sku:${product.id}`)
    expect(productEntry, `Published manifest titles: ${manifest.entries.map(entry => entry.title).join(', ')}`).toBeDefined()
    expect(productEntry.sourceVersion).toBe(publication.fileAsset.sha256)

    const env = {
      ...publication.env,
      ...profileEnvFor(account),
      ZURI_MAIN_DEV_LOCAL_OLLAMA_RAG_MANIFEST_SHA256: manifest.manifestHash,
      ZURI_MAIN_DEV_LOCAL_OLLAMA_RAG_PRODUCTS: JSON.stringify([{
        productId: product.id,
        sku: product.code,
        sourceId: productEntry.sourceId,
        ingestionId: productEntry.ingestionId,
        fileSha256: publication.fileAsset.sha256,
      }]),
    }
    const profile = readMainDevLocalOllamaProfile(env)
    const fileContentResolver = vi.fn(async (fileAssetId, { db: scopedDb }) => {
      const asset = await scopedDb.fileAsset.findUnique({ where: { id: fileAssetId } })
      const content = publication.blobs.get(asset.blobRef)
      if (!content) throw new Error('PUBLISHED_TEST_BLOB_MISSING')
      return { asset, content: Buffer.from(content) }
    })
    const queryCorpus = vi.fn(async (_request, options) => {
      expect(options.sourceIds).toEqual([productEntry.sourceId])
      return {
        manifestHash: manifest.manifestHash,
        corpusGeneration: manifest.corpusGeneration,
        results: [{
          sourceId: productEntry.sourceId,
          ingestionId: productEntry.ingestionId,
          snapshotId: productEntry.snapshotId,
          generation: productEntry.generation,
          citationId: `controlled-query-${suffix}`,
        }],
      }
    })
    const reader = createMainDevTestRagKnowledgeReader({
      profile, tenantId: tenant.id, businessId: business.id, accountId: account.id,
      db, env, fileContentResolver, queryCorpus,
    })

    const actualBytes = publication.blobs.get(publication.fileAsset.blobRef)
    expect(actualBytes).toBeInstanceOf(Buffer)
    expect(createHash('sha256').update(actualBytes).digest('hex')).toBe(publication.fileAsset.sha256)
    expect(actualBytes.toString('utf8')).toContain(product.code)
    const result = await reader.query({
      tenantId: tenant.id, businessId: business.id, queryId: 'product_detail',
      params: { productCode: product.code },
    })
    expect(result).toMatchObject({
      records: [{ product_code: product.code, unit: product.unit,
        name: product.name, sell_price: null, currency: null, moq: null,
        specification: {}, citationId: `controlled-query-${suffix}` }],
      meta: { source: 'GKS_CORPUS', mode: 'GKS_CORPUS', reason: null },
    })
    expect(JSON.stringify(result)).not.toMatch(/costSatang|rulesHash|margin|receiptHash|sellPrice/i)
    expect(fileContentResolver).toHaveBeenCalled()
    expect(queryCorpus).toHaveBeenCalledTimes(1)
    expect(reader.getBinding()).toMatchObject({ denied: false, profileSha256: expect.any(String), sourceSha256: expect.any(String) })

    // This is a genuine empty result from the otherwise-valid published source.
    // ServerLineAnswer must choose its fixed reply, durably bind the denied
    // source decision, and avoid invoking the provider.
    const zeroQueryCorpus = vi.fn(async () => ({
      manifestHash: manifest.manifestHash,
      corpusGeneration: manifest.corpusGeneration,
      results: [],
    }))
    const zeroReader = createMainDevTestRagKnowledgeReader({
      profile, tenantId: tenant.id, businessId: business.id, accountId: account.id,
      db, env, fileContentResolver, queryCorpus: zeroQueryCorpus,
    })
    const modelGenerate = vi.fn(async () => { throw new Error('NO_EVIDENCE_MUST_NOT_CALL_MODEL') })
    const resolveModel = vi.fn(async () => ({ provider: 'ollama', model: 'mellum:latest', generate: modelGenerate }))
    const runtimeFactory = vi.fn(async () => ({
      businessKnowledge: zeroReader,
      resolveModel,
      getKnowledgeBinding: () => zeroReader.getBinding(),
      revalidateKnowledge: () => zeroReader.revalidate(),
    }))
    const zeroAccountJob = await admit(account, 'real-zero-hit')
    const noEvidenceSnapshot = vi.fn(async () => { throw new Error('DENIED_ZERO_HIT_MUST_NOT_REVALIDATE_AT_SEND') })
    const noEvidenceReply = vi.fn(async () => ({ status: 'ACCEPTED_BY_LINE', requestId: 'zero-hit-reply' }))
    const noEvidenceAnswer = createServerLineAnswer({ env, runtimeFactory })
    const noEvidenceResult = await runLineConversationWorker(worker({
      env: { ...lineEnv, ...env },
      answer: noEvidenceAnswer,
      replyTransport: { send: noEvidenceReply },
      testRagOptions: { snapshotReader: noEvidenceSnapshot },
    }))
    expect(noEvidenceResult).toMatchObject({ id: zeroAccountJob.jobId, status: 'RECORDED', acceptance: 'ACCEPTED_BY_LINE' })
    expect(zeroQueryCorpus).toHaveBeenCalledTimes(1)
    expect(modelGenerate).not.toHaveBeenCalled()
    expect(noEvidenceReply).toHaveBeenCalledWith(expect.objectContaining({
      messages: [{ type: 'text', text: NO_EVIDENCE_REPLY }],
    }))
    expect(noEvidenceSnapshot).not.toHaveBeenCalled()
    const zeroJob = await prisma.lineConversationJob.findUnique({ where: { id: zeroAccountJob.jobId } })
    expect(zeroJob).toMatchObject({ status: 'RECORDED', answerText: NO_EVIDENCE_REPLY })
    const zeroDecision = await prisma.agentTraceEvent.findUnique({ where: {
      tenantId_businessId_idempotencyKey: {
        tenantId: tenant.id,
        businessId: business.id,
        idempotencyKey: `${zeroJob.id}:line-test-rag:${zeroJob.executionId}`,
      },
    } })
    const zeroPayload = JSON.parse(zeroDecision.payloadJson)
    expect(zeroPayload).toMatchObject({
      tool: 'LINE_TEST_ONLY_RAG', decision: 'READ',
      binding: { denied: true, sourceSha256: null },
      requestSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      replySha256: sha256(NO_EVIDENCE_REPLY),
    })
    expect(zeroDecision.payloadJson).not.toContain(NO_EVIDENCE_REPLY)

    await prisma.product.update({ where: { id: product.id }, data: { name: 'Changed after publication' } })
    await expect(reader.revalidate()).rejects.toMatchObject({ code: 'MAIN_DEV_TEST_RAG_UNAVAILABLE' })
    await prisma.product.update({ where: { id: product.id }, data: { name: product.name } })

    const source = await db.knowledgeSource.findUnique({ where: { id: productEntry.sourceId } })
    await withdrawKnowledgeSource(source.id, { expectedVersion: source.version }, { db, viewer, env: publication.env })
    const currentManifest = await readAuthorizedKnowledgeManifest({ businessId: business.id, projectId: null }, {
      db, viewer, env: publication.env,
    })
    expect(currentManifest.entries.some(entry => entry.sourceId === productEntry.sourceId)).toBe(false)
    await expect(reader.revalidate()).rejects.toMatchObject({ code: 'MAIN_DEV_TEST_RAG_UNAVAILABLE' })
    expect(queryCorpus).toHaveBeenCalledTimes(1)
  }, 120_000)

  it('preserves existing non-RAG LINE delivery without a proof row', async () => {
    const account = await createAccount({ rag: false, allowDelayedPush: false })
    const admitted = await admit(account, 'ordinary-non-rag')
    const snapshot = vi.fn(async () => { throw new Error('NON_RAG_MUST_NOT_READ_TEST_RAG_SOURCE') })
    const answer = vi.fn(async () => ({ text: 'ordinary existing LINE answer' }))
    const replySend = vi.fn(async () => ({ status: 'ACCEPTED_BY_LINE', requestId: 'ordinary-line-reply' }))
    const result = await runLineConversationWorker(worker({
      answer,
      replyTransport: { send: replySend },
      testRagOptions: { snapshotReader: snapshot },
    }))
    expect(result).toMatchObject({ id: admitted.jobId, status: 'RECORDED', acceptance: 'ACCEPTED_BY_LINE' })
    expect(answer).toHaveBeenCalledTimes(1)
    expect(replySend).toHaveBeenCalledTimes(1)
    expect(snapshot).not.toHaveBeenCalled()
    expect(await prisma.agentTraceEvent.count({ where: { turnId: admitted.jobId, kind: 'TOOL_RESULT' } })).toBe(0)
  })
})
