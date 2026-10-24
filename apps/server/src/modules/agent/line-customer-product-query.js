import { parseNaturalProductFacts } from './line-product-facts-language'

// @req FR-235, FR-049 — exact selected public aliases, never semantic identity inference.
// @tested tests/unit/line-customer-product-query.test.js
export function parseCustomerProductQuestion(question) {
  if (typeof question !== 'string' || !question.trim() || question.length > 2048
    || /[\p{Cc}\p{Cf}]|[{}\[\]`=<>\\]|https?:|(?:\s|^)(?:and|or)(?:\s|$)|และ|หรือ/iu.test(question)
    || parseNaturalProductFacts(question) !== null || question.trimStart().startsWith('#')) return null
  const text = question.normalize('NFC').trim()
  const prefix = text.match(/^(?:ขอ)?(?:ทราบ)?(?:ข้อมูล|รายละเอียด|ชื่อ|น้ำหนัก|ขนาด|มิติ|หมวด|กลุ่ม|หน่วย|รหัส)?\s*(?:สินค้า|ผลิตภัณฑ์)\s*/u)?.[0] ?? ''
  let alias = text.slice(prefix.length)
  const englishPrefix = alias.match(/^(?:product|item|sku)\s+/iu)?.[0] ?? ''
  alias = alias.slice(englishPrefix.length)
  const suffix = alias.match(/\s+(?:ชื่ออะไร|คืออะไร|ขนาด|น้ำหนัก|หมวด|หน่วย|รหัส|name|weight|dimensions?)\s*[?？]?$/iu)?.[0] ?? ''
  alias = (suffix ? alias.slice(0, -suffix.length) : alias)
    .replace(/[?？]$/u,'').trim()
  if (!alias || alias.length > 500 || !/^[\p{L}\p{M}\p{N} .,_()/-]+$/u.test(alias)) return null
  // Only question syntax chooses fields; SKU/name text is an opaque exact alias.
  const intent = `${prefix} ${englishPrefix} ${suffix}`
  const fields = /น้ำหนัก|\bweight\b/iu.test(intent) ? ['unitWeightKg']
    : /ขนาด|มิติ|\bdimensions?\b/iu.test(intent) ? ['dimensionsCm']
    : /หมวด|\bcategory\b/iu.test(intent) ? ['category']
    : /กลุ่มสินค้า|\bfamily\b/iu.test(intent) ? ['productFamily']
    : /หน่วย|\bunit\b/iu.test(intent) ? ['unit']
    : /ชื่อ|\bname\b/iu.test(intent) ? ['nameTh','nameEn']
    : /รหัส|\bsku\b/iu.test(intent) ? ['sku'] : null
  return { alias, fields }
}
