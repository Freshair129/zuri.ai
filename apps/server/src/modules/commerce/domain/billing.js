import { z } from 'zod'
import { PAYMENT_METHODS } from '@/lib/validation/enums'

// @req FR-186 — the closed document, VAT, PromptPay and buyer vocabulary used
// by the Commerce billing adapter. Values are deliberately kept here rather
// than copied into routes so a preview and an issuance share one parser.
// @spec ADR-065; BR-001; BR-002; SEC-001
// @tested tests/unit/commerce-billing-domain.test.js,
//   tests/integration/fr186-billing.test.js

export const BILLING_DOCUMENT_TYPES = Object.freeze(['INVOICE', 'RECEIPT', 'TAX_INVOICE', 'ABB_TAX_INVOICE'])
export const BILLING_VAT_TREATMENTS = Object.freeze(['INCLUSIVE', 'EXCLUSIVE'])
export const BILLING_BUYER_SOURCES = Object.freeze(['ISSUANCE_INPUT', 'ANONYMOUS_WALK_IN'])
export const BILLING_TARGET_TYPES = Object.freeze(['MOBILE', 'TAX_ID'])
export const BILLING_NON_VAT_POLICIES = Object.freeze(['ALLOW_INVOICE_RECEIPT', 'DENY'])
export const BILLING_WALK_IN_POLICIES = Object.freeze(['ALLOW_ANONYMOUS_RECEIPT', 'DENY'])
export const BILLING_PROMPTPAY_PROVIDER = 'PROMPTPAY'
export const BILLING_ROUNDING = 'ROUND_HALF_UP'
export const DEFAULT_THAI_VAT_RATE_BPS = 700
// Prisma Int columns are signed 32-bit integers in both supported schemas.
// Keep the domain boundary explicit so a valid JavaScript number cannot reach
// a database write that would overflow on PostgreSQL.
export const PRISMA_INT_MAX = 2_147_483_647
export const PRISMA_INT_MIN = -2_147_483_648

const zId = z.string().trim().min(1).max(200)
const zOptionalText = (max) => z.string().trim().max(max).nullable().optional()
const zDate = z.coerce.date()
const zPosMoney = z.number().finite().nonnegative()
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'amounts carry at most two decimals')

function zPosMoneyValue(value) {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-6
}

export const zBillingProfileInput = z.object({
  legalAddress: zOptionalText(1000),
  vatRegistered: z.boolean().optional(),
  vatRateBps: z.number().int().min(0).max(10000).nullable().optional(),
  vatTreatment: z.enum(BILLING_VAT_TREATMENTS).nullable().optional(),
  taxPolicyVersion: zOptionalText(100),
  taxEffectiveAt: zDate.nullable().optional(),
  taxVerifiedAt: zDate.nullable().optional(),
  nonVatDocumentPolicy: z.enum(BILLING_NON_VAT_POLICIES).nullable().optional(),
  walkInDocumentPolicy: z.enum(BILLING_WALK_IN_POLICIES).nullable().optional(),
  promptPayProvider: z.literal(BILLING_PROMPTPAY_PROVIDER).nullable().optional(),
  promptPayTargetType: z.enum(BILLING_TARGET_TYPES).nullable().optional(),
  promptPayTarget: zOptionalText(32),
  promptPayActive: z.boolean().optional(),
  promptPayVerifiedAt: zDate.nullable().optional(),
  active: z.boolean().optional(),
  branchId: zId.optional(),
  branchAddress: zOptionalText(1000),
  taxBranchCode: zOptionalText(20),
  expectedVersion: z.number().int().positive().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.vatRegistered === true && value.vatRateBps !== undefined && value.vatRateBps !== null && value.vatRateBps <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['vatRateBps'], message: 'a VAT-registered profile needs a positive rate' })
  }
  if (value.promptPayTarget !== undefined && value.promptPayTarget !== null && !value.promptPayTargetType) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['promptPayTargetType'], message: 'PromptPay target type is required with a target' })
  }
  if (value.promptPayActive === true && value.promptPayProvider !== BILLING_PROMPTPAY_PROVIDER) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['promptPayProvider'], message: 'an active PromptPay target needs provider PROMPTPAY' })
  }
})

const zBuyer = z.object({
  source: z.enum(BILLING_BUYER_SOURCES).optional(),
  kind: z.enum(BILLING_BUYER_SOURCES).optional(),
  name: zOptionalText(300),
  taxId: zOptionalText(32),
  branchCode: zOptionalText(20),
  address: zOptionalText(1000),
}).strict().superRefine((value, ctx) => {
  if (value.source && value.kind && value.source !== value.kind) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['kind'], message: 'buyer source and kind must agree' })
  }
  if (!value.source && !value.kind) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['source'], message: 'buyer source is required' })
  }
})

export const zBillingDocumentRequest = z.object({
  orderId: zId,
  branchId: zId,
  documentType: z.enum(BILLING_DOCUMENT_TYPES),
  idempotencyKey: zId.max(200).optional(),
  buyer: zBuyer,
  includePromptPay: z.boolean().optional(),
}).strict()

export const zPosCheckout = z.object({
  businessId: zId,
  branchId: zId,
  warehouseLocationId: zId,
  terminalLabel: zOptionalText(100),
  customerId: zId.nullable().optional(),
  lines: z.array(z.object({
    productId: zId.nullable().optional(),
    description: z.string().trim().min(1).max(300).optional(),
    qty: z.number().int().positive().max(PRISMA_INT_MAX).refine(Number.isSafeInteger, 'quantity must be a safe integer'),
    unitPrice: z.number().finite().nonnegative().refine(zPosMoneyValue, 'amounts carry at most two decimals'),
    discount: z.number().finite().nonnegative().refine(zPosMoneyValue, 'amounts carry at most two decimals').optional(),
  }).strict().superRefine((line, ctx) => {
    if (!line.productId && !line.description) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['description'], message: 'a line without a product needs a description' })
    if ((line.discount ?? 0) > line.qty * line.unitPrice + 1e-9) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['discount'], message: 'a line discount cannot exceed the line amount' })
  })).min(1).max(200),
  payment: z.object({
    method: z.enum(PAYMENT_METHODS),
    receivedAmount: zPosMoney.optional(),
    amount: zPosMoney.refine((v) => v > 0, 'amount must be positive').optional(),
    bankReference: z.string().trim().min(1).max(100).nullable().optional(),
    slipFileAssetId: zId.nullable().optional(),
    note: zOptionalText(500),
  }).strict(),
}).strict()

/** Positive integer division rounded half up. Inputs stay integer satang. */
export function roundHalfUp(numerator, denominator) {
  const n = typeof numerator === 'bigint' ? numerator : BigInt(numerator)
  const d = typeof denominator === 'bigint' ? denominator : BigInt(denominator)
  if (n < 0n || d <= 0n) throw new Error('roundHalfUp accepts a non-negative numerator and positive denominator')
  return Number((n * 2n + d) / (2n * d))
}

export function assertInt32(value, message = 'integer exceeds the persisted range') {
  const n = Number(value)
  if (!Number.isInteger(n) || n < PRISMA_INT_MIN || n > PRISMA_INT_MAX) throw new Error(message)
  return n
}

export function assertNonNegativeInt32(value, message = 'amount must fit the persisted integer range') {
  const n = assertInt32(value, message)
  if (n < 0) throw new Error(message)
  return n
}

function integerSatang(value) {
  return assertNonNegativeInt32(value, 'amount must be a non-negative integer number of satang')
}

function rateToBps({ rateBps, rate } = {}) {
  if (rateBps !== undefined) {
    if (!Number.isSafeInteger(rateBps) || rateBps < 0 || rateBps > 10000) throw new Error('VAT rate must be an integer from 0 to 10000 basis points')
    return rateBps
  }
  if (rate === undefined) return DEFAULT_THAI_VAT_RATE_BPS
  const n = Number(rate)
  if (!Number.isFinite(n) || n < 0) throw new Error('VAT rate must be finite and non-negative')
  // `rate` remains a small compatibility convenience for pure callers: 0.07
  // means 7%, while 7 means 7%. Persisted configuration uses rateBps only.
  const bps = n <= 1 ? Math.round(n * 10000) : Math.round(n * 100)
  if (bps < 0 || bps > 10000 || Math.abs((n <= 1 ? n * 10000 : n * 100) - bps) > 1e-8) throw new Error('VAT rate must resolve to whole basis points')
  return bps
}

/** Document-level VAT in integer satang with one ROUND_HALF_UP operation. */
export function calculateThaiVat(amountSatang, { inclusive = true, vatTreatment, rateBps, rate } = {}) {
  const grossOrNet = integerSatang(amountSatang)
  const bps = rateToBps({ rateBps, rate })
  const useInclusive = vatTreatment ? vatTreatment === 'INCLUSIVE' : inclusive !== false
  const denominator = 10000 + bps
  if (useInclusive) {
    const netSatang = roundHalfUp(BigInt(grossOrNet) * 10000n, denominator)
    const vatSatang = grossOrNet - netSatang
    assertNonNegativeInt32(netSatang)
    assertNonNegativeInt32(vatSatang)
    return {
      vatTreatment: 'INCLUSIVE',
      vatRateBps: bps,
      rounding: BILLING_ROUNDING,
      netSatang,
      vatSatang,
      grossSatang: grossOrNet,
      net: netSatang / 100,
      vat: vatSatang / 100,
      gross: grossOrNet / 100,
    }
  }
  const vatSatang = roundHalfUp(BigInt(grossOrNet) * BigInt(bps), 10000n)
  const grossSatang = assertNonNegativeInt32(grossOrNet + vatSatang, 'VAT gross exceeds the persisted integer range')
  assertNonNegativeInt32(vatSatang)
  return {
    vatTreatment: 'EXCLUSIVE',
    vatRateBps: bps,
    rounding: BILLING_ROUNDING,
    netSatang: grossOrNet,
    vatSatang,
    grossSatang,
    net: grossOrNet / 100,
    vat: vatSatang / 100,
    gross: grossSatang / 100,
  }
}

function digitsOnly(value) {
  const text = String(value ?? '').trim()
  if (!text || !/^[0-9\s-]+$/.test(text)) throw new Error('PromptPay target contains non-numeric characters')
  return text.replace(/[\s-]/g, '')
}

/** Normalize and validate the selected Thai QR target; never invents a target. */
export function normalizePromptPayTarget(targetType, target) {
  if (!BILLING_TARGET_TYPES.includes(targetType)) throw new Error('PROMPTPAY_TARGET_INVALID')
  const digits = digitsOnly(target)
  if (targetType === 'MOBILE') {
    if (/^0[689][0-9]{8}$/.test(digits)) return { targetType, value: `0066${digits.slice(1)}` }
    if (/^0066[689][0-9]{8}$/.test(digits)) return { targetType, value: digits }
    throw new Error('PROMPTPAY_TARGET_INVALID')
  }
  if (!/^[0-9]{13}$/.test(digits)) throw new Error('PROMPTPAY_TARGET_INVALID')
  return { targetType, value: digits }
}

export function crc16(value) {
  let crc = 0xffff
  for (let index = 0; index < value.length; index += 1) {
    crc ^= value.charCodeAt(index) << 8
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

/** Generate a local EMVCo PromptPay payload from an already selected target. */
export function generatePromptPayPayload(target, amountBaht, { targetType } = {}) {
  const raw = digitsOnly(target)
  const resolvedType = targetType ?? (raw.startsWith('0066') ? 'MOBILE' : raw.length === 13 ? 'TAX_ID' : 'MOBILE')
  const normalized = normalizePromptPayTarget(resolvedType, raw)
  const targetTag = normalized.targetType === 'MOBILE' ? '01' : '02'
  const accountValue = `0016A000000677010111${targetTag}${String(normalized.value.length).padStart(2, '0')}${normalized.value}`
  let payload = `00020101021129${String(accountValue.length).padStart(2, '0')}${accountValue}5303764`
  if (amountBaht !== undefined && amountBaht !== null) {
    const amount = Number(amountBaht)
    if (!Number.isFinite(amount) || amount < 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) throw new Error('amount must have at most two decimals')
    if (amount > 0) {
      const formatted = (Math.round(amount * 100) / 100).toFixed(2)
      payload += `54${String(formatted.length).padStart(2, '0')}${formatted}`
    }
  }
  const body = `${payload}5802TH6304`
  return `${body}${crc16(body)}`
}

/** Resolve a configured, active and verified recipient for a QR request. */
export function promptPayPayloadForProfile(profile, amountSatang) {
  if (!profile || profile.active !== true || profile.promptPayProvider !== BILLING_PROMPTPAY_PROVIDER || profile.promptPayActive !== true || !profile.promptPayVerifiedAt) throw Object.assign(new Error('PROMPTPAY_NOT_CONFIGURED'), { status: 422 })
  let normalized
  try {
    normalized = normalizePromptPayTarget(profile.promptPayTargetType, profile.promptPayTarget)
  } catch {
    throw Object.assign(new Error('PROMPTPAY_TARGET_INVALID'), { status: 422 })
  }
  return {
    provider: BILLING_PROMPTPAY_PROVIDER,
    targetType: normalized.targetType,
    generated: true,
    payload: generatePromptPayPayload(normalized.value, Number(amountSatang) / 100, { targetType: normalized.targetType }),
    amountSatang: integerSatang(amountSatang),
  }
}

export function buyerSource(buyer) {
  return buyer?.source ?? buyer?.kind ?? null
}

export function billingProfileStatus(profile) {
  if (!profile || profile.active !== true) return 'UNAVAILABLE'
  return 'CONFIGURED'
}
