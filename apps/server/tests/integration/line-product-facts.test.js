import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { createLineOaEvidenceRecorder } from '@/platform/integrations/providers/line/line-oa-evidence'
import { admitCapturedLineEvents } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { resolveLineIdentity } from '@/modules/identity/resolve-line-identity'
import { activateChannelIdentity, revokeChannelIdentity } from '@/modules/identity/channel-identity'
import { createCategory, createProduct, createProductMaster } from '@/modules/inventory/application/inventory-catalog-service'
import { recordMovement } from '@/modules/inventory/application/inventory-stock-service'
import { createReservation } from '@/modules/inventory/application/inventory-atp-service'
import { setLineStockDisclosurePolicy } from '@/modules/inventory/application/line-stock-disclosure-policy-service'
import { readLineStockProjection } from '@/modules/inventory/application/line-stock-projection'
import { resolveLineProductFacts, revalidateLineProductFacts } from '@/modules/agent/line-product-facts'

// @req FR-291 — the dedicated customer reader uses admitted LINE source,
//   exact Business identity and explicit stock disclosure while returning no count.
// @spec FR-180, FR-097 — use the real ATP ledger and verified ChannelIdentity.
// @tested tests/integration/line-product-facts.test.js

const key = '5d'.repeat(32)
const DESTINATION = `line-facts-${Date.now()}`
const USER = `U-line-facts-${Date.now()}`
const sourceNow = new Date('2026-10-23T06:00:00.000Z')

let business, account, owner, product, channelIdentityId, category
let nextEvent = 0
const fixtureJobIds = []

async function admitProductQuestion(text, userId = USER) {
  const eventId = `line-product-facts-${Date.now()}-${++nextEvent}`
  const event = {
    type: 'message', webhookEventId: eventId, timestamp: sourceNow.getTime(), replyToken: `reply-${eventId}`,
    source: { type: 'user', userId },
    message: { id: `message-${eventId}`, type: 'text', text },
  }
  const body = { destination: DESTINATION, events: [event] }
  const recorder = await createLineOaEvidenceRecorder({ db: prisma, tenantId: business.tenantId,
    businessId: business.id, destination: DESTINATION })
  expect(recorder).toBeTruthy()
  const evidence = await recorder.record({ body, event }, { now: () => sourceNow })
  const outcome = await admitCapturedLineEvents({
    account: await prisma.lineOaAccount.findUnique({ where: { id: account.id } }),
    entries: [{ event, rawRecordId: evidence.rawRecordId }], correlationId: eventId,
    db: prisma, env: { ZURI_LINE_REPLY_SEAL_KEY: key }, delays: [], nudge: () => {},
  })
  expect(outcome).toEqual({ admitted: 1, skipped: 0, failed: 0 })
  const admitted = await prisma.lineConversationJob.findUnique({ where: { accountId_eventId: {
    accountId: account.id, eventId,
  } } })
  fixtureJobIds.push(admitted.id)
  expect(admitted).toMatchObject({ tenantId: business.tenantId, businessId: business.id, status: 'QUEUED' })
  const executionId = `line-facts-execution-${eventId}`
  await prisma.lineConversationJob.update({ where: { id: admitted.id }, data: {
    status: 'CLAIMED', executionId, claimantId: 'owner-reader-integration-test',
    leaseExpiresAt: new Date(sourceNow.getTime() + 60_000),
  } })
  return prisma.lineConversationJob.findUnique({ where: { id: admitted.id }, include: {
    inbound: { include: { conversation: { include: { customer: true } } } },
  } })
}

afterEach(async () => {
  if (fixtureJobIds.length) await prisma.lineConversationJob.updateMany({
    where: { id: { in: fixtureJobIds }, status: { in: ['QUEUED', 'CLAIMED', 'READY'] } },
    data: { status: 'CANCELLED', errorCode: 'TEST_LINE_PRODUCT_FACTS_DONE', claimantId: null, leaseExpiresAt: null,
      sealedReplyToken: null, answerText: null, version: { increment: 1 } },
  })
  fixtureJobIds.length = 0
})

async function setPolicy(enabled, expectedVersion, reason) {
  return setLineStockDisclosurePolicy({ businessId: business.id, lineOaAccountId: account.id,
    productId: product.id, enabled, expectedVersion, reason }, { viewer: owner, now: sourceNow })
}

function forbidStockPolicyReads(db) {
  return new Proxy(db, {
    get(target, property) {
      const value = Reflect.get(target, property, target)
      if (property === 'lineStockDisclosurePolicy') return new Proxy(value, {
        get(delegate, operation) {
          if (operation === 'findUnique') return () => { throw new Error('price-only must not consult stock policy') }
          const method = Reflect.get(delegate, operation, delegate)
          return typeof method === 'function' ? method.bind(delegate) : method
        },
      })
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

beforeAll(async () => {
  const tag = Date.now()
  const portfolio = await createPortfolio({ code: `PF-LPF-${tag}`, name: 'LINE product facts' })
  const tenant = await createTenant({ portfolioId: portfolio.id, code: `TNT-LPF-${tag}`, name: 'LINE product facts' })
  business = await createBusiness({ tenantId: tenant.id, code: `BUS-LPF-${tag}`, name: 'LINE product facts' })
  owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: ['inventory'] })
  const provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
  const connection = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id, providerId: provider.id,
    name: 'LINE product-facts source', externalAccountId: DESTINATION, status: 'ACTIVE' })
  account = await prisma.lineOaAccount.create({ data: { tenantId: tenant.id, businessId: business.id,
    integrationConnectionId: connection.id, code: `LINE-LPF-${tag}`, bindingCode: `LINE-LPF-${tag}`,
    displayName: 'LINE product-facts source', status: 'CONNECTED', serverEnabled: true, transportMode: 'CLOUD' } })
  category = await createCategory({ businessId: business.id, code: `lpf-${tag}`, nameTh: 'สินค้า', nameEn: 'Products' }, { viewer: owner })
  const master = await createProductMaster({ businessId: business.id, code: `LPF-M-${tag}`, categoryId: category.id,
    nameTh: 'สินค้าทดสอบ', nameEn: 'Test product' }, { viewer: owner })
  product = await createProduct({ businessId: business.id, productMasterId: master.id,
    code: `LPF-SKU-${tag}`, name: 'สินค้าอ่านอย่างปลอดภัย', unit: 'piece', stockPolicy: 'TRACKED', trackingMode: 'NONE' }, { viewer: owner })
  const identity = await resolveLineIdentity({ tenantId: tenant.id, lineUserId: USER, channelAccountId: account.bindingCode })
  const verified = await activateChannelIdentity({ tenantId: tenant.id, personId: identity.personId,
    channelAccountId: account.bindingCode, providerSubject: USER, now: sourceNow })
  channelIdentityId = verified.id
})

describe('LINE product facts owner reader', () => {
  it('keeps stock disclosure default-off and binds a valid reader decision to current admission evidence', async () => {
    await recordMovement({ businessId: business.id, productId: product.id, kind: 'RECEIPT', quantity: 8, occurredAt: sourceNow }, { viewer: owner })
    const question = await admitProductQuestion(`#product {"sku":"${product.code}","facets":["availability"]}`)
    const stockReaderWhileOff = vi.fn(async () => { throw new Error('default-off must not read stock') })
    const off = await resolveLineProductFacts(question, { db: prisma, now: sourceNow, stockReader: stockReaderWhileOff })
    expect(off.text).toBe('ขออภัย ขณะนี้ยังไม่สามารถยืนยันข้อมูลสินค้าที่ร้องขอได้')
    expect(off.text).not.toContain(product.code)
    expect(stockReaderWhileOff).not.toHaveBeenCalled()
    expect(off.binding).toMatchObject({ schema: 'zuri.line-product-facts.binding.v1', jobId: question.id,
      executionId: question.executionId, stockPolicyVersion: null, stockObservationDigest: null })
    expect(await prisma.lineStockDisclosurePolicy.findUnique({ where: { tenantId_businessId_lineOaAccountId_productId: {
      tenantId: business.tenantId, businessId: business.id, lineOaAccountId: account.id, productId: product.id,
    } } })).toBeNull()

    const policy = await setPolicy(true, 0, 'Owner explicitly enabled stock availability disclosure')
    const authorizedQuestion = await admitProductQuestion(`#product {"sku":"${product.code}","facets":["availability"]}`)
    const positive = await resolveLineProductFacts(authorizedQuestion, { db: prisma, now: sourceNow })
    expect(positive.text).toContain('มี ATP มากกว่าศูนย์')
    expect(positive.text).not.toMatch(/\b(?:8|onHand|committed|reservedForQuotes|overcommitted|available)\b/i)
    expect(positive.binding).toMatchObject({ schema: 'zuri.line-product-facts.binding.v1', jobId: authorizedQuestion.id,
      executionId: authorizedQuestion.executionId, stockPolicyVersion: policy.version })
    expect(JSON.stringify(positive.binding)).not.toMatch(/onHand|committed|reservedForQuotes|overcommitted/i)

    // A send transaction already owns its transaction client. Revalidation must
    // reuse it, not nest `$transaction`, and allow the identical semantic result.
    const acceptedInsideSendFence = await prisma.$transaction(async tx => {
      await tx.lineConversationJob.update({ where: { id: authorizedQuestion.id }, data: { status: 'READY' } })
      await tx.lineOaAccount.update({ where: { id: account.id }, data: { version: { increment: 1 } } })
      const readyQuestion = await tx.lineConversationJob.findUnique({ where: { id: authorizedQuestion.id }, include: {
        inbound: { include: { conversation: { include: { customer: true } } } },
      } })
      return revalidateLineProductFacts(readyQuestion, positive.binding, { db: tx, now: sourceNow })
    })
    expect(acceptedInsideSendFence).toBe(true)
    await prisma.lineConversationJob.update({ where: { id: authorizedQuestion.id }, data: { status: 'CLAIMED' } })

    await createReservation({ businessId: business.id, productId: product.id, quantity: 8,
      quoteReference: `LPF-${Date.now()}` }, { viewer: owner, now: sourceNow })
    const zeroQuestion = await admitProductQuestion(`#product {"sku":"${product.code}","facets":["availability"]}`)
    const zero = await resolveLineProductFacts(zeroQuestion, { db: prisma, now: sourceNow })
    expect(zero.text).toContain('ATP เป็นศูนย์')
    expect(zero.text).not.toMatch(/\b(?:8|onHand|committed|reservedForQuotes|overcommitted|available)\b/i)
    expect(await revalidateLineProductFacts(authorizedQuestion, positive.binding, { db: prisma, now: sourceNow })).toBe(false)
    expect(await revalidateLineProductFacts(zeroQuestion, zero.binding, { db: prisma, now: sourceNow })).toBe(true)
    const disabledPolicy = await setPolicy(false, policy.version, 'Owner withdrew LINE stock disclosure')
    expect(await revalidateLineProductFacts(zeroQuestion, zero.binding, { db: prisma, now: sourceNow })).toBe(false)
    expect(disabledPolicy).toMatchObject({ enabled: false, version: policy.version + 1 })
    expect(await prisma.message.findUnique({ where: { id: authorizedQuestion.inboundMessageId }, select: { authorChannelIdentityId: true } }))
      .toEqual({ authorChannelIdentityId: channelIdentityId })
  })

  it('does not consult stock policy, require verified identity or read stock for a price-only request', async () => {
    const unverifiedUser = `${USER}-pending`
    const priceQuestion = await admitProductQuestion(
      `#product {"sku":"${product.code}","facets":["price"],"quantity":3,"unit":"piece"}`, unverifiedUser,
    )
    const priceOnlyDb = forbidStockPolicyReads(prisma)
    const stockReader = vi.fn(async () => { throw new Error('price-only must not read stock') })
    const priceReader = vi.fn(async input => ({ state: 'PUBLISHED', unitAmountMinor: 1234, currency: 'THB',
      quantity: input.quantity, unit: input.unit, taxTreatment: 'UNKNOWN', observedFrom: sourceNow.toISOString(),
      observedTo: sourceNow.toISOString(), publicationDigest: 'a'.repeat(64) }))
    const result = await resolveLineProductFacts(priceQuestion, { db: priceOnlyDb, now: sourceNow,
      stockReader, priceReader, knowledgeReaderFactory: ({ tenantId, businessId }) => ({ scope: { tenantId, businessId } }) })
    expect(result.text).toContain('฿12.34')
    expect(result.text).toContain('ภาษี: ไม่ทราบ')
    expect(result.text).not.toContain('สถานะสต็อก')
    expect(result.binding).toMatchObject({ stockPolicyVersion: null, stockObservationDigest: null,
      publicationDigest: 'a'.repeat(64), productRefDigest: expect.stringMatching(/^[0-9a-f]{64}$/) })
    expect(stockReader).not.toHaveBeenCalled()
    expect(priceReader).toHaveBeenCalledWith(expect.objectContaining({ tenantId: business.tenantId,
      businessId: business.id, productId: product.id, quantity: 3, unit: 'piece' }), expect.objectContaining({
      db: priceOnlyDb, knowledgeReader: { scope: { tenantId: business.tenantId, businessId: business.id } },
    }))
  })

  it('keeps an authorized published price when the Inventory read fails and marks ATP unavailable', async () => {
    const currentPolicy = await prisma.lineStockDisclosurePolicy.findUnique({ where: { tenantId_businessId_lineOaAccountId_productId: {
      tenantId: business.tenantId, businessId: business.id, lineOaAccountId: account.id, productId: product.id,
    } } })
    if (!currentPolicy?.enabled) {
      await setPolicy(true, currentPolicy?.version ?? 0, 'Owner explicitly enabled stock availability disclosure')
    }
    const question = await admitProductQuestion(
      `#product {"sku":"${product.code}","facets":["availability","price"],"quantity":3,"unit":"piece"}`,
    )
    const stockReader = vi.fn(async () => { throw new Error('Inventory ledger read failed') })
    const priceReader = vi.fn(async input => ({ state: 'PUBLISHED', unitAmountMinor: 1234, currency: 'THB',
      quantity: input.quantity, unit: input.unit, taxTreatment: 'UNKNOWN', observedFrom: sourceNow.toISOString(),
      observedTo: sourceNow.toISOString(), publicationDigest: 'b'.repeat(64) }))
    const result = await resolveLineProductFacts(question, { db: prisma, now: sourceNow, stockReader, priceReader,
      knowledgeReaderFactory: ({ tenantId, businessId }) => ({ scope: { tenantId, businessId } }) })

    expect(result.text).toContain('฿12.34')
    expect(result.text).toContain('ไม่สามารถยืนยันสถานะ ATP ได้')
    expect(result.text).not.toContain('Inventory ledger read failed')
    expect(result.binding).toMatchObject({ publicationDigest: 'b'.repeat(64), stockObservationDigest: null })
    expect(stockReader).toHaveBeenCalledOnce()
    expect(priceReader).toHaveBeenCalledOnce()
  })

  it.each([
    ['price reader', 'priceReader'],
    ['Knowledge reader factory', 'knowledgeReaderFactory'],
  ])('keeps usable ATP when the %s fails', async (_label, failureSource) => {
    const currentPolicy = await prisma.lineStockDisclosurePolicy.findUnique({ where: { tenantId_businessId_lineOaAccountId_productId: {
      tenantId: business.tenantId, businessId: business.id, lineOaAccountId: account.id, productId: product.id,
    } } })
    if (!currentPolicy?.enabled) {
      await setPolicy(true, currentPolicy?.version ?? 0, 'Owner explicitly enabled stock availability disclosure')
    }
    const question = await admitProductQuestion(
      `#product {"sku":"${product.code}","facets":["availability","price"],"quantity":3,"unit":"piece"}`,
    )
    const stockReader = vi.fn(async () => ({ state: 'ATP_POSITIVE', basis: 'BUSINESS_ATP',
      observedFrom: sourceNow.toISOString(), observedTo: sourceNow.toISOString(), sourceDigest: 'c'.repeat(64) }))
    const priceReader = vi.fn(async input => {
      if (failureSource === 'priceReader') throw new Error('price source failed')
      return { state: 'PUBLISHED', unitAmountMinor: 1234, currency: 'THB', quantity: input.quantity,
        unit: input.unit, taxTreatment: 'UNKNOWN', observedFrom: sourceNow.toISOString(),
        observedTo: sourceNow.toISOString(), publicationDigest: 'd'.repeat(64) }
    })
    const knowledgeReaderFactory = vi.fn(() => {
      if (failureSource === 'knowledgeReaderFactory') throw new Error('Knowledge reader could not initialize')
      return { scope: { tenantId: business.tenantId, businessId: business.id } }
    })
    const result = await resolveLineProductFacts(question, { db: prisma, now: sourceNow, stockReader, priceReader, knowledgeReaderFactory })

    expect(result.text).toContain('มี ATP มากกว่าศูนย์')
    expect(result.text).toContain('ราคาขายที่เผยแพร่: ยังยืนยันไม่ได้')
    expect(result.text).not.toContain('price source failed')
    expect(result.text).not.toContain('Knowledge reader could not initialize')
    expect(result.binding).toMatchObject({ stockObservationDigest: 'c'.repeat(64), publicationDigest: null })
    expect(stockReader).toHaveBeenCalledOnce()
    expect(knowledgeReaderFactory).toHaveBeenCalledOnce()
    expect(priceReader).toHaveBeenCalledTimes(failureSource === 'priceReader' ? 1 : 0)
  })

  it('withholds availability for an unverified direct sender even when the Business grant is on', async () => {
    const currentPolicy = await prisma.lineStockDisclosurePolicy.findUnique({ where: { tenantId_businessId_lineOaAccountId_productId: {
      tenantId: business.tenantId, businessId: business.id, lineOaAccountId: account.id, productId: product.id,
    } } })
    await setPolicy(true, currentPolicy.version, 'Owner explicitly enabled stock availability disclosure')
    const pendingUser = `${USER}-unverified-stock`
    const pendingQuestion = await admitProductQuestion(`#product {"sku":"${product.code}","facets":["availability"]}`, pendingUser)
    const stockReader = vi.fn(async () => { throw new Error('unverified sender must not read stock') })
    const result = await resolveLineProductFacts(pendingQuestion, { db: prisma, now: sourceNow, stockReader })
    expect(result.text).toBe('ขออภัย ขณะนี้ยังไม่สามารถยืนยันข้อมูลสินค้าที่ร้องขอได้')
    expect(result.text).not.toContain(product.code)
    expect(stockReader).not.toHaveBeenCalled()
    expect(result.binding.stockPolicyVersion).toBeNull()
    expect(result.binding.stockObservationDigest).toBeNull()
  })

  it('revalidates identity revocation before the send boundary', async () => {
    const question = await admitProductQuestion(`#product {"sku":"${product.code}","facets":["availability"]}`)
    const before = await resolveLineProductFacts(question, { db: prisma, now: sourceNow })
    const sourceRecord = await prisma.rawExternalRecord.findFirst({ where: { connectionId: account.integrationConnectionId,
      provider: 'LINE_OA', entityType: 'LINE_MESSAGE', externalId: question.eventId } })
    await prisma.rawExternalRecord.update({ where: { id: sourceRecord.id }, data: { processingStatus: 'SKIPPED' } })
    expect(await revalidateLineProductFacts(question, before.binding, { db: prisma, now: sourceNow })).toBe(false)
    await prisma.rawExternalRecord.update({ where: { id: sourceRecord.id }, data: { processingStatus: 'ADMITTED' } })

    const customer = question.inbound.conversation.customer
    await prisma.customer.update({ where: { id: customer.id }, data: { businessId: null } })
    expect(await revalidateLineProductFacts(question, before.binding, { db: prisma, now: sourceNow })).toBe(false)
    await prisma.customer.update({ where: { id: customer.id }, data: { businessId: business.id } })
    const freshBinding = await resolveLineProductFacts(question, { db: prisma, now: sourceNow })

    await revokeChannelIdentity({ tenantId: business.tenantId, channelAccountId: account.bindingCode,
      providerSubject: USER, now: new Date(sourceNow.getTime() + 1) })
    expect(await revalidateLineProductFacts(question, freshBinding.binding, { db: prisma, now: sourceNow })).toBe(false)
  })

  it('reports service inventory as not measured rather than zero ATP', async () => {
    const tag = Date.now()
    const serviceMaster = await createProductMaster({ businessId: business.id, code: `LPF-SERVICE-M-${tag}`,
      categoryId: category.id, nameTh: 'บริการทดสอบ', nameEn: 'Test service', nature: 'SERVICE' }, { viewer: owner })
    const service = await createProduct({ businessId: business.id, productMasterId: serviceMaster.id,
      code: `LPF-SERVICE-${tag}`, name: 'บริการที่ไม่ติดตามสต็อก', unit: 'service' }, { viewer: owner })
    const projection = await readLineStockProjection({ tenantId: business.tenantId, businessId: business.id,
      productId: service.id, db: prisma, now: sourceNow })
    expect(projection).toMatchObject({ state: 'NOT_MEASURED', basis: null })
  })
})
