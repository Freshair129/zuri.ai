import { INVENTORY_IDENTIFIER_KINDS, INVENTORY_UNIT_USAGES } from '@/lib/validation/enums'
import { isValidGtin, toBaseQuantity } from '../domain/inventory-governance'

// @req FR-203 — the console's view of a SKU's identifiers: Thai labels for the
//   five kinds, the problem a value has before it is sent (a GTIN whose check
//   digit fails is caught in the form, not only by the server), and the Thai
//   text for every refusal the identifier routes return.
// @req FR-204 — the console's view of unit conversions: the units a form may
//   offer for a product (base unit first, a serial product offers only its
//   base), the "1 BOX12 = 12 EA" label, and the base-unit preview a movement
//   form shows before it posts. The preview uses the domain's own
//   `toBaseQuantity`, so the number the form shows is the number the ledger
//   will write.
// Pure: no fetch, no React. The pages call the routes; these decide what to say.
// @spec ADR-083 D3, D4; BR-002, BR-037; SEC-001
// @tested tests/unit/inventory-sku-console.test.js

export const IDENTIFIER_KIND_LABEL = Object.freeze({
  GTIN: 'GTIN / EAN / UPC',
  BARCODE: 'บาร์โค้ดอื่น',
  SUPPLIER_CODE: 'รหัสซัพพลายเออร์',
  MANUFACTURER_PART: 'รหัสผู้ผลิต (MPN)',
  LEGACY_CODE: 'รหัสเดิม',
})
export const IDENTIFIER_KIND_OPTIONS = Object.freeze(INVENTORY_IDENTIFIER_KINDS.map((kind) => [kind, IDENTIFIER_KIND_LABEL[kind]]))

export const UNIT_USAGE_LABEL = Object.freeze({ PURCHASE: 'ใช้ตอนซื้อ', SALES: 'ใช้ตอนขาย', ANY: 'ใช้ได้ทุกงาน' })
export const UNIT_USAGE_OPTIONS = Object.freeze(INVENTORY_UNIT_USAGES.map((usage) => [usage, UNIT_USAGE_LABEL[usage]]))

export const RECORD_STATUS_LABEL = Object.freeze({ ACTIVE: 'ใช้งาน', RETIRED: 'ยกเลิกแล้ว' })

/**
 * What is wrong with an identifier value before it is sent, in Thai, or null.
 * Mirrors the server's contract (non-empty, no whitespace, a GTIN checks) so a
 * mistyped barcode is caught at the keyboard.
 */
export function identifierInputProblem(kind, value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return 'กรอกรหัส'
  if (/\s/.test(text)) return 'รหัสต้องไม่มีช่องว่าง'
  if (text.length > 100) return 'รหัสยาวเกิน 100 ตัวอักษร'
  if (kind === 'GTIN') {
    if (!/^\d{8}$|^\d{12,14}$/.test(text)) return 'GTIN ต้องเป็นตัวเลข 8, 12, 13 หรือ 14 หลัก'
    if (!isValidGtin(text)) return 'เลขตรวจสอบ (check digit) ของ GTIN ไม่ถูกต้อง — ตรวจตัวเลขอีกครั้ง'
  }
  return null
}

/** `1 BOX12 = 12 EA` — the one sentence a conversion row needs. */
export function conversionLabel(conversion, baseUnit) {
  if (!conversion) return ''
  return `1 ${conversion.unit} = ${conversion.factor} ${baseUnit ?? ''}`.trim()
}

/**
 * The units a form may offer for a product: the base unit first, then every
 * ACTIVE conversion whose usage fits (`PURCHASE` shows PURCHASE and ANY; no
 * usage shows all). A serial product and a service offer the base unit only —
 * the ledger would refuse anything else (FR-204).
 */
export function unitsFor(product, conversions = [], usage = null) {
  if (!product) return []
  const base = { unit: product.unit, factor: 1, label: `${product.unit} (หน่วยฐาน)` }
  if (product.trackingMode === 'SERIAL' || product.stockPolicy === 'SERVICE') return [base]
  const fits = (c) => (c.status ?? 'ACTIVE') === 'ACTIVE' && (!usage || c.usage === 'ANY' || c.usage === usage)
  return [base, ...conversions.filter(fits).map((c) => ({ unit: c.unit, factor: c.factor, label: `${c.unit} (${conversionLabel(c, product.unit)})` }))]
}

/**
 * The base quantity a movement form's entry means, and the sentence that says
 * so. Empty when the entry is the base unit or not a number yet — nothing to
 * explain. Uses the domain's `toBaseQuantity`, the same function the stock
 * service calls.
 */
export function baseQuantityPreview(product, quantity, unit, conversions = []) {
  const qty = Number(quantity)
  if (!product || !unit || unit === product.unit || !Number.isFinite(qty) || qty === 0) return { ok: true, quantity: Number.isFinite(qty) ? Math.trunc(qty) : null, text: '' }
  const converted = toBaseQuantity(product, qty, unit, conversions)
  if (!converted.ok) return { ok: false, quantity: null, text: skuConsoleErrorText({ message: converted.code }) }
  return { ok: true, quantity: converted.quantity, text: `= ${Math.abs(converted.quantity)} ${product.unit} ในสต๊อก` }
}

/**
 * Why this SKU's identifiers or conversions cannot be edited from here, or
 * null. The server refuses the same things; saying so up front keeps a form
 * from inviting a click that can only fail.
 */
export function writeBlockReason(product, activeBusinessId) {
  if (!product) return 'กำลังโหลด SKU'
  if (activeBusinessId && product.businessId !== activeBusinessId) return 'SKU นี้อยู่ใน Business อื่น — สลับ Business ให้ตรงก่อนแก้ไข'
  if (product.status === 'ARCHIVED') return product.mergedIntoProductId ? 'SKU นี้ถูกรวมเข้ากับ SKU อื่นแล้ว แก้ไขไม่ได้' : 'SKU นี้ถูกเก็บถาวร แก้ไขไม่ได้'
  return null
}

/** Why this SKU takes no unit conversion at all, or null (FR-204). */
export function conversionBlockReason(product) {
  if (!product) return null
  if (product.stockPolicy === 'SERVICE') return 'บริการไม่มีหน่วยแปลง เพราะไม่มีสต๊อกให้นับ'
  if (product.trackingMode === 'SERIAL') return 'สินค้าที่นับตาม Serial ใช้หน่วยฐานเท่านั้น — หนึ่ง Serial คือหนึ่งหน่วย'
  return null
}

const ERROR_TEXT = Object.freeze({
  INVENTORY_IDENTIFIER_TAKEN: 'รหัสนี้ถูกใช้กับ SKU อื่นแล้ว — หนึ่งรหัสเป็นของ SKU เดียว',
  INVENTORY_UNIT_UNKNOWN: 'หน่วยนี้ยังไม่ได้ประกาศเป็นหน่วยแปลงของ SKU นี้',
  INVENTORY_UNIT_IS_BASE: 'นี่คือหน่วยฐานของ SKU อยู่แล้ว ไม่ต้องประกาศเป็นหน่วยแปลง',
  INVENTORY_UNIT_TAKEN: 'SKU นี้มีหน่วยนี้อยู่แล้ว — แก้ตัวคูณของแถวเดิมแทน',
  INVENTORY_UNIT_NOT_FOR_SERIAL: 'สินค้าที่นับตาม Serial ใช้หน่วยฐานเท่านั้น',
  INVENTORY_PRODUCT_IS_A_SERVICE: 'บริการไม่มีหน่วยแปลง',
  INVENTORY_PRODUCT_NOT_FOUND: 'ไม่พบ SKU นี้ใน Business ที่เลือก',
  INVENTORY_PRODUCT_PHASED_OUT: 'SKU นี้กำลังเลิกขาย รับของเข้าไม่ได้',
  INVENTORY_INSUFFICIENT_STOCK: 'สต๊อกไม่พอสำหรับการจ่ายออก',
  PRODUCT_ARCHIVED: 'SKU นี้ถูกเก็บถาวรแล้ว',
  PRODUCT_IDENTIFIER_RETIRED: 'รหัสนี้ถูกยกเลิกไปแล้ว',
  PRODUCT_UNIT_CONVERSION_RETIRED: 'หน่วยแปลงนี้ถูกยกเลิกไปแล้ว',
  PRODUCT_IDENTIFIER_VERSION_CONFLICT: 'มีคนแก้รหัสนี้ไปก่อนแล้ว — โหลดใหม่แล้วลองอีกครั้ง',
  PRODUCT_UNIT_CONVERSION_VERSION_CONFLICT: 'มีคนแก้หน่วยแปลงนี้ไปก่อนแล้ว — โหลดใหม่แล้วลองอีกครั้ง',
})

/**
 * Thai text for a refusal from the identifier, unit-conversion, product or
 * movement routes. `holder` names the SKU a taken identifier belongs to, when
 * the caller could find out. A 404 is the FR-072 answer and says no more than
 * it does.
 */
export function skuConsoleErrorText(error, { holder = null } = {}) {
  const message = error?.message ?? ''
  if (message === 'INVENTORY_IDENTIFIER_TAKEN' && holder) return `รหัสนี้เป็นของ SKU ${holder} อยู่แล้ว — หนึ่งรหัสเป็นของ SKU เดียว`
  if (ERROR_TEXT[message]) return ERROR_TEXT[message]
  if (error?.status === 404 || message === 'Business not found') return 'ไม่พบรายการใน Business นี้ หรือคุณไม่มีสิทธิ์ดำเนินการ'
  const issues = Array.isArray(error?.issues) ? error.issues : []
  if (issues.some((issue) => /check digit/i.test(issue))) return 'เลขตรวจสอบ (check digit) ของ GTIN ไม่ถูกต้อง'
  if (issues.length) return `ข้อมูลไม่ถูกต้อง: ${issues.join(' · ')}`
  return message || 'ดำเนินการไม่สำเร็จ'
}
