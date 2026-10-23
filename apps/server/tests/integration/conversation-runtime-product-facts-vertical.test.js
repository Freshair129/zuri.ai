import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { naturalProductFactsFixture } from '../factories/natural-product-facts'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { createLineOaEvidenceRecorder } from '@/platform/integrations/providers/line/line-oa-evidence'
import { admitCapturedLineEvents } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { createCategory, createProduct, createProductMaster } from '@/modules/inventory/application/inventory-catalog-service'
import { setLineStockDisclosurePolicy } from '@/modules/inventory/application/line-stock-disclosure-policy-service'
import { recordMovement } from '@/modules/inventory/application/inventory-stock-service'
import { resolveLineIdentity } from '@/modules/identity/resolve-line-identity'
import { activateChannelIdentity as verifyChannelIdentity } from '@/modules/identity/channel-identity'
import { runLineConversationWorker } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { createConversationRuntimeCore } from '@/modules/line-oa-studio/application/conversation-runtime-core'
import { createConversationRuntimeV2RouteHandlers } from '@/app/api/internal/conversation-runtime/v2/[operation]/route'
import { withLineProductFactsCommand } from '@/modules/agent/line-product-facts-command'
import { createProductionCoreClient } from '../../../../services/conversation-runtime/src/core-client.js'
import { createCorePorts } from '../../../../services/conversation-runtime/src/core-ports.js'
import { createConversationRuntime } from '../../../../services/conversation-runtime/src/turn-runtime.js'
import { createPublishedPriceCatalogFixture } from '../factories/published-price-catalog'
import { readLineProductFactsDecision } from '@/modules/line-oa-studio/application/line-product-facts-decision'

// @req FR-291 — prove the default deterministic resolver and final send recheck
//   with real signed LINE evidence, explicit stock disclosure, and an accepted
//   receipt-backed FR-253 price publication in both execution-owner cohorts.
// @spec ADR-106, SDD-110, FR-253 — only object storage and the LINE provider are
//   test-controlled; identity, facts, publication, decision journal and send gate are real.
// @tested tests/integration/conversation-runtime-product-facts-vertical.test.js

const sealKey = '6f'.repeat(32)
const coreToken = 'real-product-facts-core-token-00000000001'
const providerNow = new Date()
const factsText = (product, amount) => {
  const whole = Math.floor(amount / 100).toLocaleString('en-US')
  const fraction = String(amount % 100).padStart(2, '0')
  return `LINE product facts (${product.code})\nหน่วยฐาน: piece\nสถานะสต็อก: มี ATP มากกว่าศูนย์ (เป็นสถานะจาก ATP ไม่ใช่การรับประกันว่าจะจัดส่งได้)\nราคาขายที่เผยแพร่สำหรับ 100 piece: ฿${whole}.${fraction} ต่อ piece\nภาษี: ไม่ทราบว่าราคานี้รวมภาษีหรือไม่`
}

let portfolio, tenant, business, viewer, product, priceFixture, lineProvider
let nextId = 0
const lineAccounts = []
const jobIds = []

async function createLineAccount(runtimeOwner, label, { memoryPolicy = 'OFF' } = {}) {
  const suffix = `${Date.now()}-${++nextId}`
  const destination = `line-product-facts-vertical-${suffix}`
  const connection = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id, providerId: lineProvider.id,
    name: `LINE product facts ${label}`, externalAccountId: destination, status: 'ACTIVE' })
  const account = await prisma.lineOaAccount.create({ data: { tenantId: tenant.id, businessId: business.id,
    integrationConnectionId: connection.id, code: `LPFV-${suffix}`, bindingCode: `LPFV-BIND-${suffix}`,
    displayName: `LINE product facts ${label}`, status: 'CONNECTED', serverEnabled: true, transportMode: 'CLOUD', runtimeOwner,
    memoryPolicy } })
  const lineUserId = `U-LPFV-${suffix}`
  const identity = await resolveLineIdentity({ tenantId: tenant.id, lineUserId, channelAccountId: account.bindingCode })
  await verifyChannelIdentity({ tenantId: tenant.id, personId: identity.personId, channelAccountId: account.bindingCode,
    providerSubject: lineUserId, now: providerNow })
  const policy = await setLineStockDisclosurePolicy({ businessId: business.id, lineOaAccountId: account.id,
    productId: product.id, enabled: true, expectedVersion: 0, reason: 'Vertical test explicit stock disclosure' },
  { viewer, db: prisma, now: providerNow })
  const result = { account, destination, lineUserId, policy }
  lineAccounts.push(result)
  return result
}

async function admitProductQuestion(scope, eventSuffix, { natural = false } = {}) {
  const eventId = `line-product-facts-vertical-${eventSuffix}-${++nextId}`
  const text = natural ? `${product.code} มีของไหม และราคา 100 ${product.unit} เท่าไร`
    : `#product ${JSON.stringify({ sku: product.code, facets: ['availability', 'price'], quantity: 100, unit: product.unit })}`
  const event = { type: 'message', webhookEventId: eventId, replyToken: `reply-${eventId}`, timestamp: providerNow.getTime(),
    source: { type: 'user', userId: scope.lineUserId },
    message: { type: 'text', id: `message-${eventId}`, text } }
  const body = { destination: scope.destination, events: [event] }
  const recorder = await createLineOaEvidenceRecorder({ db: prisma, tenantId: business.tenantId,
    businessId: business.id, destination: scope.destination })
  const evidence = await recorder.record({ body, event }, { now: () => providerNow })
  const outcome = await admitCapturedLineEvents({
    account: await prisma.lineOaAccount.findUnique({ where: { id: scope.account.id } }),
    entries: [{ event, rawRecordId: evidence.rawRecordId }], correlationId: eventId,
    db: prisma, env: { ZURI_LINE_REPLY_SEAL_KEY: sealKey }, delays: [], nudge: () => {},
  })
  expect(outcome).toEqual({ admitted: 1, skipped: 0, failed: 0 })
  const job = await prisma.lineConversationJob.findUnique({ where: { accountId_eventId: {
    accountId: scope.account.id, eventId,
  } }, include: { inbound: { include: { conversation: { include: { customer: true } } } } } })
  expect(job).toMatchObject({ tenantId: business.tenantId, businessId: business.id, runtimeOwner: scope.account.runtimeOwner,
    status: 'QUEUED', audienceKind: 'DIRECT', sourceUserId: scope.lineUserId, recipientId: scope.lineUserId })
  jobIds.push(job.id)
  return job
}

function lineTransport(sink) {
  return {
    resolveAccount: async id => prisma.lineOaAccount.findUnique({ where: { id } }),
    replyTransport: { send: async ({ messages }) => {
      sink.push({ method: 'REPLY', messages })
      return { status: 'ACCEPTED_BY_LINE', requestId: `product-facts-reply-${sink.length}` }
    } },
    pushTransport: { send: async ({ messages, retryKey }) => {
      sink.push({ method: 'PUSH', messages, retryKey })
      return { status: 'ACCEPTED_BY_LINE', requestId: `product-facts-push-${sink.length}` }
    } },
  }
}

function inProcessFetch(handlers, beforeOperation = async () => {}) {
  return async (url, init = {}) => {
    const target = new URL(url)
    const operation = target.pathname.split('/').pop()
    const request = new Request(target, init)
    if (!init.body) return handlers.GET(request, { params: { operation } })
    const envelope = JSON.parse(init.body)
    await beforeOperation(envelope.operation, envelope.payload)
    return handlers.POST(request, { params: { operation } })
  }
}

function runtimeFor(sink, { beforeOperation, env = {}, db = prisma } = {}) {
  const core = createConversationRuntimeCore({ db,
    env: { CONVERSATION_RUNTIME_TOKEN: coreToken, ZURI_LINE_REPLY_SEAL_KEY: sealKey, ...env },
    productFactsOptions: { knowledgeReaderFactory: priceFixture.knowledgeReaderFactory },
    linePorts: () => lineTransport(sink),
  })
  const client = createProductionCoreClient({ baseUrl: 'http://core-product-facts.invalid', token: coreToken,
    fetchFn: inProcessFetch(createConversationRuntimeV2RouteHandlers(core), beforeOperation) })
  const ports = createCorePorts({ client,
    model: { generate: async () => { throw new Error('PRODUCT_FACTS_MUST_NOT_CALL_MODEL') } },
  })
  return { runtime: claimantId => createConversationRuntime({ ports, claimantId }), client }
}

beforeAll(async () => {
  const suffix = Date.now()
  const portfolioRow = await createPortfolio({ code: `PF-LPFV-${suffix}`, name: 'LINE product facts vertical' })
  portfolio = portfolioRow
  tenant = await createTenant({ portfolioId: portfolio.id, code: `TNT-LPFV-${suffix}`, name: 'LINE product facts vertical' })
  business = await createBusiness({ tenantId: tenant.id, code: `BUS-LPFV-${suffix}`, name: 'LINE product facts vertical' })
  viewer = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id],
    visibleDomains: ['inventory', 'commerce', 'knowledge'] })
  lineProvider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
  const category = await createCategory({ businessId: business.id, code: `lpfv-${suffix}`, nameTh: 'สินค้า', nameEn: 'Products' }, { viewer })
  const master = await createProductMaster({ businessId: business.id, code: `LPFV-M-${suffix}`, categoryId: category.id,
    nameTh: 'สินค้าทดสอบ', nameEn: 'Test product' }, { viewer })
  product = await createProduct({ businessId: business.id, productMasterId: master.id,
    code: `TEST-ONLY-LPFV-${suffix}`, name: 'LINE product facts', unit: 'piece', stockPolicy: 'TRACKED', trackingMode: 'NONE' }, { viewer })
  await recordMovement({ businessId: business.id, productId: product.id, kind: 'RECEIPT', quantity: 1000,
    costSatang: 10000, occurredAt: providerNow }, { viewer, now: providerNow })
  priceFixture = await createPublishedPriceCatalogFixture({ business, product, viewer, quantity: 100,
    quantities: [100], db: prisma, now: providerNow })
  await createLineAccount('SERVER', 'server positive')
  await createLineAccount('CONVERSATION_RUNTIME', 'runtime positive')
  await createLineAccount('CONVERSATION_RUNTIME', 'runtime revoked')
  await createLineAccount('CONVERSATION_RUNTIME', 'runtime opted-in', { memoryPolicy: 'ON' })
}, 120_000)

afterEach(async () => {
  vi.unstubAllEnvs()
  if (jobIds.length) await prisma.lineConversationJob.updateMany({ where: { id: { in: [...jobIds] },
    status: { in: ['QUEUED', 'CLAIMED', 'READY', 'SENDING'] } },
  data: { status: 'CANCELLED', answerText: null, sealedReplyToken: null, claimantId: null, leaseExpiresAt: null,
    errorCode: 'TEST_PRODUCT_FACTS_VERTICAL_DONE', version: { increment: 1 } } })
  jobIds.splice(0)
})

afterAll(async () => {
  if (business && priceFixture?.ingestionId) {
    await prisma.knowledgeIngestion.updateMany({ where: { id: priceFixture.ingestionId, status: { in: ['QUEUED', 'RUNNING'] } },
      data: { status: 'WITHDRAWN', failureCode: 'LINE_PRODUCT_FACTS_VERTICAL_CLEANUP' } })
    await prisma.knowledgeIngestion.deleteMany({ where: { id: priceFixture.ingestionId } })
  }
}, 60_000)

describe('FR-291 default product-facts vertical across both execution owners', () => {
  it.each([false, true])('renders live ATP and actual FR-253 publication through both cohorts without a model (natural=%s)', async natural => {
    let db = prisma
    if (natural) {
      const pilot = await naturalProductFactsFixture({ db: prisma, business, accounts: lineAccounts.map(scope => scope.account), product })
      for (const [key, value] of Object.entries(pilot.env)) vi.stubEnv(key, value)
      db = pilot.db
    }
    const expected = factsText(product, priceFixture.expectedUnitAmountMinor)
    const serverScope = lineAccounts[0]
    const serverJob = await admitProductQuestion(serverScope, 'server', { natural })
    let fallbackCalls = 0
    const answer = withLineProductFactsCommand(async () => {
      fallbackCalls += 1
      throw new Error('PRODUCT_FACTS_MUST_NOT_FALL_THROUGH_TO_SERVER_ANSWER')
    }, { db, productFactsOptions: { knowledgeReaderFactory: priceFixture.knowledgeReaderFactory } })
    const serverSink = []
    const serverOutcome = await runLineConversationWorker({ db,
      env: { ZURI_LINE_REPLY_SEAL_KEY: sealKey }, workerId: `line-product-facts-vertical-server-${nextId}`,
      answer, productFactsOptions: { knowledgeReaderFactory: priceFixture.knowledgeReaderFactory },
      ...lineTransport(serverSink) })
    const serverAfter = await prisma.lineConversationJob.findUnique({ where: { id: serverJob.id } })
    expect({ outcome: serverOutcome, job: serverAfter }).toMatchObject({
      outcome: { id: serverJob.id, status: 'RECORDED' }, job: { status: 'RECORDED', errorCode: null, answerText: expected },
    })
    expect(serverSink).toEqual([{ method: 'REPLY', messages: [{ type: 'text', text: expected }] }])
    expect(fallbackCalls).toBe(0)
    expect((await readLineProductFactsDecision(prisma, serverAfter)).binding).toMatchObject({
      jobId: serverJob.id, executionId: serverAfter.executionId,
      schema: 'zuri.line-product-facts.binding.v1', stockPolicyVersion: 1,
      publicationDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    })

    const runtimeJob = await admitProductQuestion(lineAccounts[1], 'runtime', { natural })
    const runtimeSink = []
    const { runtime, client } = runtimeFor(runtimeSink, { db })
    expect(client.contractVersion).toBe('conversation-runtime.v2')
    const runtimeOutcome = await runtime(`line-product-facts-vertical-runtime-${nextId}`).runOne()
    expect(runtimeOutcome).toMatchObject({ jobId: runtimeJob.id, status: 'RECORDED' })
    expect(runtimeSink).toEqual(serverSink)
    expect(fallbackCalls).toBe(0)
  }, 120_000)

  it('suppresses a prepared natural reply when the profile is disabled before Runtime send', async () => {
    const pilot = await naturalProductFactsFixture({ db: prisma, business, accounts: lineAccounts.map(scope => scope.account), product })
    for (const [key, value] of Object.entries(pilot.env)) vi.stubEnv(key, value)
    const job = await admitProductQuestion(lineAccounts[1], 'natural-disabled', { natural: true })
    const sink = []
    let disabled = false
    const { runtime } = runtimeFor(sink, { db: pilot.db, beforeOperation: async operation => {
      if (operation === 'send') { vi.stubEnv('ZURI_LINE_NATURAL_PRODUCT_FACTS_ENABLED', 'false'); disabled = true }
    } })
    const result = await runtime(`line-natural-profile-revoked-${nextId}`).runOne()
    expect(disabled).toBe(true)
    expect(result).toMatchObject({ jobId: job.id, status: 'CANCELLED' })
    expect(sink).toEqual([])
  }, 120_000)

  it('uses the actual owner policy again inside the shared send gate and stops a revoked Runtime reply', async () => {
    const scope = lineAccounts[2]
    const job = await admitProductQuestion(scope, 'revoked')
    const sink = []
    let revoked = false
    const { runtime } = runtimeFor(sink, { beforeOperation: async operation => {
      if (operation !== 'send' || revoked) return
      revoked = true
      await setLineStockDisclosurePolicy({ businessId: business.id, lineOaAccountId: scope.account.id,
        productId: product.id, enabled: false, expectedVersion: scope.policy.version,
        reason: 'Revoke before the final send fence' }, { viewer, db: prisma, now: providerNow })
    } })
    const outcome = await runtime(`line-product-facts-vertical-revoked-${nextId}`).runOne()
    expect(revoked).toBe(true)
    expect(outcome).toMatchObject({ jobId: job.id, status: 'CANCELLED' })
    expect(sink).toEqual([])
    expect(await prisma.lineConversationJob.findUnique({ where: { id: job.id } }))
      .toMatchObject({ status: 'CANCELLED', answerText: null, errorCode: 'LINE_PRODUCT_FACTS_AUTHORITY_REVOKED' })
  }, 120_000)

  it('completes an opted-in product-facts turn with MSP enabled without reading or appending thread memory', async () => {
    const job = await admitProductQuestion(lineAccounts[3], 'runtime-opted-in')
    expect(job.memorySyncOptIn).toBe(true)
    const sink = []
    const operations = []
    const { runtime } = runtimeFor(sink, { env: { ZURI_MSP_THREAD_MEMORY_ENABLED: 'true' },
      beforeOperation: async operation => { operations.push(operation) } })
    const outcome = await runtime(`line-product-facts-vertical-opted-in-${nextId}`).runOne()

    expect(outcome).toMatchObject({ jobId: job.id, status: 'RECORDED' })
    expect(sink).toEqual([{ method: 'REPLY', messages: [{ type: 'text', text: factsText(product, priceFixture.expectedUnitAmountMinor) }] }])
    expect(operations).not.toContain('memory')
    expect(await prisma.agentTraceEvent.findMany({ where: { turnId: job.id,
      kind: { in: ['MEMORY_THREAD_READ', 'MEMORY_THREAD_APPENDED'] } } })).toEqual([])
  }, 120_000)
})
