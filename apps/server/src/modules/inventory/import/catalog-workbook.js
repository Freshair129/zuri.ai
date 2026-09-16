import crypto from 'node:crypto'
import ExcelJS from 'exceljs'
import {
  INVENTORY_PRODUCT_NATURES,
  INVENTORY_STOCK_POLICIES,
  INVENTORY_TRACKING_MODES,
} from '@/lib/validation/enums'
import { CATALOG_INTAKE_MAX_ITEMS, CATALOG_INTAKE_SCHEMA_VERSION } from '../domain/catalog-intake'

// @req FR-209 — the Excel converter of the catalogue intake (ADR-084 D3). The
//   template is built for ONE Business: a `Products` sheet whose header row is
//   the contract, dropdowns drawn from `enums.js`, a `Lookups` sheet listing
//   that Business's own categories and masters, and a read-me. The reader turns
//   every non-blank row into an envelope item WITHOUT judging a cell — a
//   malformed number, a bad `BOX12=x` or an unknown policy reaches the item
//   schema and comes back from the planner as an INVALID row with its path —
//   so Excel is validated by exactly the rules JSON and LINE are. It never
//   writes: the route previews what it returns, and a person commits.
// @spec ADR-084 D1, D3; BR-009; SDD-009; ADR-056 D7 (a file is a snapshot, never the register)
// @tested tests/unit/inventory-catalog-workbook.test.js

export const CATALOG_WORKBOOK_SHEET = 'Products'
export const CATALOG_WORKBOOK_HEADER_ROW = 2
export const CATALOG_WORKBOOK_FIRST_DATA_ROW = 3

/** [column key, required, width, envelope path it feeds] — the order is the contract. */
export const CATALOG_WORKBOOK_COLUMNS = Object.freeze([
  ['sku_code', true, 22, 'sku.code'],
  ['sku_name', false, 30, 'sku.name'],
  ['master_code', true, 20, 'master.code'],
  ['category_code', false, 18, 'master.categoryCode'],
  ['master_name_th', false, 26, 'master.nameTh'],
  ['master_name_en', false, 26, 'master.nameEn'],
  ['master_nature', false, 14, 'master.nature'],
  ['master_variant_axes', false, 22, 'master.variantAxes'],
  ['stock_policy', false, 14, 'sku.stockPolicy'],
  ['tracking_mode', false, 14, 'sku.trackingMode'],
  ['unit', false, 10, 'sku.unit'],
  ['color', false, 14, 'sku.color'],
  ['material', false, 14, 'sku.material'],
  ['variant', false, 26, 'sku.variant'],
  ['safety_stock', false, 12, 'sku.safetyStock'],
  ['reorder_point', false, 12, 'sku.reorderPoint'],
  ['reorder_qty', false, 12, 'sku.reorderQty'],
  ['lead_time_days', false, 14, 'sku.leadTimeDays'],
  ['gtin', false, 18, 'identifiers:GTIN'],
  ['barcode', false, 18, 'identifiers:BARCODE'],
  ['supplier_code', false, 18, 'identifiers:SUPPLIER_CODE'],
  ['manufacturer_part', false, 20, 'identifiers:MANUFACTURER_PART'],
  ['unit_conversions', false, 26, 'unitConversions'],
  ['allow_lookalike', false, 14, 'sku.allowLookalike'],
])

const COLUMN_HELP = Object.freeze({
  sku_code: 'รหัส SKU (ไม่ซ้ำใน Tenant)',
  master_code: 'รหัสสินค้าหลัก — มีอยู่แล้ว หรือกรอก category_code + ชื่อ ไทย/อังกฤษ เพื่อสร้างใหม่',
  master_variant_axes: 'แกน variant ของสินค้าหลักใหม่ เช่น color,size',
  variant: 'ค่าบนแกน เช่น size=M;color=ดำ',
  gtin: 'EAN-13 / UPC-A / GTIN — ระบบตรวจเลขตรวจสอบ',
  unit_conversions: 'แพ็ก/กล่อง เช่น BOX12=12;CTN=144 (1 หน่วยนี้ = กี่หน่วยฐาน)',
  allow_lookalike: 'TRUE เมื่อยืนยันว่าไม่ใช่ SKU ซ้ำ',
})

function styleHeader(sheet) {
  CATALOG_WORKBOOK_COLUMNS.forEach(([key, required], index) => {
    const cell = sheet.getCell(CATALOG_WORKBOOK_HEADER_ROW, index + 1)
    cell.value = required ? `${key}*` : key
    cell.font = { bold: true, color: { argb: required ? 'FF555500' : 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: required ? 'FFFFFDE7' : 'FF455A64' } }
    if (COLUMN_HELP[key]) cell.note = COLUMN_HELP[key]
  })
}

function addList(sheet, key, values) {
  const index = CATALOG_WORKBOOK_COLUMNS.findIndex(([column]) => column === key) + 1
  if (!index) return
  const letter = sheet.getColumn(index).letter
  const last = CATALOG_WORKBOOK_FIRST_DATA_ROW + CATALOG_INTAKE_MAX_ITEMS - 1
  sheet.dataValidations.add(`${letter}${CATALOG_WORKBOOK_FIRST_DATA_ROW}:${letter}${last}`, {
    type: 'list', allowBlank: true, formulae: [`"${values.join(',')}"`],
    showErrorMessage: true, errorTitle: 'ค่าไม่อยู่ในรายการ', error: 'เลือกจาก dropdown หรือเว้นว่าง',
  })
}

/**
 * The template for one Business. `categories` and `masters` are that Business's
 * own rows (code + Thai name, and nature/axes for a master), listed so a person
 * types a code that exists instead of inventing a second one.
 */
export function buildCatalogTemplateWorkbook({ businessName = '', categories = [], masters = [] } = {}) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'zuri-ai'
  workbook.created = new Date(0)

  const readMe = workbook.addWorksheet('อ่านก่อน (Read Me)')
  readMe.columns = [{ width: 110 }]
  const lines = [
    `แม่แบบนำเข้าแคตตาล็อกสินค้า${businessName ? ` — ${businessName}` : ''} (envelope ${CATALOG_INTAKE_SCHEMA_VERSION})`,
    '',
    '1. กรอกชีต Products หนึ่งแถวต่อหนึ่ง SKU ตั้งแต่แถวที่ 3 · หัวตารางแถวที่ 2 ห้ามแก้ · คอลัมน์ที่มี * ต้องกรอก',
    '2. ก่อนสร้าง ระบบจะค้นหา SKU เดิมจากบาร์โค้ด/รหัสคู่ค้าและรหัส SKU ก่อนเสมอ ถ้าเจอจะ "จับคู่" และเพิ่มเฉพาะบาร์โค้ด/หน่วยแปลงที่ยังไม่มี — ไม่แก้ข้อมูลของ SKU เดิม',
    '3. อัปโหลดไฟล์ในแท็บ Import ของคลังสินค้าเพื่อดูผลตรวจก่อน · ไฟล์ไม่ถูกบันทึกจนกว่าจะกดยืนยัน และจะบันทึกทั้งไฟล์หรือไม่บันทึกเลย',
    '4. ถ้ามีแถวที่ติดปัญหา (ซ้ำ ชนรหัสเดิม ข้อมูลผิด) ต้องแก้ไฟล์แล้วอัปโหลดใหม่',
    '5. ดูรหัสหมวดหมู่และสินค้าหลักที่มีอยู่แล้วในชีต Lookups',
    '',
    'ตัวอย่างค่า: variant = size=M;color=ดำ · unit_conversions = BOX12=12;CTN=144 · master_variant_axes = color,size',
    'zuri-ai เป็นแหล่งข้อมูลจริง · ไฟล์ Excel เป็นเพียงสำเนาสำหรับนำเข้า',
  ]
  lines.forEach((text, i) => { readMe.getCell(i + 1, 1).value = text })
  readMe.getCell(1, 1).font = { bold: true, size: 13 }

  const sheet = workbook.addWorksheet(CATALOG_WORKBOOK_SHEET)
  sheet.columns = CATALOG_WORKBOOK_COLUMNS.map(([key, , width]) => ({ key, width }))
  sheet.mergeCells(1, 1, 1, CATALOG_WORKBOOK_COLUMNS.length)
  sheet.getCell(1, 1).value = 'หนึ่งแถวต่อหนึ่ง SKU · ระบบค้นหา SKU เดิมก่อนสร้างเสมอ · ช่องที่ไม่รู้ให้เว้นว่าง'
  sheet.getCell(1, 1).font = { italic: true, color: { argb: 'FF5D4037' } }
  styleHeader(sheet)
  sheet.views = [{ state: 'frozen', ySplit: CATALOG_WORKBOOK_HEADER_ROW }]
  addList(sheet, 'master_nature', INVENTORY_PRODUCT_NATURES)
  addList(sheet, 'stock_policy', INVENTORY_STOCK_POLICIES)
  addList(sheet, 'tracking_mode', INVENTORY_TRACKING_MODES)
  addList(sheet, 'allow_lookalike', ['TRUE', 'FALSE'])

  const lookups = workbook.addWorksheet('Lookups')
  lookups.columns = [{ key: 'list', width: 18 }, { key: 'code', width: 24 }, { key: 'name', width: 34 }, { key: 'extra', width: 30 }]
  lookups.addRow(['list', 'code', 'name', 'nature / axes']).font = { bold: true }
  for (const category of categories) lookups.addRow(['category', category.code, category.nameTh ?? '', ''])
  for (const master of masters) lookups.addRow(['master', master.code, master.nameTh ?? '', `${master.nature ?? 'GOOD'}${master.variantAxes?.length ? ` · ${master.variantAxes.join(',')}` : ''}`])
  for (const value of INVENTORY_PRODUCT_NATURES) lookups.addRow(['master_nature', value, '', ''])
  for (const value of INVENTORY_STOCK_POLICIES) lookups.addRow(['stock_policy', value, '', ''])
  for (const value of INVENTORY_TRACKING_MODES) lookups.addRow(['tracking_mode', value, '', ''])
  return workbook
}

// ── Reading ─────────────────────────────────────────────────────────────────

/** An ExcelJS cell value as a plain scalar: rich text joined, a formula's result, a hyperlink's text. */
export function cellScalar(value) {
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

const asText = (value) => {
  const scalar = cellScalar(value)
  if (scalar === undefined || scalar === null) return undefined
  const text = String(scalar).trim()
  return text === '' ? undefined : text
}

/** A number when the cell holds one; otherwise the text, so the schema — not the reader — refuses it. */
const asNumberish = (value) => {
  const scalar = cellScalar(value)
  if (typeof scalar === 'number') return scalar
  const text = asText(value)
  if (text === undefined) return undefined
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : text
}

const asBooleanish = (value) => {
  const scalar = cellScalar(value)
  if (typeof scalar === 'boolean') return scalar
  const text = asText(value)
  if (text === undefined) return undefined
  if (/^(true|yes|y|1|ใช่)$/i.test(text)) return true
  if (/^(false|no|n|0|ไม่)$/i.test(text)) return false
  return text
}

const splitList = (text) => text.split(/[;,\n]/).map((part) => part.trim()).filter(Boolean)

/** `size=M;color=ดำ` → `{ size: 'M', color: 'ดำ' }`; a piece without `=` keeps an empty value the schema refuses. */
export function parseVariantCell(text) {
  if (text === undefined) return undefined
  return Object.fromEntries(splitList(text).map((piece) => {
    const at = piece.indexOf('=')
    return at < 0 ? [piece, ''] : [piece.slice(0, at).trim(), piece.slice(at + 1).trim()]
  }))
}

/** `BOX12=12;CTN=144` → conversions; a factor that is not a whole number stays text for the schema to refuse. */
export function parseConversionsCell(text) {
  if (text === undefined) return undefined
  return splitList(text).map((piece) => {
    const at = piece.indexOf('=')
    if (at < 0) return { unit: piece }
    const factorText = piece.slice(at + 1).trim()
    return { unit: piece.slice(0, at).trim(), factor: /^\d+$/.test(factorText) ? Number(factorText) : factorText }
  })
}

const setPath = (target, path, value) => {
  if (value === undefined) return
  const [head, tail] = path.split('.')
  target[head] = target[head] ?? {}
  target[head][tail] = value
}

/** One spreadsheet row as an envelope item; `null` when the row is blank. */
export function catalogRowToItem(values, rowNumber) {
  const item = { ref: `แถว ${rowNumber}`, sku: {}, master: {} }
  let filled = false
  const identifiers = []
  CATALOG_WORKBOOK_COLUMNS.forEach(([key, , , path], index) => {
    const raw = values[index]
    if (asText(raw) !== undefined || typeof cellScalar(raw) === 'number' || typeof cellScalar(raw) === 'boolean') filled = true
    if (path.startsWith('identifiers:')) {
      const text = asText(raw)
      if (text !== undefined) for (const value of splitList(text)) identifiers.push({ kind: path.slice('identifiers:'.length), value })
      return
    }
    if (key === 'unit_conversions') { const conversions = parseConversionsCell(asText(raw)); if (conversions?.length) item.unitConversions = conversions; return }
    if (key === 'variant') return setPath(item, path, parseVariantCell(asText(raw)))
    if (key === 'master_variant_axes') { const text = asText(raw); return setPath(item, path, text === undefined ? undefined : splitList(text)) }
    if (['safety_stock', 'reorder_point', 'reorder_qty', 'lead_time_days'].includes(key)) return setPath(item, path, asNumberish(raw))
    if (key === 'allow_lookalike') return setPath(item, path, asBooleanish(raw))
    if (['master_nature', 'stock_policy', 'tracking_mode'].includes(key)) { const text = asText(raw); return setPath(item, path, text === undefined ? undefined : text.toUpperCase()) }
    return setPath(item, path, asText(raw))
  })
  if (!filled) return null
  if (identifiers.length) item.identifiers = identifiers
  return item
}

const failure = (status, message, details) => Object.assign(new Error(message), { status }, details === undefined ? {} : { details })

/**
 * Read a catalogue workbook into envelope items. Refuses only what makes the
 * file unreadable as this contract — a missing `Products` sheet, a header row
 * that is not the template's, more rows than one intake takes. Everything
 * about a row's content is left to the planner.
 */
export async function readCatalogWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(buffer)
  } catch {
    throw failure(422, 'INVENTORY_CATALOG_WORKBOOK_UNREADABLE')
  }
  const sheet = workbook.getWorksheet(CATALOG_WORKBOOK_SHEET)
  if (!sheet) throw failure(422, 'INVENTORY_CATALOG_WORKBOOK_SHEET_MISSING', [{ sheet: CATALOG_WORKBOOK_SHEET }])
  const header = sheet.getRow(CATALOG_WORKBOOK_HEADER_ROW)
  const mismatches = CATALOG_WORKBOOK_COLUMNS.map(([key], index) => {
    const found = (asText(header.getCell(index + 1).value) ?? '').replace(/\*$/, '')
    return found === key ? null : { column: index + 1, expected: key, found }
  }).filter(Boolean)
  if (mismatches.length) throw failure(422, 'INVENTORY_CATALOG_WORKBOOK_HEADER_MISMATCH', mismatches)

  const items = []
  const last = Math.max(sheet.rowCount, CATALOG_WORKBOOK_FIRST_DATA_ROW - 1)
  for (let rowNumber = CATALOG_WORKBOOK_FIRST_DATA_ROW; rowNumber <= last; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    const values = CATALOG_WORKBOOK_COLUMNS.map((_, index) => row.getCell(index + 1).value)
    const item = catalogRowToItem(values, rowNumber)
    if (!item) continue
    items.push(item)
    if (items.length > CATALOG_INTAKE_MAX_ITEMS) throw failure(422, 'INVENTORY_CATALOG_WORKBOOK_TOO_MANY_ROWS', [{ max: CATALOG_INTAKE_MAX_ITEMS }])
  }
  if (!items.length) throw failure(422, 'INVENTORY_CATALOG_WORKBOOK_EMPTY')
  return { items, correlationId: `xlsx:${crypto.createHash('sha256').update(buffer).digest('hex')}` }
}

/** Where an item path came from in the sheet, for a person reading a preview. */
export function workbookColumnFor(path) {
  if (!path) return null
  if (path.startsWith('identifiers')) return 'gtin / barcode / supplier_code / manufacturer_part'
  if (path.startsWith('unitConversions')) return 'unit_conversions'
  const match = CATALOG_WORKBOOK_COLUMNS.find(([, , , columnPath]) => path === columnPath || path.startsWith(`${columnPath}.`))
  return match ? match[0] : null
}
