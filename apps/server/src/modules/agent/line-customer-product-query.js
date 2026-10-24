import { parseNaturalProductFacts } from './line-product-facts-language'

// @req FR-235, FR-049 — exact selected public aliases, never semantic identity inference.
// @tested tests/unit/line-customer-product-query.test.js
export function parseCustomerProductQuestion(question) {
  if (typeof question !== 'string' || !question.trim() || question.length > 2048
    || /[\p{Cc}\p{Cf}]|[{}\[\]`=<>\\]|https?:|(?:\s|^)(?:and|or)(?:\s|$)|และ|หรือ/iu.test(question)
    || parseNaturalProductFacts(question) !== null || question.trimStart().startsWith('#')) return null
  const text = question.normalize('NFC').trim()
  const fields = /น้ำหนัก|\bweight\b/iu.test(text) ? ['unitWeightKg']
    : /ขนาด|มิติ|\bdimensions?\b/iu.test(text) ? ['dimensionsCm']
    : /หมวด|\bcategory\b/iu.test(text) ? ['category']
    : /กลุ่มสินค้า|\bfamily\b/iu.test(text) ? ['productFamily']
    : /หน่วย|\bunit\b/iu.test(text) ? ['unit']
    : /ชื่อ|\bname\b/iu.test(text) ? ['nameTh','nameEn']
    : /รหัส|\bsku\b/iu.test(text) ? ['sku'] : null
  let alias = text.replace(/^(?:ขอ)?(?:ทราบ)?(?:ข้อมูล|รายละเอียด|ชื่อ|น้ำหนัก|ขนาด|มิติ|หมวด|กลุ่ม|หน่วย|รหัส)?\s*(?:สินค้า|ผลิตภัณฑ์)\s*/u, '')
  alias = alias.replace(/^(?:product|item|sku)\s+/iu, '')
    .replace(/\s+(?:ชื่ออะไร|คืออะไร|ขนาด|น้ำหนัก|หมวด|หน่วย|รหัส|name|weight|dimensions?)\s*[?？]?$/iu, '')
    .replace(/[?？]$/u,'').trim()
  if (!alias || alias.length > 500 || !/^[\p{L}\p{M}\p{N} .,_()/-]+$/u.test(alias)) return null
  return { alias, fields }
}
