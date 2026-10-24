// @req FR-235 — one browser-safe vocabulary; field names never grant disclosure.
// @tested tests/unit/line-product-disclosure-contract.test.js, tests/unit/line-product-disclosure-ui.test.js
export const DISCLOSURE_FIELDS = Object.freeze([
  'sku','nameTh','nameEn','unit','category','productFamily','dimensionsCm','unitWeightKg',
])
export const DISCLOSURE_FIELD_LABELS = Object.freeze({
  sku:'รหัสสินค้า',nameTh:'ชื่อสินค้า',nameEn:'ชื่อสินค้า (อังกฤษ)',unit:'หน่วย',
  category:'หมวดหมู่',productFamily:'กลุ่มสินค้า',dimensionsCm:'ขนาด',unitWeightKg:'น้ำหนักต่อหน่วย',
})
