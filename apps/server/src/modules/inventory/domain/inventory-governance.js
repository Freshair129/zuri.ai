import { z } from 'zod'
import {
  INVENTORY_HYGIENE_FINDING_KINDS,
  INVENTORY_IDENTIFIER_KINDS,
  INVENTORY_PRODUCT_NATURES,
  INVENTORY_PRODUCT_STATUSES,
  INVENTORY_STOCK_POLICIES,
  INVENTORY_UNIT_USAGES,
} from '@/lib/validation/enums'

// @req FR-201 — the nature rule: a master declares GOOD or SERVICE once, and
//   the policy a SKU may carry follows from it. A service is never a variant
//   of a good, and a good is never filed under a service master (BR-038).
// @req FR-202 — variant identity, the anti-SKU-bloat key: the master's axes,
//   the SKU's values on them, the normalized `variantKey` that is unique per
//   master, and the exact-match lookalike fingerprint for masters that declare
//   no axes (BR-039).
// @req FR-203 — product identifiers: the kinds, the GTIN check digit, and the
//   rule that a scannable value is one thing regardless of its label (BR-002).
// @req FR-204 — unit conversions: a pack size is an integer factor on the SKU,
//   never a second SKU, and the ledger counts base units only (BR-037).
// @req FR-205 — the SKU lifecycle: which action is allowed from which status,
//   the archive guard, and the merge rule (BR-040).
// @req FR-206 — the catalogue hygiene report as a pure function over the
//   catalogue and the ledger, so a page and a test agree on every finding.
// @req FR-207 — replenishment parameters and the suggestion they yield.
// @spec ADR-083 D1..D6; BR-002, BR-037, BR-038, BR-039, BR-040
// @tested tests/unit/inventory-governance.test.js

export const PRODUCT_IDENTIFIER_ENTITY = 'PRODUCT_IDENTIFIER'
export const PRODUCT_UNIT_CONVERSION_ENTITY = 'PRODUCT_UNIT_CONVERSION'

export const INVENTORY_LIVE_PRODUCT_STATUSES = Object.freeze(INVENTORY_PRODUCT_STATUSES.filter((s) => s !== 'ARCHIVED'))
/** The two identifier kinds a scanner produces; they share one value space (ADR-083 D3). */
export const INVENTORY_SCANNABLE_IDENTIFIER_KINDS = Object.freeze(['GTIN', 'BARCODE'])
export const DEFAULT_DORMANT_DAYS = 180

const zId = z.string().trim().min(1).max(200)
const zText = (max) => z.string().trim().min(1).max(max)
const zOptionalText = (max) => z.string().trim().max(max).nullable().optional()

// ── Normalization ───────────────────────────────────────────────────────────

/**
 * One normalization for every identity comparison in the catalogue: NFC,
 * lower-case, and everything that is not a letter, a combining mark or a digit
 * removed. `Tumbler  Black`, `tumbler-black` and `TUMBLER BLACK` become one
 * token; Thai tone marks are marks and survive. Empty in, empty out.
 */
export function normalizeToken(value) {
  if (value === null || value === undefined) return ''
  return String(value).normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '')
}

// ── FR-201 — nature at the master ───────────────────────────────────────────

export const zProductNature = z.enum(INVENTORY_PRODUCT_NATURES)
/** A GOOD master's default for a SKU that names no policy; a SERVICE master has no choice to default. */
export const zDefaultStockPolicy = z.enum(INVENTORY_STOCK_POLICIES.filter((p) => p !== 'SERVICE'))

/**
 * The policy a SKU under this master may carry. A SERVICE master yields
 * SERVICE and refuses anything else; a GOOD master yields the requested
 * TRACKED / UNTRACKED (or its default) and refuses SERVICE.
 */
export function natureRule(master, requestedPolicy) {
  const nature = master?.nature ?? 'GOOD'
  if (nature === 'SERVICE') {
    if (requestedPolicy && requestedPolicy !== 'SERVICE') return { ok: false, code: 'INVENTORY_NATURE_MISMATCH', stockPolicy: null }
    return { ok: true, code: null, stockPolicy: 'SERVICE' }
  }
  if (requestedPolicy === 'SERVICE') return { ok: false, code: 'INVENTORY_NATURE_MISMATCH', stockPolicy: null }
  return { ok: true, code: null, stockPolicy: requestedPolicy ?? master?.defaultStockPolicy ?? 'TRACKED' }
}

/** Whether a SKU's stored policy agrees with its master's nature (the hygiene report's NATURE_MISMATCH). */
export function natureAgrees(masterNature, stockPolicy) {
  if ((masterNature ?? 'GOOD') === 'SERVICE') return stockPolicy === 'SERVICE'
  return stockPolicy !== 'SERVICE'
}

// ── FR-202 — variant identity ───────────────────────────────────────────────

export const VARIANT_AXIS_PATTERN = /^[a-z][a-z0-9_]{0,31}$/
export const zVariantAxes = z.array(z.string().trim().regex(VARIANT_AXIS_PATTERN, 'an axis is a lower-case identifier, e.g. color or pack_size')).max(8)
  .refine((axes) => new Set(axes).size === axes.length, 'an axis appears once')
export const zVariant = z.record(z.string().trim().regex(VARIANT_AXIS_PATTERN), z.string().trim().min(1).max(100))

/** The legacy descriptive columns that stand in for a same-named axis when `variant` does not name it. */
const LEGACY_AXIS_COLUMNS = Object.freeze(['color', 'material'])

/** `ProductMaster.variantAxesJson` as the array it stores; anything unreadable is "no axes". */
export function parseVariantAxes(json) {
  try {
    const value = JSON.parse(json || '[]')
    return Array.isArray(value) ? value.filter((axis) => typeof axis === 'string' && VARIANT_AXIS_PATTERN.test(axis)) : []
  } catch {
    return []
  }
}

/** `Product.variantJson` as the map it stores; anything unreadable is an empty variant. */
export function parseVariant(json) {
  try {
    const value = JSON.parse(json || '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === 'string'))
  } catch {
    return {}
  }
}

/**
 * The value of every declared axis for one SKU: `variant[axis]` first, the
 * legacy `color` / `material` column when the axis has that name and the
 * variant is silent. Reports the axes no value covers and the variant keys
 * that name no declared axis, so the caller refuses by code rather than
 * storing a key the master does not know.
 */
export function variantValues(axes = [], { variant = {}, color = null, material = null } = {}) {
  const values = {}
  const missing = []
  const legacy = { color, material }
  for (const axis of axes) {
    const given = variant?.[axis]
    const value = given !== undefined && given !== null && String(given).trim() !== ''
      ? String(given).trim()
      : (LEGACY_AXIS_COLUMNS.includes(axis) && legacy[axis] ? String(legacy[axis]).trim() : null)
    if (value === null) missing.push(axis)
    else values[axis] = value
  }
  const extra = Object.keys(variant || {}).filter((key) => !axes.includes(key))
  return { values, missing, extra }
}

/**
 * The normalized fingerprint of one variant combination, in axis order —
 * `color=black|size=m`. Null when the master declares no axes: such a master
 * has no variant identity to enforce, and the lookalike guard is what it gets.
 */
export function variantKeyFor(axes = [], values = {}) {
  if (!axes.length) return null
  return axes.map((axis) => `${axis}=${normalizeToken(values[axis])}`).join('|')
}

/**
 * The exact-match lookalike fingerprint: name, colour, material and variant
 * key, normalized. Null when none of them says anything, because an empty
 * description carries no evidence of duplication.
 */
export function lookalikeFingerprint({ name, color, material, variantKey } = {}) {
  const parts = [normalizeToken(name), normalizeToken(color), normalizeToken(material), variantKey ?? '']
  if (parts.every((p) => p === '')) return null
  return parts.join('|')
}

// ── FR-203 — identifiers ────────────────────────────────────────────────────

export const zIdentifierKind = z.enum(INVENTORY_IDENTIFIER_KINDS)

/** GS1 mod-10: 8, 12, 13 or 14 digits whose last digit checks. EAN-13 is GTIN-13, UPC-A is GTIN-12. */
export function isValidGtin(value) {
  const digits = String(value ?? '').trim()
  if (!/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(digits)) return false
  const body = digits.slice(0, -1).split('').map(Number).reverse()
  const sum = body.reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1))
}

const zIdentifierValue = z.string().trim().min(1).max(100).regex(/^\S+$/, 'an identifier carries no whitespace')

export const zCreateIdentifier = z.object({
  businessId: zId,
  kind: zIdentifierKind,
  value: zIdentifierValue,
  issuer: zOptionalText(100),
  unit: zOptionalText(20),
}).strict().superRefine((value, ctx) => {
  if (value.kind === 'GTIN' && !isValidGtin(value.value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'a GTIN is 8, 12, 13 or 14 digits with a valid check digit' })
  }
})

export const zIdentifierAction = z.object({
  identifierId: zId,
  action: z.literal('RETIRE'),
  version: z.number().int().positive(),
}).strict()

/**
 * Whether `value` may be recorded under `kind` given the identifiers already
 * held in the Tenant. A scannable value is one thing whatever its label, so a
 * GTIN on one SKU blocks the same digits as a BARCODE on another; the other
 * kinds collide only with themselves.
 */
export function identifierCollision(kind, value, existing = []) {
  const scannable = INVENTORY_SCANNABLE_IDENTIFIER_KINDS.includes(kind)
  return existing.find((row) => row.value === value && (row.kind === kind || (scannable && INVENTORY_SCANNABLE_IDENTIFIER_KINDS.includes(row.kind)))) ?? null
}

// ── FR-204 — unit conversions ───────────────────────────────────────────────

export const UNIT_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/
export const zUnitCode = z.string().trim().regex(UNIT_CODE_PATTERN, 'a unit is 1–20 letters, digits, ".", "-" or "_"')
export const zUnitUsage = z.enum(INVENTORY_UNIT_USAGES)

export const zCreateUnitConversion = z.object({
  businessId: zId,
  unit: zUnitCode,
  name: zOptionalText(100),
  factor: z.number().int().positive().max(1_000_000),
  usage: zUnitUsage.optional(),
}).strict()

export const zUnitConversionAction = z.object({
  conversionId: zId,
  action: z.enum(['RETIRE', 'UPDATE']),
  version: z.number().int().positive(),
  fields: z.object({ name: zOptionalText(100), factor: z.number().int().positive().max(1_000_000), usage: zUnitUsage }).partial().strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.action === 'UPDATE' && (!value.fields || Object.keys(value.fields).length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fields'], message: 'fields is required for UPDATE' })
  }
})

/**
 * The base quantity a caller's `quantity` in `unit` means for this product.
 * The base unit passes through; another unit needs an ACTIVE conversion and a
 * factor; a serial-tracked product accepts no unit but its own, because one
 * serial is one unit by definition. Signs are preserved (an ADJUSTMENT).
 */
export function toBaseQuantity(product, quantity, unit, conversions = []) {
  const qty = Number.isFinite(quantity) ? Math.trunc(quantity) : 0
  const wanted = typeof unit === 'string' ? unit.trim() : ''
  if (!wanted || wanted === product?.unit) return { ok: true, code: null, quantity: qty, factor: 1, unit: product?.unit ?? null }
  if (product?.trackingMode === 'SERIAL') return { ok: false, code: 'INVENTORY_UNIT_NOT_FOR_SERIAL', quantity: null, factor: null, unit: wanted }
  const conversion = conversions.find((c) => c.unit === wanted && (c.status ?? 'ACTIVE') === 'ACTIVE')
  if (!conversion) return { ok: false, code: 'INVENTORY_UNIT_UNKNOWN', quantity: null, factor: null, unit: wanted }
  return { ok: true, code: null, quantity: qty * conversion.factor, factor: conversion.factor, unit: wanted }
}

// ── FR-205 — lifecycle ──────────────────────────────────────────────────────

/**
 * Whether `action` may run on a product in its current status, before any
 * ledger question is asked. MERGE and ARCHIVE additionally consult
 * `mergeRule` / the on-hand guard in the service.
 */
export function productLifecycleRule(product, action) {
  if (!product) return { ok: false, code: 'INVENTORY_PRODUCT_NOT_FOUND' }
  const status = product.status ?? 'ACTIVE'
  if (product.mergedIntoProductId) return { ok: false, code: 'INVENTORY_PRODUCT_MERGED' }
  switch (action) {
    case 'UPDATE':
    case 'PHASE_OUT':
      return status === 'ACTIVE' || (action === 'UPDATE' && status === 'PHASE_OUT')
        ? { ok: true, code: null }
        : { ok: false, code: status === 'ARCHIVED' ? 'PRODUCT_ARCHIVED' : 'INVENTORY_PRODUCT_PHASED_OUT' }
    case 'ARCHIVE':
    case 'MERGE':
      return status === 'ARCHIVED' ? { ok: false, code: 'PRODUCT_ARCHIVED' } : { ok: true, code: null }
    case 'REACTIVATE':
      return status === 'ACTIVE' ? { ok: false, code: 'INVENTORY_PRODUCT_ALREADY_ACTIVE' } : { ok: true, code: null }
    default:
      return { ok: false, code: 'INVENTORY_PRODUCT_ACTION_UNKNOWN' }
  }
}

/**
 * The archive guard (BR-040): a counted SKU with stock or live promises stays.
 * `onHand` is null for an uncounted product and never blocks.
 */
export function archiveGuard({ onHand = null, activeReservations = 0 } = {}) {
  if (typeof onHand === 'number' && onHand > 0) return { ok: false, code: 'INVENTORY_PRODUCT_HAS_STOCK' }
  if (activeReservations > 0) return { ok: false, code: 'INVENTORY_PRODUCT_HAS_RESERVATIONS' }
  return { ok: true, code: null }
}

/**
 * Whether `duplicate` may be merged into `survivor`, and whether stock moves.
 * Same Business, same nature, a living survivor; stock moves only between two
 * TRACKED / NONE products — a lot- or serial-tracked duplicate is emptied by a
 * person first, because a merge cannot decide which lot or serial the units
 * were. Live reservations on the duplicate block, exactly as an archive does.
 */
export function mergeRule(duplicate, survivor, { onHand = null, activeReservations = 0 } = {}) {
  if (!survivor) return { ok: false, code: 'INVENTORY_MERGE_TARGET_NOT_FOUND', movesStock: false }
  if (survivor.id === duplicate.id) return { ok: false, code: 'INVENTORY_MERGE_INTO_SELF', movesStock: false }
  if (survivor.businessId !== duplicate.businessId) return { ok: false, code: 'INVENTORY_MERGE_TARGET_NOT_FOUND', movesStock: false }
  if (survivor.status !== 'ACTIVE' || survivor.mergedIntoProductId) return { ok: false, code: 'INVENTORY_MERGE_TARGET_NOT_ACTIVE', movesStock: false }
  if (survivor.stockPolicy !== duplicate.stockPolicy) return { ok: false, code: 'INVENTORY_MERGE_NATURE_MISMATCH', movesStock: false }
  if (activeReservations > 0) return { ok: false, code: 'INVENTORY_PRODUCT_HAS_RESERVATIONS', movesStock: false }
  const stock = typeof onHand === 'number' ? onHand : 0
  if (stock > 0) {
    const plain = (p) => p.stockPolicy === 'TRACKED' && p.trackingMode === 'NONE'
    if (!plain(duplicate) || !plain(survivor)) return { ok: false, code: 'INVENTORY_MERGE_REQUIRES_EMPTY_STOCK', movesStock: false }
    return { ok: true, code: null, movesStock: true }
  }
  return { ok: true, code: null, movesStock: false }
}

// ── FR-207 — replenishment ──────────────────────────────────────────────────

export const zReplenishmentFields = z.object({
  reorderPoint: z.number().int().nonnegative().nullable().optional(),
  reorderQty: z.number().int().positive().nullable().optional(),
  leadTimeDays: z.number().int().nonnegative().max(3650).nullable().optional(),
}).strict()

/**
 * One replenishment row, or null when the product needs none: only a counted,
 * ACTIVE SKU below `reorderPoint ?? safetyStock` is suggested, and the
 * quantity is the declared `reorderQty` or the gap back to the threshold.
 */
export function replenishmentRow(product, onHand) {
  if (!product || product.stockPolicy !== 'TRACKED' || (product.status ?? 'ACTIVE') !== 'ACTIVE') return null
  if (typeof onHand !== 'number') return null
  const threshold = product.reorderPoint ?? product.safetyStock ?? 0
  if (onHand >= threshold) return null
  return {
    productId: product.id,
    code: product.code,
    name: product.name ?? null,
    unit: product.unit ?? null,
    onHand,
    threshold,
    reorderPoint: product.reorderPoint ?? null,
    safetyStock: product.safetyStock ?? 0,
    suggestedQty: product.reorderQty ?? (threshold - onHand),
    leadTimeDays: product.leadTimeDays ?? null,
  }
}

// ── FR-206 — the hygiene report ─────────────────────────────────────────────

const SEVERITY = Object.freeze({
  NATURE_MISMATCH: 'HIGH',
  LOOKALIKE_SKUS: 'HIGH',
  MASTER_WITHOUT_AXES: 'MEDIUM',
  DORMANT_SKU: 'MEDIUM',
  MASTER_WITHOUT_SKUS: 'LOW',
  SKU_WITHOUT_IDENTIFIER: 'LOW',
  SERVICE_WITH_STOCK_FIELDS: 'LOW',
  PHASE_OUT_WITH_STOCK: 'INFO',
})

const MESSAGE = Object.freeze({
  NATURE_MISMATCH: 'นโยบายสต๊อกของ SKU ไม่ตรงกับประเภทของสินค้าหลัก (บริการอยู่ใต้สินค้า หรือสินค้าอยู่ใต้บริการ)',
  LOOKALIKE_SKUS: 'SKU หลายตัวใต้สินค้าหลักเดียวกันมีชื่อ/สี/วัสดุ/variant เหมือนกันทุกประการ — น่าจะเป็น SKU ซ้ำ',
  MASTER_WITHOUT_AXES: 'สินค้าหลักมี SKU หลายตัวแต่ยังไม่ประกาศแกน variant จึงยังกันความซ้ำไม่ได้',
  DORMANT_SKU: 'SKU นับสต๊อกที่ยอดเป็นศูนย์และไม่มีความเคลื่อนไหวนานเกินกำหนด',
  MASTER_WITHOUT_SKUS: 'สินค้าหลักที่ไม่มี SKU ใช้งานอยู่เลย',
  SKU_WITHOUT_IDENTIFIER: 'SKU นับสต๊อกที่ยังไม่มีบาร์โค้ดหรือรหัสคู่ค้า จึงสแกนหรือ resolve ไม่ได้',
  SERVICE_WITH_STOCK_FIELDS: 'บริการที่ยังมีค่า safety stock / tracking / จุดสั่งซื้อ ซึ่งใช้กับบริการไม่ได้',
  PHASE_OUT_WITH_STOCK: 'SKU ที่กำลังเลิกขายแต่ยังมีของคงเหลือ — ขายให้หมดก่อน archive',
})

const SUGGESTION = Object.freeze({
  NATURE_MISMATCH: 'MOVE_TO_MASTER_OF_SAME_NATURE',
  LOOKALIKE_SKUS: 'MERGE',
  MASTER_WITHOUT_AXES: 'DECLARE_VARIANT_AXES',
  DORMANT_SKU: 'PHASE_OUT_OR_ARCHIVE',
  MASTER_WITHOUT_SKUS: 'ARCHIVE_MASTER_OR_ADD_SKU',
  SKU_WITHOUT_IDENTIFIER: 'ADD_IDENTIFIER',
  SERVICE_WITH_STOCK_FIELDS: 'CLEAR_STOCK_FIELDS',
  PHASE_OUT_WITH_STOCK: 'SELL_DOWN',
})

const DAY_MS = 86_400_000
const live = (p) => (p.status ?? 'ACTIVE') !== 'ARCHIVED'

function finding(kind, rows, extra = {}) {
  return {
    kind,
    severity: SEVERITY[kind],
    message: MESSAGE[kind],
    suggestion: SUGGESTION[kind],
    productIds: rows.filter((r) => r.productId).map((r) => r.productId),
    codes: rows.map((r) => r.code),
    ...extra,
  }
}

/**
 * Every hygiene finding over one Business's catalogue. Inputs are plain rows:
 * masters `{ id, code, nature, variantAxes, status }`, products
 * `{ id, code, name, color, material, variantKey, productMasterId, stockPolicy,
 *    trackingMode, safetyStock, reorderPoint, reorderQty, leadTimeDays, status,
 *    onHand, lastMovementAt, identifierCount, createdAt }`.
 * Pure: the same rows always yield the same report.
 */
export function hygieneReport({ masters = [], products = [], now = new Date(), dormantDays = DEFAULT_DORMANT_DAYS } = {}) {
  const at = now instanceof Date ? now : new Date(now)
  const findings = []
  const masterById = new Map(masters.map((m) => [m.id, m]))
  const liveByMaster = new Map()
  for (const p of products.filter(live)) {
    if (!liveByMaster.has(p.productMasterId)) liveByMaster.set(p.productMasterId, [])
    liveByMaster.get(p.productMasterId).push(p)
  }

  for (const p of products.filter(live)) {
    const master = masterById.get(p.productMasterId)
    if (master && !natureAgrees(master.nature, p.stockPolicy)) {
      findings.push(finding('NATURE_MISMATCH', [{ productId: p.id, code: p.code }], { masterId: master.id, masterNature: master.nature ?? 'GOOD', stockPolicy: p.stockPolicy }))
    }
    if (p.stockPolicy === 'SERVICE' && ((p.safetyStock ?? 0) > 0 || (p.trackingMode && p.trackingMode !== 'NONE') || p.reorderPoint != null || p.reorderQty != null || p.leadTimeDays != null)) {
      findings.push(finding('SERVICE_WITH_STOCK_FIELDS', [{ productId: p.id, code: p.code }]))
    }
    if (p.stockPolicy === 'TRACKED' && typeof p.onHand === 'number') {
      if (p.status === 'PHASE_OUT' && p.onHand > 0) findings.push(finding('PHASE_OUT_WITH_STOCK', [{ productId: p.id, code: p.code }], { onHand: p.onHand }))
      const anchor = p.lastMovementAt ?? p.createdAt
      const ageDays = anchor ? Math.floor((at.getTime() - new Date(anchor).getTime()) / DAY_MS) : null
      if (p.onHand === 0 && ageDays !== null && ageDays >= dormantDays) {
        findings.push(finding('DORMANT_SKU', [{ productId: p.id, code: p.code }], { idleDays: ageDays, lastMovementAt: p.lastMovementAt ?? null }))
      }
      if ((p.identifierCount ?? 0) === 0) findings.push(finding('SKU_WITHOUT_IDENTIFIER', [{ productId: p.id, code: p.code }]))
    }
  }

  for (const [masterId, rows] of liveByMaster) {
    const groups = new Map()
    for (const p of rows) {
      const key = lookalikeFingerprint(p)
      if (!key) continue
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(p)
    }
    for (const [fingerprint, group] of groups) {
      if (group.length < 2) continue
      findings.push(finding('LOOKALIKE_SKUS', group.map((p) => ({ productId: p.id, code: p.code })), { masterId, fingerprint }))
    }
  }

  for (const m of masters) {
    if ((m.status ?? 'ACTIVE') === 'ARCHIVED') continue
    const rows = liveByMaster.get(m.id) ?? []
    const axes = Array.isArray(m.variantAxes) ? m.variantAxes : []
    if (!rows.length) findings.push(finding('MASTER_WITHOUT_SKUS', [{ code: m.code }], { masterId: m.id }))
    else if ((m.nature ?? 'GOOD') === 'GOOD' && rows.length >= 2 && !axes.length) {
      findings.push(finding('MASTER_WITHOUT_AXES', rows.map((p) => ({ productId: p.id, code: p.code })), { masterId: m.id, masterCode: m.code }))
    }
  }

  const order = { HIGH: 0, MEDIUM: 1, LOW: 2, INFO: 3 }
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.kind.localeCompare(b.kind) || (a.codes[0] ?? '').localeCompare(b.codes[0] ?? ''))
  const counts = Object.fromEntries(INVENTORY_HYGIENE_FINDING_KINDS.map((kind) => [kind, 0]))
  const bySeverity = { HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 }
  for (const f of findings) { counts[f.kind] += 1; bySeverity[f.severity] += 1 }
  return { generatedAt: at.toISOString(), dormantDays, counts, bySeverity, total: findings.length, findings }
}
