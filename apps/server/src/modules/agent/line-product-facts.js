import { z } from 'zod'
import prisma from '@/lib/db'
import { findChannelIdentity, channelIdentityIsVerified } from '@/modules/identity/channel-identity'
import { readLineStockProjection } from '@/modules/inventory/application/line-stock-projection'
import { createCorpusKnowledgeReader } from '@/modules/knowledge/corpus-knowledge-reader'
import { readPublishedExactPriceForLine } from '@/modules/commerce/application/line-published-price-reader'
import { hashPayload } from '@/platform/integrations/core/idempotency'
import { parseNaturalProductFacts } from './line-product-facts-language'
import { naturalProductFactsScope } from './line-product-facts-profile'

// @req FR-291 — one explicit, typed product-facts command enters the bounded
// owner readers; malformed commands are deterministic and cannot fall through.
// @tested tests/unit/line-product-facts.test.js, tests/integration/line-product-facts.test.js

const INVALID_COMMAND = Object.freeze({ code: 'INVALID_REQUEST' })
const BINDING_SCHEMA = 'zuri.line-product-facts.binding.v1'
const UNAVAILABLE_REPLY = 'ขออภัย ขณะนี้ยังไม่สามารถยืนยันข้อมูลสินค้าที่ร้องขอได้'
const INVALID_REPLY = 'รูปแบบคำสั่งสินค้าไม่ถูกต้อง กรุณาตรวจรหัสสินค้าและรูปแบบคำสั่ง'
const zRequest = z.object({
  sku: z.string().min(1).max(128).refine(value => value === value.trim()),
  facets: z.array(z.enum(['availability', 'price'])).min(1).max(2)
    .refine(values => new Set(values).size === values.length),
  quantity: z.number().int().positive().refine(Number.isSafeInteger).optional(),
  unit: z.string().min(1).max(128).refine(value => value === value.trim()).optional(),
}).strict().superRefine((value, context) => {
  const requestsPrice = value.facets.includes('price')
  if (requestsPrice && (value.quantity === undefined || value.unit === undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['quantity'], message: 'price requires quantity and unit' })
  }
  if (!requestsPrice && (value.quantity !== undefined || value.unit !== undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['quantity'], message: 'quantity and unit require price' })
  }
})

function isProductCommand(text) {
  if (typeof text !== 'string') return false
  const commandText = text.trimStart()
  return /^#product(?![\p{L}\p{N}_-])/u.test(commandText)
}

/** Typed command or bounded fact intent; only non-fact text may reach a model. */
export function parseLineProductFactsRequest(text) {
  if (!isProductCommand(text)) return parseNaturalProductFacts(text)
  const commandText = text.trimStart()
  const payload = commandText.slice('#product'.length).trim()
  if (!payload.startsWith('{')) return { request: null, clarification: INVALID_COMMAND }
  let value
  try { value = JSON.parse(payload) } catch { return { request: null, clarification: INVALID_COMMAND } }
  const parsed = zRequest.safeParse(value)
  if (!parsed.success) return { request: null, clarification: INVALID_COMMAND }
  return { request: parsed.data, clarification: null }
}

const digest = value => hashPayload(value)
const idText = value => typeof value === 'string' && value.trim() ? value.trim() : null

function jobKeys(job) {
  const jobId = idText(job?.id)
  const executionId = idText(job?.executionId)
  if (!jobId || !executionId) throw Object.assign(new Error('LINE_PRODUCT_FACTS_EXECUTION_REQUIRED'), { code: 'LINE_PRODUCT_FACTS_EXECUTION_REQUIRED', status: 409 })
  return { jobId, executionId }
}

function parseJson(value) {
  if (typeof value !== 'string') return null
  try { return JSON.parse(value) } catch { return null }
}

function exactLineSource(record, job, account, inbound, conversation) {
  if (!record || record.provider !== 'LINE_OA' || record.lane !== 'CUSTOMER' || record.entityType !== 'LINE_MESSAGE'
    || record.sourceType !== 'WEBHOOK' || record.processingStatus !== 'ADMITTED'
    || record.connectionId !== account.integrationConnectionId || record.externalId !== job.eventId
    || record.tenantId !== job.tenantId || record.businessId !== job.businessId) return false
  const payload = parseJson(record.payloadJson)
  if (!payload || hashPayload(payload) !== record.payloadHash) return false
  const event = payload.event
  const audienceMatches = event?.source?.type === 'user'
    ? job.audienceKind === 'DIRECT' && job.recipientId === job.sourceUserId
      && conversation.externalThreadId === job.sourceUserId
    : event?.source?.type === 'group'
      ? job.audienceKind === 'GROUP' && typeof event.source.groupId === 'string'
        && job.recipientId === event.source.groupId && conversation.externalThreadId === event.source.groupId
      : event?.source?.type === 'room'
        ? job.audienceKind === 'ROOM' && typeof event.source.roomId === 'string'
          && job.recipientId === event.source.roomId && conversation.externalThreadId === event.source.roomId
        : false
  return payload.destination === account.connection?.externalAccountId && audienceMatches
    && event?.type === 'message' && event.message?.type === 'text'
    && ['user', 'group', 'room'].includes(event.source?.type) && event.source?.userId === job.sourceUserId
    && event.message?.id === inbound.externalMessageId && event.message?.text === inbound.body
    && (event.webhookEventId || event.message?.id) === job.eventId
    && conversation.channel === 'LINE' && conversation.channelAccountId === job.channelAccountId
}

async function loadJobAuthority(job, db, { requireStockAuthority = false } = {}) {
  const keys = jobKeys(job)
  const current = await db.lineConversationJob.findUnique({ where: { id: keys.jobId }, include: {
    account: { include: { connection: { include: { provider: true } } } },
    inbound: { include: { conversation: { include: { customer: true } } } },
  } })
  if (!current || current.executionId !== keys.executionId || current.errorCode === 'PDPA_ERASURE'
    || !['CLAIMED', 'READY'].includes(current.status) || current.tenantId !== job.tenantId || current.businessId !== job.businessId
    || current.accountId !== job.accountId) return { current: null, baseAuthorized: false, stockAuthorized: false }
  const account = current.account
  const inbound = current.inbound
  const conversation = inbound?.conversation
  const customer = conversation?.customer
  const baseAuthorized = Boolean(account && inbound && conversation
    && current.accountId === account.id && current.tenantId === account.tenantId && current.businessId === account.businessId
    && current.channelAccountId === (account.bindingCode || account.id)
    && current.transportEpoch === account.transportEpoch && account.serverEnabled === true
    && account.transportMode === 'CLOUD' && account.status === 'CONNECTED' && account.archivedAt === null
    && account.runtimeOwner === current.runtimeOwner
    && account.connection?.tenantId === current.tenantId && account.connection?.businessId === current.businessId
    && account.connection?.status === 'ACTIVE' && account.connection?.provider?.code === 'LINE_OA'
    && inbound.id === current.inboundMessageId && inbound.direction === 'INBOUND' && inbound.contentKind === 'TEXT'
    && conversation.tenantId === current.tenantId && conversation.businessId === current.businessId
    && conversation.channel === 'LINE' && conversation.channelAccountId === current.channelAccountId)
  const record = baseAuthorized ? await db.rawExternalRecord.findFirst({ where: {
    connectionId: account.integrationConnectionId, provider: 'LINE_OA', entityType: 'LINE_MESSAGE', externalId: current.eventId,
  }, orderBy: [{ receivedAt: 'desc' }, { id: 'asc' }] }) : null
  const sourceAuthorized = baseAuthorized && exactLineSource(record, current, account, inbound, conversation)

  let identity = null
  if (requireStockAuthority && sourceAuthorized && current.audienceKind === 'DIRECT' && inbound.authorChannelIdentityId) {
    identity = await findChannelIdentity({ db, tenantId: current.tenantId,
      channelAccountId: account.bindingCode || account.id, providerSubject: current.sourceUserId })
  }
  const stockAuthorized = Boolean(sourceAuthorized && current.audienceKind === 'DIRECT'
    && current.recipientId === current.sourceUserId && identity && identity.id === inbound.authorChannelIdentityId
    && identity.tenantId === current.tenantId && identity.personId === customer?.personId
    && customer?.tenantId === current.tenantId && customer?.businessId === current.businessId
    && customer?.deletedAt === null && channelIdentityIsVerified(identity))
  const authorityDigest = digest({
    job: { id: current.id, executionId: current.executionId, tenantId: current.tenantId, businessId: current.businessId,
      accountId: current.accountId, channelAccountId: current.channelAccountId, eventId: current.eventId,
      audienceKind: current.audienceKind, recipientId: current.recipientId, sourceUserId: current.sourceUserId,
      inboundMessageId: current.inboundMessageId, errorCode: current.errorCode },
    account: account && { id: account.id, tenantId: account.tenantId, businessId: account.businessId,
      integrationConnectionId: account.integrationConnectionId, bindingCode: account.bindingCode,
      serverEnabled: account.serverEnabled, transportMode: account.transportMode, status: account.status,
      runtimeOwner: account.runtimeOwner, transportEpoch: account.transportEpoch, archivedAt: account.archivedAt,
      connectionStatus: account.connection?.status, provider: account.connection?.provider?.code },
    source: sourceAuthorized && { id: record.id, payloadHash: record.payloadHash, processingStatus: record.processingStatus },
    stockIdentity: stockAuthorized && { id: identity.id, personId: identity.personId, version: identity.version,
      status: identity.status, verifiedAt: identity.verifiedAt, linkedAt: identity.linkedAt, revokedAt: identity.revokedAt,
      customerId: customer.id, customerPersonId: customer.personId, customerBusinessId: customer.businessId,
      customerDeletedAt: customer.deletedAt, customerVersion: customer.version },
  })
  return { current, account, inbound, conversation, customer, record, identity, baseAuthorized: sourceAuthorized,
    stockAuthorized, authorityDigest }
}

function cleanLabel(value, maxCodePoints) {
  if (typeof value !== 'string') return ''
  return [...value.normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/gu, ' ').trim()]
    .slice(0, maxCodePoints).join('')
}

function publicProduct(product) {
  if (!product) return null
  const code = cleanLabel(product.code, 128)
  const displayName = cleanLabel(product.name || product.productMaster?.nameTh || code, 256)
  const baseUnit = cleanLabel(product.unit, 128)
  const axes = parseJson(product.productMaster?.variantAxesJson)
  const values = parseJson(product.variantJson)
  const variantLabel = Array.isArray(axes) && values && typeof values === 'object' && !Array.isArray(values)
    ? cleanLabel(axes.filter(axis => typeof axis === 'string').map(axis => values[axis]).filter(value => typeof value === 'string' && value.trim()).join(', '), 256) || null
    : null
  if (!code || !displayName || !baseUnit) return null
  return { sku: code, displayName, ...(variantLabel ? { variantLabel } : {}), baseUnit }
}

function resultHashShape(result) {
  const availability = result.facets?.availability
  const price = result.facets?.price
  return {
    schema: result.schema, status: result.status, product: result.product,
    facets: {
      ...(availability ? { availability: { state: availability.state, basis: availability.basis ?? null } } : {}),
      ...(price ? { price: { state: price.state, ...(price.state === 'PUBLISHED' ? {
        unitAmountMinor: price.unitAmountMinor, currency: price.currency, quantity: price.quantity,
        unit: price.unit, taxTreatment: price.taxTreatment,
      } : {}) } } : {}),
    }, requestedQuantity: result.requestedQuantity ?? null,
  }
}

function formatResult(result) {
  if (result.status === 'CLARIFY') {
    if (result.clarification === 'NATURAL_PRODUCT_REQUIRED') return 'กรุณาระบุรหัสสินค้า TEST ONLY เพียงหนึ่งรายการให้ชัดเจน'
    if (result.clarification === 'NATURAL_PRICE_QUANTITY_UNIT_REQUIRED') return 'กรุณาส่งคำถามราคาใหม่พร้อม SKU จำนวนเต็มบวกและหน่วยฐาน เช่น ราคา TEST-ONLY-… 1 EA เท่าไร ระบบจะไม่สมมติจำนวนหรือหน่วยให้'
    if (result.clarification === 'NATURAL_STOCK_COUNT_UNSUPPORTED') return 'ระบบตอบได้เฉพาะสถานะมีหรือไม่มี ATP ไม่เปิดเผยจำนวนสต็อกหรือรับรองว่าพอตามจำนวนที่ถาม'
    if (result.clarification === 'NATURAL_FACTS_UNSUPPORTED') return 'ยังไม่สามารถแปลคำถามนี้เป็นการตรวจสต็อกหรือราคาที่แน่นอนได้ กรุณาระบุ SKU และถามสถานะสต็อก หรือราคาพร้อมจำนวนและหน่วยให้ชัดเจน'
    return INVALID_REPLY
  }
  if (result.status === 'UNAVAILABLE' && !result.product) return UNAVAILABLE_REPLY
  if (!result.product) return UNAVAILABLE_REPLY
  const product = result.product
  const lines = [`${product.displayName} (${product.sku})`, `หน่วยฐาน: ${product.baseUnit}`]
  if (product.variantLabel) lines.push(`ตัวเลือก: ${product.variantLabel}`)
  if (result.facets.availability) {
    const availability = result.facets.availability.state
    const label = availability === 'ATP_POSITIVE' ? 'มี ATP มากกว่าศูนย์'
      : availability === 'ATP_ZERO' ? 'ATP เป็นศูนย์'
        : availability === 'NOT_MEASURED' ? 'ไม่ได้ติดตามปริมาณ' : 'ไม่สามารถยืนยันสถานะ ATP ได้'
    lines.push(`สถานะสต็อก: ${label} (เป็นสถานะจาก ATP ไม่ใช่การรับประกันว่าจะจัดส่งได้)`)
  }
  if (result.facets.price) {
    const price = result.facets.price
    if (price.state === 'PUBLISHED') {
      const whole = Math.floor(price.unitAmountMinor / 100).toLocaleString('en-US')
      const fraction = String(price.unitAmountMinor % 100).padStart(2, '0')
      lines.push(`ราคาขายที่เผยแพร่สำหรับ ${price.quantity} ${price.unit}: ฿${whole}.${fraction} ต่อ ${price.unit}`)
      lines.push('ภาษี: ไม่ทราบว่าราคานี้รวมภาษีหรือไม่')
    } else lines.push('ราคาขายที่เผยแพร่: ยังยืนยันไม่ได้')
  }
  return lines.join('\n').slice(0, 4900)
}

function buildBinding({ job, requestDigest, authorityDigest, productRefDigest = null, stockPolicyVersion = null,
  stockObservationDigest = null, publicationDigest = null, result }) {
  const { jobId, executionId } = jobKeys(job)
  return { schema: BINDING_SCHEMA, jobId, executionId, requestDigest, authorityDigest,
    productRefDigest, stockPolicyVersion, stockObservationDigest, publicationDigest,
    resultDigest: digest(resultHashShape(result)) }
}

async function resolveProduct(job, request, db) {
  return db.product.findFirst({ where: { tenantId: job.tenantId, businessId: job.businessId, code: request.sku },
    include: { productMaster: { select: { nameTh: true, nameEn: true, variantAxesJson: true, status: true } } } })
}

function unavailableResult({ product = null, request = null, availability = null, price = null, status = 'UNAVAILABLE' } = {}) {
  return { schema: 'line-product-facts.v1', status, ...(product ? { product } : {}),
    ...(request ? { requestedQuantity: request.facets.includes('price') ? request.quantity : undefined } : {}),
    facets: { ...(availability ? { availability } : {}), ...(price ? { price } : {}) } }
}

/** Resolve recognized fact requests from current source owners, without an LLM. */
export async function resolveLineProductFacts(job, { db = prisma, now,
  priceReader = readPublishedExactPriceForLine,
  stockReader = readLineStockProjection,
  knowledgeReaderFactory = createCorpusKnowledgeReader,
  env = process.env,
} = {}) {
  const parsed = parseLineProductFactsRequest(job?.inbound?.body)
  if (parsed === null) throw Object.assign(new Error('LINE_PRODUCT_FACTS_COMMAND_REQUIRED'), { status: 400, code: 'LINE_PRODUCT_FACTS_COMMAND_REQUIRED' })
  const requestDigest = digest(parsed.request ?? { clarification: parsed.clarification?.code ?? 'INVALID_REQUEST' })
  let result
  let authority = null
  let productRefDigest = null
  let stockPolicyVersion = null
  let stockObservationDigest = null
  let publicationDigest = null
  try {
    let naturalProducts = null
    if (parsed.inputKind === 'NATURAL_LANGUAGE') {
      // Job scope here is only a preliminary rejection. The persisted, source-
      // verified scope below is checked again before either owner is consulted.
      naturalProducts = await naturalProductFactsScope({ env, db, job })
    }
    authority = await loadJobAuthority(job, db, { requireStockAuthority: Boolean(parsed.request?.facets.includes('availability')) })
    if (naturalProducts) naturalProducts = await naturalProductFactsScope({ env, db, job: authority.current })
    if (!authority.baseAuthorized) {
      result = unavailableResult()
    } else if (parsed.request === null) {
      result = { schema: 'line-product-facts.v1', status: 'CLARIFY', clarification: parsed.clarification?.code ?? 'INVALID_REQUEST', facets: {} }
    } else {
      const request = parsed.request
      const product = await resolveProduct(authority.current, request, db)
      if (!product || product.productMaster?.status !== 'ACTIVE'
        || (naturalProducts && !naturalProducts.some(candidate => candidate.productId === product.id && candidate.sku === product.code))) {
        result = unavailableResult()
      } else {
        productRefDigest = digest({ tenantId: product.tenantId, businessId: product.businessId,
          id: product.id, code: product.code, status: product.status, unit: product.unit,
          productMasterId: product.productMasterId, masterStatus: product.productMaster?.status })
        const productDto = publicProduct(product)
        if (!productDto) result = unavailableResult()
        else {
          let availability = null
          let price = null
          if (request.facets.includes('availability')) {
            if (!authority.stockAuthorized) {
              result = unavailableResult()
            } else {
              const policy = await db.lineStockDisclosurePolicy.findUnique({
                where: { tenantId_businessId_lineOaAccountId_productId: {
                  tenantId: authority.current.tenantId, businessId: authority.current.businessId,
                  lineOaAccountId: authority.current.accountId, productId: product.id,
                } }, select: { enabled: true, version: true },
              })
              stockPolicyVersion = policy?.version ?? null
              if (!policy?.enabled) result = unavailableResult()
              else {
                try {
                  const stock = await stockReader({ tenantId: authority.current.tenantId,
                    businessId: authority.current.businessId, productId: product.id, db,
                    ...(now !== undefined ? { now } : {}) })
                  availability = { state: stock.state, basis: stock.basis, observedFrom: stock.observedFrom, observedTo: stock.observedTo }
                  stockObservationDigest = stock.sourceDigest
                } catch {
                  // A technical failure of the authorized Inventory read makes
                  // only that facet unavailable. The earlier identity/policy
                  // decisions above still deny the entire request when false.
                  availability = { state: 'UNAVAILABLE', basis: null, observedFrom: null, observedTo: null }
                  stockObservationDigest = null
                }
              }
            }
          }
          if (!result && request.facets.includes('price')) {
            try {
              if (request.unit !== product.unit) {
                price = { state: 'UNAVAILABLE', observedFrom: null, observedTo: null }
              } else {
                const reader = knowledgeReaderFactory({ tenantId: authority.current.tenantId,
                  businessId: authority.current.businessId, db })
                const projected = await priceReader({ tenantId: authority.current.tenantId,
                  businessId: authority.current.businessId, productId: product.id, quantity: request.quantity, unit: request.unit },
                { db, ...(now !== undefined ? { now } : {}), knowledgeReader: reader })
                price = projected?.state === 'PUBLISHED' ? {
                  state: 'PUBLISHED', unitAmountMinor: projected.unitAmountMinor, currency: 'THB',
                  quantity: projected.quantity, unit: projected.unit, taxTreatment: 'UNKNOWN',
                  observedFrom: projected.observedFrom, observedTo: projected.observedTo,
                } : { state: 'UNAVAILABLE', observedFrom: projected?.observedFrom ?? null, observedTo: projected?.observedTo ?? null }
                publicationDigest = projected?.publicationDigest ?? null
              }
            } catch {
              // Authorized source failure is facet-local in either direction.
              // Earlier stock identity/policy denial still suppresses this path.
              price = { state: 'UNAVAILABLE', observedFrom: null, observedTo: null }
              publicationDigest = null
            }
          }
          if (!result) {
            const usableAvailability = availability && ['ATP_POSITIVE', 'ATP_ZERO', 'NOT_MEASURED'].includes(availability.state)
            const usablePrice = price?.state === 'PUBLISHED'
            const requested = request.facets.length
            const usable = Number(Boolean(usableAvailability)) + Number(Boolean(usablePrice))
            const status = usable === requested ? 'READY' : usable > 0 ? 'PARTIAL' : 'UNAVAILABLE'
            result = status === 'UNAVAILABLE' ? unavailableResult()
              : unavailableResult({ product: productDto, request, availability, price, status })
          }
        }
      }
    }
  } catch {
    // Owner-source failures are indistinguishable from unavailable facts at this boundary.
    result = unavailableResult()
  }
  if (!result) result = unavailableResult()
  const binding = buildBinding({ job, requestDigest,
    authorityDigest: authority?.authorityDigest ?? digest({ jobId: job.id, executionId: job.executionId, authority: 'UNAVAILABLE' }),
    productRefDigest, stockPolicyVersion, stockObservationDigest, publicationDigest, result })
  return { text: formatResult(result), binding }
}

/** Re-resolve at the final send fence. Read timestamps are intentionally excluded from the binding. */
export async function revalidateLineProductFacts(job, binding, {
  db = prisma, now, knowledgeReaderFactory = createCorpusKnowledgeReader, env = process.env,
} = {}) {
  try {
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)) return false
    const current = await resolveLineProductFacts(job, { db, now, knowledgeReaderFactory, env })
    return digest(current.binding) === digest(binding)
  } catch {
    return false
  }
}
