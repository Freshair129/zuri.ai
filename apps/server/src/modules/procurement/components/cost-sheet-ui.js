// @req FR-164, FR-154 — the UI keeps person-confirmed Product mappings separate
//   from preview suggestions and submits only confirmed choices.
// @spec ZAI:PROPOSAL-SMARTGIFT-COST-QUOTE-ENGINE-20260913; TASK-ZAI-053; ADR-066
// @tested tests/unit/supplier-cost-sheet-ui.test.js

const ERROR_MESSAGES = Object.freeze({
  'Business not found': 'ไม่พบ Business หรือไม่มีสิทธิ์ Procurement/Inventory สำหรับรายการนี้',
  'Validation failed': 'ข้อมูลไม่ผ่านการตรวจสอบ กรุณาแก้รายการที่แจ้งแล้วลองใหม่',
  PROCUREMENT_COST_WORKBOOK_UNREADABLE: 'อ่านไฟล์ Excel ไม่ได้ กรุณาบันทึกเป็น .xlsx แล้วลองใหม่',
  PROCUREMENT_COST_WORKBOOK_SHEET_MISSING: 'ไม่พบชีต CostSheet ในไฟล์ กรุณาใช้แม่แบบของระบบ',
  PROCUREMENT_COST_WORKBOOK_HEADER_MISMATCH: 'หัวคอลัมน์ไม่ตรงกับแม่แบบ กรุณาดาวน์โหลดแม่แบบใหม่และอย่าแก้หัวตาราง',
  PROCUREMENT_COST_WORKBOOK_EMPTY: 'ไฟล์ไม่มีรายการต้นทุนให้ตรวจสอบ',
  PROCUREMENT_COST_WORKBOOK_TOO_MANY_ROWS: 'ไฟล์มีรายการเกิน 5,000 แถว',
  'multipart form data is required': 'ส่งข้อมูลอัปโหลดไม่สำเร็จ กรุณาเลือกไฟล์แล้วลองใหม่',
  '.xlsx file is required': 'กรุณาเลือกไฟล์นามสกุล .xlsx',
  'Workbook exceeds the 5 MiB limit': 'ไฟล์มีขนาดเกิน 5 MiB กรุณาแบ่งไฟล์แล้วลองใหม่',
  SUPPLIER_NOT_FOUND: 'ไม่พบผู้ขายใน Business นี้ กรุณาเลือกผู้ขายที่ยังใช้งานอยู่',
  SUPPLIER_ARCHIVED: 'ผู้ขายนี้ถูกเก็บถาวรแล้ว กรุณาเลือกผู้ขายที่ยังใช้งานอยู่',
  PROCUREMENT_COST_SHEET_SOURCE_HASH_REUSED: 'ไฟล์เดียวกันเคยบันทึกด้วยข้อมูลผู้ขาย/สกุลเงิน/FX ชุดอื่นแล้ว กรุณาตรวจไฟล์และข้อมูลนำเข้า',
  PROCUREMENT_COST_SHEET_PREVIEW_STALE: 'ผล Preview ไม่ตรงกับข้อมูลปัจจุบัน กรุณาอัปโหลดและตรวจรายการใหม่ก่อนยืนยัน',
  PROCUREMENT_COST_SHEET_SUPERSEDED: 'Cost Sheet นี้ถูกเวอร์ชันใหม่แทนที่แล้ว กรุณาเปิดเวอร์ชันล่าสุด',
  PROCUREMENT_COST_SHEET_MAPPING_UNCONFIRMED: 'กรุณาเลือกและยืนยัน Product ให้ครบทุก SKU ก่อนบันทึก',
  PROCUREMENT_COST_SHEET_MAPPING_DUPLICATE: 'มีการจับคู่ SKU ซ้ำ กรุณาตรวจรายการและลองใหม่',
  PROCUREMENT_COST_SHEET_CARTON_CONFLICT: 'ข้อมูลขนาด/น้ำหนักลังของ SKU เดียวกันขัดแย้งกัน กรุณาแก้ไฟล์ก่อนยืนยัน',
  PROCUREMENT_COST_SHEET_VERSION_CONFLICT: 'Cost Sheet เปลี่ยนระหว่างบันทึก กรุณาโหลดรายการแล้วตรวจสอบอีกครั้ง',
  PROCUREMENT_COST_SHEET_PREVIEW_CORRUPT: 'ข้อมูล Preview อ่านไม่ได้ กรุณาสร้าง Preview ใหม่',
  PRODUCT_NOT_FOUND: 'ไม่พบ Product ที่เลือกใน Business นี้ กรุณาโหลดรายการสินค้าและจับคู่ใหม่',
  PRODUCT_ARCHIVED: 'Product ที่เลือกถูกเก็บถาวรแล้ว กรุณาเลือก Product อื่น',
  PRODUCT_VERSION_CONFLICT: 'ข้อมูล Product เปลี่ยนระหว่างบันทึก กรุณาโหลดข้อมูลแล้วลองใหม่',
})

export function supplierCostSheetErrorMessage(error) {
  const code = typeof error === 'string' ? error : error?.error ?? error?.message
  return ERROR_MESSAGES[code] || ''
}

export function createSupplierCostSheetPreviewState() {
  return { sheet: null, mappings: {}, commitResult: null }
}

function setOwnMapping(mappings, sourceSku, mapping) {
  Object.defineProperty(mappings, sourceSku, {
    value: mapping,
    configurable: true,
    enumerable: true,
    writable: true,
  })
}

export function supplierCostSheetConfirmedMappings(sheet) {
  if (sheet?.status !== 'CONFIRMED' || !Array.isArray(sheet.lines)) return {}

  const mappings = {}
  for (const line of sheet.lines) {
    const sourceSku = typeof line?.sourceSku === 'string' ? line.sourceSku : ''
    const productId = typeof line?.productId === 'string' ? line.productId : ''
    if (sourceSku && productId) setOwnMapping(mappings, sourceSku, { productId, confirmed: true })
  }
  return mappings
}

function productDisplayName(product) {
  return [product?.code, product?.name].filter(Boolean).join(' · ') || product?.id || 'Product'
}

export function supplierCostSheetDetailProductLabel({ status, line, product, candidate } = {}) {
  if (product) return productDisplayName(product)
  if (candidate) return productDisplayName(candidate)
  if (line?.productId) return `Product ID ${line.productId}`

  const suggestions = (Array.isArray(line?.mapping?.candidates) ? line.mapping.candidates : [])
    .map(productDisplayName)
    .filter(Boolean)
  if (status === 'DRAFT' && suggestions.length) return `คำแนะนำ (ยังไม่ยืนยัน): ${suggestions.join(' / ')}`
  return 'ยังไม่จับคู่'
}

export function supplierCostSheetPreviewReducer(state, action) {
  switch (action?.type) {
    case 'supplierChanged':
    case 'fileChanged':
    case 'inputChanged':
      return { ...state, sheet: null, mappings: {}, commitResult: null }
    case 'previewSucceeded':
      return { ...state, sheet: action.sheet, mappings: supplierCostSheetConfirmedMappings(action.sheet), commitResult: null }
    case 'mappingChanged': {
      const mappings = { ...state.mappings }
      const productId = typeof action.productId === 'string' ? action.productId.trim() : ''
      if (productId && typeof action.sourceSku === 'string') setOwnMapping(mappings, action.sourceSku, { productId, confirmed: true })
      else delete mappings[action.sourceSku]
      return { ...state, mappings, commitResult: null }
    }
    case 'commitSucceeded':
      return {
        ...state,
        sheet: action.sheet,
        mappings: supplierCostSheetConfirmedMappings(action.sheet),
        commitResult: { sheet: action.sheet, replayed: Boolean(action.replayed) },
      }
    default:
      return state
  }
}

export function buildSupplierCostSheetCommitPayload({ businessId, sheet, mappings = {} } = {}) {
  const sheetId = sheet?.id
  const previewHash = sheet?.preview?.hash
  if (!businessId || !sheetId || !previewHash) return null

  const sourceSkus = new Set((sheet.preview.lines || []).map((line) => line?.sku).filter(Boolean))
  const confirmedMappings = Object.entries(mappings)
    .filter(([sourceSku, mapping]) => sourceSkus.has(sourceSku)
      && mapping?.confirmed === true
      && typeof mapping.productId === 'string'
      && mapping.productId.trim())
    .map(([sourceSku, mapping]) => ({ sourceSku, productId: mapping.productId.trim(), confirmed: true }))

  return { businessId, sheetId, previewHash, mappings: confirmedMappings }
}

export function supplierCostSheetMappingIssue(line, mappings = {}) {
  const selected = mappings[line?.sku]
  if (selected?.confirmed === true && selected.productId) return ''
  if (line?.mapping?.confidence === 'UNMATCHED') return 'ไม่พบ Product ที่ตรงกับ SKU นี้ — กรุณาเลือกเอง'
  if (line?.mapping?.confidence === 'AMBIGUOUS') return 'พบ Product ที่ตรงกันหลายรายการ — กรุณาเลือกเอง'
  if (line?.mapping?.confidence === 'EXACT_PRODUCT_CODE' || line?.mapping?.confidence === 'EXACT_IDENTIFIER') {
    return 'มีคำแนะนำจากระบบ แต่ยังไม่ได้ยืนยัน'
  }
  return 'กรุณาเลือกและยืนยัน Product'
}
