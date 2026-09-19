import crypto from 'node:crypto'
import ExcelJS from 'exceljs'

// @spec ZAI:PROPOSAL-SMARTGIFT-COST-QUOTE-ENGINE-20260913; TASK-ZAI-053 —
//   the workbook is a source snapshot. Its header is the contract, the reader
//   does not auto-map or write anything, and the byte hash is carried into the
//   preview/commit idempotency key.
// @tested tests/unit/supplier-cost-workbook.test.js

export const SUPPLIER_COST_WORKBOOK_SHEET = 'CostSheet'
export const SUPPLIER_COST_WORKBOOK_HEADER_ROW = 2
export const SUPPLIER_COST_WORKBOOK_FIRST_DATA_ROW = 3

export const SUPPLIER_COST_WORKBOOK_COLUMNS = Object.freeze([
  ['sku', true, 24],
  ['min_qty', false, 12],
  ['unit_cost_foreign', true, 18],
  ['units_per_carton', false, 18],
  ['carton_cbm', false, 14],
  ['carton_kg', false, 14],
  ['freight_goods_type', false, 22],
  ['lead_time_days', false, 16],
])

const failure = (status, message, details) => Object.assign(new Error(message), { status }, details === undefined ? {} : { details })

function cellScalar(value) {
  if (value === null || value === undefined) return undefined
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('')
    if ('result' in value) return cellScalar(value.result)
    if ('text' in value) return cellScalar(value.text)
    return undefined
  }
  return value
}

function asText(value) {
  const scalar = cellScalar(value)
  if (scalar === undefined || scalar === null) return undefined
  const text = String(scalar).trim()
  return text === '' ? undefined : text
}

function asNumber(value) {
  const scalar = cellScalar(value)
  if (typeof scalar === 'number') return scalar
  const text = asText(value)
  if (text === undefined) return undefined
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : text
}

function styleHeader(sheet) {
  SUPPLIER_COST_WORKBOOK_COLUMNS.forEach(([key, required], index) => {
    const cell = sheet.getCell(SUPPLIER_COST_WORKBOOK_HEADER_ROW, index + 1)
    cell.value = required ? key + '*' : key
    cell.font = { bold: true, color: { argb: required ? 'FF555500' : 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: required ? 'FFFFFDE7' : 'FF455A64' } }
  })
}

export function buildSupplierCostTemplateWorkbook({ businessName = '', currency = 'USD', fxRateLocked = '' } = {}) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'zuri-ai'
  workbook.created = new Date(0)
  const readMe = workbook.addWorksheet('อ่านก่อน (Read Me)')
  readMe.columns = [{ width: 110 }]
  const lines = [
    'แม่แบบรับต้นทุนโรงงาน' + (businessName ? ' — ' + businessName : ''),
    '',
    '1. กรอกชีต CostSheet หนึ่งแถวต่อหนึ่ง SKU และ price break ตั้งแต่แถวที่ 3 · หัวตารางแถวที่ 2 ห้ามแก้ · คอลัมน์ที่มี * ต้องกรอก',
    '2. sku ต้องตรงกับรหัส SKU หรือรหัสคู่ค้าที่อยู่ใน Business นี้ ระบบจะแสดงตัวเลือกให้คนยืนยันก่อนเขียน line',
    '3. min_qty คือจำนวนขั้นต่ำของ price break; เว้นว่างได้และจะหมายถึง 1',
    '4. unit_cost_foreign เป็นราคาต่อหน่วยในสกุลเงินของชีต; ค่า FX ที่กรอกในหน้าอัปโหลดจะถูกล็อกไว้กับเวอร์ชันนี้ ไม่เรียก spot rate',
    '5. units_per_carton, carton_cbm และ carton_kg ใช้คำนวณจำนวนลัง/ปริมาตร/น้ำหนัก; เว้นว่างได้แต่ SKU นับสต๊อกจะถูกแจ้ง CARTON_DATA_MISSING',
    'ค่าเริ่มต้นของไฟล์นี้: currency=' + currency + ', fxRateLocked=' + (fxRateLocked || 'กรอกตอนอัปโหลด'),
  ]
  lines.forEach((text, index) => { readMe.getCell(index + 1, 1).value = text })
  readMe.getCell(1, 1).font = { bold: true, size: 13 }

  const sheet = workbook.addWorksheet(SUPPLIER_COST_WORKBOOK_SHEET)
  sheet.addRow(['ต้นทุนโรงงาน — แถวข้อมูลเริ่มที่ 3'])
  sheet.addRow([])
  styleHeader(sheet)
  sheet.freezePanes = { ySplit: SUPPLIER_COST_WORKBOOK_FIRST_DATA_ROW - 1 }
  sheet.autoFilter = {
    from: { row: SUPPLIER_COST_WORKBOOK_HEADER_ROW, column: 1 },
    to: { row: SUPPLIER_COST_WORKBOOK_HEADER_ROW, column: SUPPLIER_COST_WORKBOOK_COLUMNS.length },
  }
  SUPPLIER_COST_WORKBOOK_COLUMNS.forEach(([, , width], index) => { sheet.getColumn(index + 1).width = width })
  return workbook
}

export async function readSupplierCostWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(buffer)
  } catch {
    throw failure(422, 'PROCUREMENT_COST_WORKBOOK_UNREADABLE')
  }
  const sheet = workbook.getWorksheet(SUPPLIER_COST_WORKBOOK_SHEET)
  if (!sheet) throw failure(422, 'PROCUREMENT_COST_WORKBOOK_SHEET_MISSING', [{ sheet: SUPPLIER_COST_WORKBOOK_SHEET }])
  const header = sheet.getRow(SUPPLIER_COST_WORKBOOK_HEADER_ROW)
  const mismatches = SUPPLIER_COST_WORKBOOK_COLUMNS.map(([key], index) => {
    const found = (asText(header.getCell(index + 1).value) ?? '').replace(/\*$/, '')
    return found === key ? null : { column: index + 1, expected: key, found }
  }).filter(Boolean)
  if (mismatches.length) throw failure(422, 'PROCUREMENT_COST_WORKBOOK_HEADER_MISMATCH', mismatches)

  const rows = []
  const last = Math.max(sheet.rowCount, SUPPLIER_COST_WORKBOOK_FIRST_DATA_ROW - 1)
  for (let rowNumber = SUPPLIER_COST_WORKBOOK_FIRST_DATA_ROW; rowNumber <= last; rowNumber += 1) {
    const values = SUPPLIER_COST_WORKBOOK_COLUMNS.map((_, index) => sheet.getRow(rowNumber).getCell(index + 1).value)
    if (values.every((value) => asText(value) === undefined)) continue
    const line = {}
    const [sku, minQty, unitCostForeign, unitsPerCarton, cartonCbm, cartonKg, freightGoodsType, leadTimeDays] = values
    const fields = {
      sku: asText(sku),
      minQty: asNumber(minQty),
      unitCostForeign: asNumber(unitCostForeign),
      unitsPerCarton: asNumber(unitsPerCarton),
      cartonCbm: asNumber(cartonCbm),
      cartonKg: asNumber(cartonKg),
      freightGoodsType: asText(freightGoodsType),
      leadTimeDays: asNumber(leadTimeDays),
    }
    for (const [key, value] of Object.entries(fields)) if (value !== undefined) line[key] = value
    rows.push(line)
    if (rows.length > 5000) throw failure(422, 'PROCUREMENT_COST_WORKBOOK_TOO_MANY_ROWS', [{ max: 5000 }])
  }
  if (!rows.length) throw failure(422, 'PROCUREMENT_COST_WORKBOOK_EMPTY')
  return { lines: rows, sourceSha256: crypto.createHash('sha256').update(buffer).digest('hex') }
}
