import { createHash } from 'node:crypto'
import prisma from '@/lib/db'
import { ownsBusiness } from '@/modules/identity/viewer-authority'
import { recordAudit } from '@/modules/project-manager/application/audit'
import {
  BILLING_PROMPTPAY_PROVIDER,
  BILLING_ROUNDING,
  BILLING_VAT_TREATMENTS,
  BILLING_WALK_IN_POLICIES,
  assertInt32,
  assertNonNegativeInt32,
  billingProfileStatus,
  buyerSource,
  calculateThaiVat,
  generatePromptPayPayload,
  normalizePromptPayTarget,
  promptPayPayloadForProfile,
  PRISMA_INT_MAX,
  zBillingDocumentRequest,
  zBillingProfileInput,
} from '../domain/billing'
import { fromSatang, orderTotals, paymentState, paymentSummary } from '../domain/commerce'
import { loadBusiness, notFound } from './commerce-authority'
import { ORDER_SELECT } from './sales-order-service'

// @req FR-186 — the only Commerce writer for the Business billing profile and
// durable invoice/receipt/tax-document snapshot. Preview and issue share the
// same seller, buyer, tax and PromptPay preparation; only issue allocates a
// number, writes the immutable snapshot and appends its audit row.
// @spec ADR-065; BR-001; BR-002; SEC-001
// @tested tests/unit/commerce-billing-domain.test.js,
//   tests/integration/fr186-billing.test.js

const failure = (status, message) => Object.assign(new Error(message), { status })
const actor = (viewer) => viewer?.principal?.id ?? null

const PROFILE_SELECT = {
  id: true, tenantId: true, businessId: true, vatRegistered: true, vatRateBps: true,
  vatTreatment: true, taxPolicyVersion: true, taxEffectiveAt: true, taxVerifiedAt: true,
  nonVatDocumentPolicy: true, walkInDocumentPolicy: true, promptPayProvider: true,
  promptPayTargetType: true, promptPayTarget: true, promptPayActive: true,
  promptPayVerifiedAt: true, active: true, version: true, createdAt: true, updatedAt: true,
}

const DOCUMENT_SELECT = {
  id: true, tenantId: true, businessId: true, orderId: true, branchId: true,
  documentType: true, documentNumber: true, calendarYear: true, sequenceNumber: true,
  status: true, idempotencyKey: true, requestHash: true, issuedAt: true,
  issuedByPersonId: true, snapshotJson: true, createdAt: true, updatedAt: true,
}

const ACCEPTED_TAX_ID_TYPES = new Set(['TH_TAX_ID', 'TAX_ID', 'VAT_ID', 'TAXID'])
const TAX_DOCUMENT_TYPES = new Set(['TAX_INVOICE', 'ABB_TAX_INVOICE'])
const NON_VAT_DOCUMENT_TYPES = new Set(['INVOICE', 'RECEIPT'])
const DOCUMENT_PREFIXES = Object.freeze({ INVOICE: 'INV', RECEIPT: 'REC', TAX_INVOICE: 'TAX', ABB_TAX_INVOICE: 'ABB' })

function stableJson(value) {
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function requestHash(data) {
  const buyer = data.buyer
  const canonical = {
    orderId: data.orderId,
    branchId: data.branchId,
    documentType: data.documentType,
    includePromptPay: data.includePromptPay === true,
    buyer: {
      source: buyerSource(buyer),
      name: buyer.name ?? null,
      taxId: buyer.taxId ?? null,
      branchCode: buyer.branchCode ?? null,
      address: buyer.address ?? null,
    },
  }
  return createHash('sha256').update(stableJson(canonical)).digest('hex')
}

function trimOrNull(value) {
  if (value === undefined || value === null) return null
  const text = String(value).trim()
  return text || null
}

function normalizeTaxId(value) {
  const digits = String(value ?? '').replace(/[\s-]/g, '')
  if (!/^[0-9]{13}$/.test(digits)) throw failure(422, 'BILLING_BUYER_DATA_INVALID')
  return digits
}

function yearInBangkok(date) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric' }).format(date)
  return Number(day)
}

function documentCode(type, year, sequence) {
  return `${DOCUMENT_PREFIXES[type]}-${year}-${String(sequence).padStart(6, '0')}`
}

function profileLifecycleStatus(profile) {
  if (!profile || profile.active !== true) return 'UNAVAILABLE'
  if (profile.vatRegistered === true && (!profile.vatRateBps || !BILLING_VAT_TREATMENTS.includes(profile.vatTreatment) || !profile.taxPolicyVersion?.trim() || !profile.taxEffectiveAt || !profile.taxVerifiedAt)) return 'UNAVAILABLE'
  if (!profile.vatRegistered && profile.nonVatDocumentPolicy !== 'ALLOW_INVOICE_RECEIPT') return 'UNAVAILABLE'
  if (!BILLING_WALK_IN_POLICIES.includes(profile.walkInDocumentPolicy)) return 'UNAVAILABLE'
  return billingProfileStatus(profile)
}

async function loadBusinessDetails(db, viewer, businessId, { capability = 'read' } = {}) {
  const authorized = await loadBusiness(db, viewer, businessId, { capability })
  const business = await db.business.findUnique({
    where: { id: authorized.id },
    select: {
      id: true, code: true, name: true, status: true, tenantId: true, legalEntityId: true,
      tenant: { select: { portfolioId: true } },
      legalEntity: {
        select: {
          id: true, portfolioId: true, legalName: true, legalAddress: true,
          identifiers: { select: { country: true, type: true, value: true, verifiedAt: true } },
        },
      },
    },
  })
  if (!business) throw notFound()
  return business
}

async function resolveSeller(tx, business, branchId) {
  const legalEntity = business.legalEntity
  if (!legalEntity || legalEntity.portfolioId !== business.tenant.portfolioId) throw failure(422, 'BILLING_SELLER_NOT_CONFIGURED')
  const identifier = legalEntity.identifiers.find((row) => row.country === 'TH' && ACCEPTED_TAX_ID_TYPES.has(row.type) && row.verifiedAt && /^[0-9]{13}$/.test(String(row.value).replace(/[\s-]/g, '')))
  if (!identifier || !legalEntity.legalName || !legalEntity.legalAddress?.trim()) throw failure(422, 'BILLING_SELLER_NOT_CONFIGURED')
  const branch = await tx.branch.findUnique({ where: { id: branchId }, select: { id: true, code: true, name: true, tenantId: true, businessId: true, address: true, taxBranchCode: true, status: true } })
  if (!branch || branch.tenantId !== business.tenantId || branch.businessId !== business.id || branch.status !== 'ACTIVE') throw failure(422, 'BILLING_BRANCH_NOT_CONFIGURED')
  if (!branch.address?.trim()) throw failure(422, 'BILLING_BRANCH_NOT_CONFIGURED')
  return {
    businessId: business.id,
    businessCode: business.code,
    businessName: business.name,
    legalEntityId: legalEntity.id,
    legalName: legalEntity.legalName,
    taxId: String(identifier.value).replace(/[\s-]/g, ''),
    legalAddress: legalEntity.legalAddress.trim(),
    branch: {
      id: branch.id,
      code: branch.code,
      taxBranchCode: branch.taxBranchCode ?? branch.code,
      name: branch.name,
      address: branch.address.trim(),
    },
  }
}

function normalizeBuyer(buyer, documentType, profile) {
  const source = buyerSource(buyer)
  if (!source) throw failure(422, 'BILLING_BUYER_DATA_REQUIRED')
  if (source === 'ANONYMOUS_WALK_IN') {
    if (documentType !== 'RECEIPT') throw failure(422, 'BILLING_WALK_IN_RECEIPT_ONLY')
    if (profile.walkInDocumentPolicy === undefined || profile.walkInDocumentPolicy === null) throw failure(422, 'BILLING_WALK_IN_POLICY_NOT_CONFIGURED')
    if (profile.walkInDocumentPolicy !== 'ALLOW_ANONYMOUS_RECEIPT') throw failure(422, 'BILLING_WALK_IN_POLICY_DENIED')
    if (buyer.name || buyer.taxId || buyer.branchCode || buyer.address) throw failure(422, 'BILLING_BUYER_DATA_INVALID')
    return { source }
  }
  if (source !== 'ISSUANCE_INPUT') throw failure(422, 'BILLING_BUYER_DATA_REQUIRED')
  const name = trimOrNull(buyer.name)
  const address = trimOrNull(buyer.address)
  const branchCode = trimOrNull(buyer.branchCode)
  if (!name || !address || !branchCode) throw failure(422, 'BILLING_BUYER_DATA_REQUIRED')
  const taxId = normalizeTaxId(buyer.taxId)
  return { source, name, taxId, branchCode, address }
}

function taxForOrder(orderRow, profile, documentType) {
  const totals = orderTotals(orderRow.lines, orderRow.discountSatang)
  try {
    for (const amount of [totals.subtotal, totals.lineDiscount, totals.orderDiscount, totals.total]) assertNonNegativeInt32(amount)
  } catch { throw failure(422, 'BILLING_AMOUNT_INVALID') }
  if (profile.vatRegistered !== true) {
    if (!NON_VAT_DOCUMENT_TYPES.has(documentType)) throw failure(422, 'BILLING_TAX_NOT_CONFIGURED')
    return {
      vatRegistered: false,
      vatTreatment: null,
      vatRateBps: 0,
      rounding: BILLING_ROUNDING,
      policyVersion: profile.taxPolicyVersion ?? 'NON_VAT',
      netSatang: totals.total,
      vatSatang: 0,
      grossSatang: totals.total,
      net: fromSatang(totals.total),
      vat: 0,
      gross: fromSatang(totals.total),
    }
  }
  if (!Number.isInteger(profile.vatRateBps) || profile.vatRateBps <= 0 || !BILLING_VAT_TREATMENTS.includes(profile.vatTreatment) || !profile.taxPolicyVersion?.trim() || !profile.taxEffectiveAt || !profile.taxVerifiedAt) throw failure(422, 'BILLING_TAX_NOT_CONFIGURED')
  const calculated = calculateThaiVat(totals.total, { vatTreatment: profile.vatTreatment, rateBps: profile.vatRateBps })
  return {
    vatRegistered: true,
    vatTreatment: calculated.vatTreatment,
    vatRateBps: calculated.vatRateBps,
    rounding: calculated.rounding,
    policyVersion: profile.taxPolicyVersion ?? null,
    effectiveAt: profile.taxEffectiveAt ?? null,
    verifiedAt: profile.taxVerifiedAt,
    netSatang: calculated.netSatang,
    vatSatang: calculated.vatSatang,
    grossSatang: calculated.grossSatang,
    net: calculated.net,
    vat: calculated.vat,
    gross: calculated.gross,
  }
}

async function prepareDocument(tx, data, { viewer, now, includeIdempotency = false } = {}) {
  const orderRow = await tx.salesOrder.findUnique({ where: { id: data.orderId }, select: ORDER_SELECT })
  if (!orderRow) throw notFound()
  const business = await loadBusinessDetails(tx, viewer, orderRow.businessId, { capability: 'order' })
  // PromptPay payloads and this P3 tax profile are THB/satang only.  Refuse an
  // FR-166 order in another currency after scope authorization rather than
  // silently treating its amount as THB or inventing an FX rate.
  if (orderRow.currency !== 'THB') throw failure(422, 'BILLING_CURRENCY_UNSUPPORTED')
  const profile = await tx.businessBillingProfile.findUnique({ where: { businessId: business.id }, select: PROFILE_SELECT })
  if (!profile || profile.active !== true) throw failure(422, 'BILLING_PROFILE_NOT_CONFIGURED')
  if (!profile.vatRegistered && NON_VAT_DOCUMENT_TYPES.has(data.documentType) && profile.nonVatDocumentPolicy !== 'ALLOW_INVOICE_RECEIPT') {
    if (profile.nonVatDocumentPolicy === 'DENY') throw failure(422, 'BILLING_NON_VAT_POLICY_DENIED')
    throw failure(422, 'BILLING_NON_VAT_POLICY_NOT_CONFIGURED')
  }
  if (!profile.vatRegistered && TAX_DOCUMENT_TYPES.has(data.documentType)) throw failure(422, 'BILLING_TAX_NOT_CONFIGURED')
  if (profile.vatRegistered && (!profile.vatRateBps || !profile.taxPolicyVersion?.trim() || !profile.taxEffectiveAt)) throw failure(422, 'BILLING_TAX_NOT_CONFIGURED')
  const seller = await resolveSeller(tx, business, data.branchId)
  const buyer = normalizeBuyer(data.buyer, data.documentType, profile)
  const totals = orderTotals(orderRow.lines, orderRow.discountSatang)
  const payments = paymentSummary(orderRow.payments)
  try {
    for (const amount of [totals.subtotal, totals.lineDiscount, totals.orderDiscount, totals.total, payments.paid, payments.refunded, payments.pending, payments.pendingRefund]) assertNonNegativeInt32(amount)
    assertInt32(payments.net)
  } catch { throw failure(422, 'BILLING_AMOUNT_INVALID') }
  const tax = taxForOrder(orderRow, profile, data.documentType)
  if (includeIdempotency && data.documentType === 'RECEIPT' && payments.net < tax.grossSatang) throw failure(422, 'BILLING_RECEIPT_PAYMENT_NOT_VERIFIED')
  // For EXCLUSIVE VAT the order total is the net amount recorded by FR-166,
  // while the document amount due and generated PromptPay must include VAT.
  // Keep the original order total intact and bind the document payable amount
  // to the calculated gross snapshot instead of silently mutating the order.
  const payableTotalSatang = tax.grossSatang
  const balanceDueSatang = Math.max(0, payableTotalSatang - payments.net)
  try { assertNonNegativeInt32(balanceDueSatang) } catch { throw failure(422, 'BILLING_AMOUNT_INVALID') }
  let promptPay = null
  if (data.includePromptPay === true) promptPay = promptPayPayloadForProfile(profile, balanceDueSatang)
  const snapshot = {
    schemaVersion: 1,
    document: { type: data.documentType, status: 'ISSUED', rounding: BILLING_ROUNDING },
    seller,
    buyer,
    tax,
    order: {
      id: orderRow.id,
      code: orderRow.code,
      status: orderRow.status,
      orderedAt: orderRow.orderedAt,
      currency: orderRow.currency,
      subtotalSatang: totals.subtotal,
      lineDiscountSatang: totals.lineDiscount,
      orderDiscountSatang: totals.orderDiscount,
      totalSatang: totals.total,
      documentNetSatang: tax.netSatang,
      documentGrossSatang: tax.grossSatang,
      paidSatang: payments.paid,
      refundedSatang: payments.refunded,
      netPaidSatang: payments.net,
      pendingSatang: payments.pending,
      balanceDueSatang,
      paymentState: paymentState(payableTotalSatang, payments),
      lines: orderRow.lines.map((line) => ({ id: line.id, productId: line.productId, description: line.description, qty: line.qty, unitPriceSatang: line.unitPriceSatang, discountSatang: line.discountSatang, lineTotalSatang: line.qty * line.unitPriceSatang - line.discountSatang })),
    },
    paymentReferences: orderRow.payments.map((payment) => ({ id: payment.id, code: payment.code, kind: payment.kind, method: payment.method, amountSatang: payment.amountSatang, status: payment.status, bankReference: payment.bankReference, paidAt: payment.paidAt })),
    promptPay,
    policy: {
      profileVersion: profile.version,
      taxPolicyVersion: profile.taxPolicyVersion ?? null,
      taxEffectiveAt: profile.taxEffectiveAt ?? null,
      nonVatDocumentPolicy: profile.nonVatDocumentPolicy ?? null,
      walkInDocumentPolicy: profile.walkInDocumentPolicy ?? null,
    },
  }
  return { orderRow, business, profile, seller, buyer, tax, totals, payments, payableTotalSatang, balanceDueSatang, promptPay, snapshot, requestHash: requestHash(data), ...(includeIdempotency ? { idempotencyKey: data.idempotencyKey } : {}), now }
}

function documentDto(row) {
  let snapshot = {}
  try { snapshot = JSON.parse(row.snapshotJson) } catch { snapshot = {} }
  return {
    id: row.id,
    tenantId: row.tenantId,
    businessId: row.businessId,
    orderId: row.orderId,
    branchId: row.branchId,
    documentType: row.documentType,
    documentNumber: row.documentNumber,
    calendarYear: row.calendarYear,
    sequenceNumber: row.sequenceNumber,
    status: row.status,
    idempotencyKey: row.idempotencyKey,
    requestHash: row.requestHash,
    issuedAt: row.issuedAt,
    issuedByPersonId: row.issuedByPersonId,
    snapshot,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function runTransactionWithRetry(db, callback) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.$transaction(callback)
    } catch (error) {
      // A unique-key race (P2002) and SQLite's explicit busy/locked outcomes
      // are rolled-back transaction conflicts that can be retried safely.  Do
      // not retry P2028 or generic "transaction closed" messages: those can
      // represent an unknown interactive-transaction outcome, and retrying
      // them could issue a second document after the first one committed.
      const retryable = error?.code === 'P2002' || /database is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(error?.message || '')
      if (!retryable || attempt === 2) throw error
    }
  }
  throw failure(500, 'BILLING_TRANSACTION_FAILED')
}

/** Read owner-maintained billing state and active Branch choices. */
export async function getBillingProfile(businessId, { viewer, db = prisma } = {}) {
  const business = await loadBusinessDetails(db, viewer, businessId)
  const [profile, branches] = await Promise.all([
    db.businessBillingProfile.findUnique({ where: { businessId: business.id }, select: PROFILE_SELECT }),
    db.branch.findMany({ where: { businessId: business.id, status: 'ACTIVE' }, orderBy: [{ code: 'asc' }], select: { id: true, code: true, name: true, address: true, taxBranchCode: true, status: true } }),
  ])
  return {
    businessId: business.id,
    status: profileLifecycleStatus(profile),
    profile,
    branches,
    sellerLink: { legalEntityId: business.legalEntity?.id ?? null, legalName: business.legalEntity?.legalName ?? null, legalAddress: business.legalEntity?.legalAddress ?? null },
  }
}

/** Owner-only configuration; shared LegalEntity address edits fail closed. */
export async function updateBillingProfile(businessId, input, { viewer, db = prisma } = {}) {
  const data = zBillingProfileInput.parse(input)
  const visible = await loadBusinessDetails(db, viewer, businessId)
  if (!ownsBusiness(viewer, visible.id)) throw notFound()
  return runTransactionWithRetry(db, async (tx) => {
    const business = await loadBusinessDetails(tx, viewer, visible.id)
    const existing = await tx.businessBillingProfile.findUnique({ where: { businessId: business.id }, select: PROFILE_SELECT })
    if (data.expectedVersion !== undefined && data.expectedVersion !== (existing?.version ?? 1)) throw failure(409, 'BILLING_PROFILE_VERSION_CONFLICT')
    const profileData = {}
    const profileFields = ['vatRegistered', 'vatRateBps', 'vatTreatment', 'taxPolicyVersion', 'taxEffectiveAt', 'taxVerifiedAt', 'nonVatDocumentPolicy', 'walkInDocumentPolicy', 'promptPayProvider', 'promptPayTargetType', 'promptPayActive', 'promptPayVerifiedAt', 'active']
    for (const field of profileFields) if (data[field] !== undefined) profileData[field] = data[field]
    const targetType = data.promptPayTargetType !== undefined ? data.promptPayTargetType : existing?.promptPayTargetType
    const target = data.promptPayTarget !== undefined ? data.promptPayTarget : existing?.promptPayTarget
    if (target !== undefined && target !== null) {
      try {
        const normalized = normalizePromptPayTarget(targetType, target)
        profileData.promptPayTargetType = normalized.targetType
        profileData.promptPayTarget = normalized.value
      } catch { throw failure(422, 'PROMPTPAY_TARGET_INVALID') }
    } else if (data.promptPayTarget !== undefined) {
      profileData.promptPayTarget = null
    }
    const nextActive = data.promptPayActive !== undefined ? data.promptPayActive : (existing?.promptPayActive ?? false)
    if (nextActive) {
      if (profileData.promptPayProvider !== BILLING_PROMPTPAY_PROVIDER && existing?.promptPayProvider !== BILLING_PROMPTPAY_PROVIDER) throw failure(422, 'PROMPTPAY_NOT_CONFIGURED')
      if (!target || !targetType || !(data.promptPayVerifiedAt ?? existing?.promptPayVerifiedAt)) throw failure(422, 'PROMPTPAY_NOT_CONFIGURED')
    }
    let legalEntityChanged = false
    if (data.legalAddress !== undefined) {
      if (!business.legalEntityId || !business.legalEntity) throw failure(422, 'BILLING_SELLER_NOT_CONFIGURED')
      const linkedBusinesses = await tx.business.count({ where: { legalEntityId: business.legalEntityId } })
      if (linkedBusinesses > 1 && trimOrNull(data.legalAddress) !== trimOrNull(business.legalEntity.legalAddress)) throw failure(409, 'BILLING_SHARED_LEGAL_ENTITY')
      if (trimOrNull(data.legalAddress) !== trimOrNull(business.legalEntity.legalAddress)) {
        await tx.legalEntity.update({ where: { id: business.legalEntityId }, data: { legalAddress: trimOrNull(data.legalAddress) } })
        legalEntityChanged = true
      }
    }
    let branchChanged = false
    if (data.branchAddress !== undefined || data.taxBranchCode !== undefined) {
      if (!data.branchId) throw failure(422, 'BILLING_BRANCH_NOT_CONFIGURED')
      const branch = await tx.branch.findUnique({ where: { id: data.branchId }, select: { id: true, businessId: true, tenantId: true, status: true, address: true, taxBranchCode: true } })
      if (!branch || branch.businessId !== business.id || branch.tenantId !== business.tenantId || branch.status !== 'ACTIVE') throw failure(422, 'BILLING_BRANCH_NOT_CONFIGURED')
      const branchData = {}
      if (data.branchAddress !== undefined) branchData.address = trimOrNull(data.branchAddress)
      if (data.taxBranchCode !== undefined) branchData.taxBranchCode = trimOrNull(data.taxBranchCode)
      await tx.branch.update({ where: { id: branch.id }, data: branchData })
      branchChanged = true
    }
    const profile = existing
      ? await tx.businessBillingProfile.update({ where: { id: existing.id }, data: { ...profileData, version: { increment: 1 } }, select: PROFILE_SELECT })
      : await tx.businessBillingProfile.create({ data: { tenantId: business.tenantId, businessId: business.id, ...profileData }, select: PROFILE_SELECT })
    await recordAudit(tx, { entityType: 'BUSINESS_BILLING_PROFILE', entityId: profile.id, action: 'BILLING_PROFILE_UPDATED', actorId: actor(viewer), payload: { businessId: business.id, version: profile.version, fields: Object.keys(profileData), legalEntityChanged, branchChanged } })
    if (legalEntityChanged) await recordAudit(tx, { entityType: 'LEGAL_ENTITY', entityId: business.legalEntityId, action: 'LEGAL_ENTITY_ADDRESS_UPDATED', actorId: actor(viewer), payload: { businessId: business.id } })
    if (branchChanged) await recordAudit(tx, { entityType: 'BRANCH', entityId: data.branchId, action: 'BRANCH_BILLING_ADDRESS_UPDATED', actorId: actor(viewer), payload: { businessId: business.id } })
    return { businessId: business.id, status: profileLifecycleStatus(profile), profile }
  })
}

/** Non-persistent invoice/receipt/tax preview. */
export async function previewBillingDocument(input, { viewer, db = prisma, now = new Date() } = {}) {
  const data = zBillingDocumentRequest.parse(input)
  const prepared = await prepareDocument(db, data, { viewer, now })
  const snapshot = { ...prepared.snapshot, document: { ...prepared.snapshot.document, status: 'PREVIEW' } }
  return {
    id: null,
    status: 'PREVIEW',
    documentType: data.documentType,
    documentNumber: null,
    issuedAt: null,
    idempotencyKey: null,
    requestHash: prepared.requestHash,
    snapshot,
    tax: prepared.tax,
    promptPay: prepared.promptPay,
  }
}

/** Transactional immutable issuance with per-Business/type/year numbering. */
export async function issueBillingDocument(input, { viewer, db = prisma, now = new Date() } = {}) {
  const data = zBillingDocumentRequest.parse(input)
  if (!data.idempotencyKey) throw failure(400, 'BILLING_IDEMPOTENCY_KEY_REQUIRED')
  return runTransactionWithRetry(db, async (tx) => {
    const order = await tx.salesOrder.findUnique({ where: { id: data.orderId }, select: { id: true, businessId: true } })
    if (!order) throw notFound()
    const business = await loadBusiness(tx, viewer, order.businessId, { capability: 'order' })
    const hash = requestHash(data)
    const existing = await tx.commerceDocument.findUnique({ where: { businessId_idempotencyKey: { businessId: business.id, idempotencyKey: data.idempotencyKey } }, select: DOCUMENT_SELECT })
    if (existing) {
      if (existing.requestHash !== hash) throw failure(409, 'BILLING_IDEMPOTENCY_CONFLICT')
      return documentDto(existing)
    }
    const prepared = await prepareDocument(tx, data, { viewer, now, includeIdempotency: true })
    const year = yearInBangkok(now)
    const sequenceKey = { businessId_documentType_calendarYear: { businessId: business.id, documentType: data.documentType, calendarYear: year } }
    const currentSequence = await tx.commerceDocumentSequence.findUnique({ where: sequenceKey, select: { lastSequence: true } })
    if (currentSequence?.lastSequence >= PRISMA_INT_MAX) throw failure(409, 'BILLING_SEQUENCE_EXHAUSTED')
    const sequence = await tx.commerceDocumentSequence.upsert({
      where: sequenceKey,
      create: { tenantId: business.tenantId, businessId: business.id, documentType: data.documentType, calendarYear: year, lastSequence: 1 },
      update: { lastSequence: { increment: 1 } },
      select: { lastSequence: true },
    })
    try { assertNonNegativeInt32(sequence.lastSequence) } catch { throw failure(409, 'BILLING_SEQUENCE_EXHAUSTED') }
    const issuedAt = now instanceof Date ? now : new Date(now)
    const number = documentCode(data.documentType, year, sequence.lastSequence)
    const snapshot = { ...prepared.snapshot, document: { ...prepared.snapshot.document, status: 'ISSUED', number, calendarYear: year, sequenceNumber: sequence.lastSequence, issuedAt } }
    const created = await tx.commerceDocument.create({
      data: {
        tenantId: business.tenantId, businessId: business.id, orderId: data.orderId, branchId: data.branchId,
        documentType: data.documentType, documentNumber: number, calendarYear: year, sequenceNumber: sequence.lastSequence,
        status: 'ISSUED', idempotencyKey: data.idempotencyKey, requestHash: prepared.requestHash, issuedAt,
        issuedByPersonId: actor(viewer), snapshotJson: JSON.stringify(snapshot),
      },
      select: DOCUMENT_SELECT,
    })
    await recordAudit(tx, { entityType: 'COMMERCE_DOCUMENT', entityId: created.id, action: 'COMMERCE_DOCUMENT_ISSUED', actorId: actor(viewer), payload: { businessId: business.id, orderId: data.orderId, documentType: data.documentType, documentNumber: number, sequenceNumber: sequence.lastSequence, idempotencyKey: data.idempotencyKey } })
    return documentDto(created)
  })
}

export async function getBillingDocument(id, { viewer, db = prisma } = {}) {
  const documentId = typeof id === 'string' ? id.trim() : ''
  if (!documentId) throw notFound()
  const row = await db.commerceDocument.findUnique({ where: { id: documentId }, select: DOCUMENT_SELECT })
  if (!row) throw notFound()
  await loadBusiness(db, viewer, row.businessId)
  return documentDto(row)
}

/** Compatibility alias for callers of the audited prototype; it is preview-only. */
export async function generateInvoiceDocument(orderId, { documentType = 'TAX_INVOICE', branchId, customerTaxInfo = {}, viewer, db = prisma } = {}) {
  return previewBillingDocument({
    orderId,
    branchId,
    documentType,
    buyer: { source: customerTaxInfo?.name || customerTaxInfo?.taxId ? 'ISSUANCE_INPUT' : 'ANONYMOUS_WALK_IN', name: customerTaxInfo?.name, taxId: customerTaxInfo?.taxId, branchCode: customerTaxInfo?.branchCode ?? customerTaxInfo?.branch, address: customerTaxInfo?.address },
    includePromptPay: false,
  }, { viewer, db })
}

/** Kept as a small tested helper for legacy callers; POS does not use slip hashes. */
export async function assertSlipNotDuplicate(tx, tenantId, slipHash) {
  const clean = String(slipHash ?? '').trim()
  if (!clean) return
  const existing = await tx.payment.findFirst({ where: { tenantId, bankReference: `HASH:${clean}` }, select: { id: true, code: true } })
  if (existing) throw failure(409, 'SLIP_ALREADY_USED')
}

export { generatePromptPayPayload, calculateThaiVat }
