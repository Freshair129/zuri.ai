// @req FR-209 — the catalogue workbook: the template's header row is the
//   contract and carries the Business's own lookups; the reader turns filled
//   rows into envelope items without judging a cell, skips blank rows, and
//   refuses only a file that is not this contract (missing sheet, wrong header,
//   too many rows, nothing filled). A round trip through ExcelJS proves it.
// @spec ADR-084 D3
// @tested tests/unit/inventory-catalog-workbook.test.js
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import {
  CATALOG_WORKBOOK_COLUMNS,
  buildCatalogTemplateWorkbook,
  catalogRowToItem,
  cellScalar,
  parseConversionsCell,
  parseVariantCell,
  readCatalogWorkbook,
  workbookColumnFor,
} from '@/modules/inventory/import/catalog-workbook'
import { zCatalogIntakeItem } from '@/modules/inventory/domain/catalog-intake'

const col = (key) => CATALOG_WORKBOOK_COLUMNS.findIndex(([k]) => k === key)
function row(values) {
  const out = Array(CATALOG_WORKBOOK_COLUMNS.length).fill(null)
  for (const [key, value] of Object.entries(values)) out[col(key)] = value
  return out
}

async function workbookWith(rows, { template = buildCatalogTemplateWorkbook() } = {}) {
  const sheet = template.getWorksheet('Products')
  // ExcelJS maps an array's first element to column A (no leading placeholder).
  rows.forEach((values, i) => { sheet.getRow(3 + i).values = values })
  return Buffer.from(await template.xlsx.writeBuffer())
}

describe('FR-209 template', () => {
  it('builds Products with the header contract, dropdowns, and this Business\'s lookups', async () => {
    const workbook = buildCatalogTemplateWorkbook({ businessName: 'Gift Co', categories: [{ code: 'CAT-A', nameTh: 'หมวด A' }], masters: [{ code: 'PM-A', nameTh: 'แก้ว', nature: 'GOOD', variantAxes: ['color'] }] })
    const reloaded = new ExcelJS.Workbook()
    await reloaded.xlsx.load(Buffer.from(await workbook.xlsx.writeBuffer()))
    expect(reloaded.worksheets.map((s) => s.name)).toEqual(['อ่านก่อน (Read Me)', 'Products', 'Lookups'])
    const products = reloaded.getWorksheet('Products')
    expect(CATALOG_WORKBOOK_COLUMNS.map((_, i) => String(products.getCell(2, i + 1).value))).toEqual(CATALOG_WORKBOOK_COLUMNS.map(([key, required]) => (required ? `${key}*` : key)))
    const lookups = reloaded.getWorksheet('Lookups').getSheetValues().filter(Boolean).map((r) => r.slice(1, 4).join('|'))
    expect(lookups).toEqual(expect.arrayContaining(['category|CAT-A|หมวด A', 'master|PM-A|แก้ว', 'stock_policy|UNTRACKED|']))
    expect(String(reloaded.getWorksheet('อ่านก่อน (Read Me)').getCell(1, 1).value)).toContain('Gift Co')
  })
})

describe('FR-209 reader', () => {
  it('turns cells into items without judging them', () => {
    const item = catalogRowToItem(row({
      sku_code: 1001, sku_name: { richText: [{ text: 'Cup ' }, { text: 'black' }] }, master_code: 'PM-A', master_nature: 'good', stock_policy: 'untracked',
      variant: 'size=M;color=ดำ', safety_stock: '7', reorder_point: 'abc', gtin: '4006381333931', barcode: 'B-1; B-2',
      unit_conversions: 'BOX12=12;CTN=x;PAIR', allow_lookalike: 'TRUE', master_variant_axes: 'color,size', lead_time_days: { formula: 'A1+1', result: 3 },
    }), 7)
    expect(item).toEqual({
      ref: 'แถว 7',
      sku: { code: '1001', name: 'Cup black', stockPolicy: 'UNTRACKED', variant: { size: 'M', color: 'ดำ' }, safetyStock: 7, reorderPoint: 'abc', leadTimeDays: 3, allowLookalike: true },
      master: { code: 'PM-A', nature: 'GOOD', variantAxes: ['color', 'size'] },
      identifiers: [{ kind: 'GTIN', value: '4006381333931' }, { kind: 'BARCODE', value: 'B-1' }, { kind: 'BARCODE', value: 'B-2' }],
      unitConversions: [{ unit: 'BOX12', factor: 12 }, { unit: 'CTN', factor: 'x' }, { unit: 'PAIR' }],
    })
    // The schema, not the reader, refuses what is wrong.
    const parsed = zCatalogIntakeItem.safeParse(item)
    expect(parsed.success).toBe(false)
    expect(parsed.error.issues.map((i) => i.path.join('.'))).toEqual(expect.arrayContaining(['sku.reorderPoint', 'unitConversions.1.factor', 'unitConversions.2.factor']))
    expect(catalogRowToItem(row({}), 9)).toBeNull()
    expect(catalogRowToItem(row({ sku_name: '   ' }), 9)).toBeNull()
  })

  it('parses list cells and scalars, and maps a path back to its column', () => {
    expect(parseVariantCell('size=M; color')).toEqual({ size: 'M', color: '' })
    expect(parseConversionsCell('BOX12=12')).toEqual([{ unit: 'BOX12', factor: 12 }])
    expect(cellScalar({ text: 'link', hyperlink: 'http://x' })).toBe('link')
    expect(cellScalar(new Date('2026-09-13T00:00:00Z'))).toBe('2026-09-13')
    expect(workbookColumnFor('sku.safetyStock')).toBe('safety_stock')
    expect(workbookColumnFor('sku.variant.size')).toBe('variant')
    expect(workbookColumnFor('identifiers.1.value')).toMatch(/gtin/)
    expect(workbookColumnFor('unitConversions.0.factor')).toBe('unit_conversions')
  })

  it('reads a filled template round trip, skipping blank rows, with a correlation bound to the bytes', async () => {
    const buffer = await workbookWith([
      row({ sku_code: 'CUP-1', master_code: 'PM-A', gtin: '4006381333931' }),
      row({}),
      row({ sku_code: 'CUP-2', master_code: 'PM-A', unit_conversions: 'BOX12=12' }),
    ])
    const { items, correlationId } = await readCatalogWorkbook(buffer)
    expect(items.map((i) => [i.ref, i.sku.code])).toEqual([['แถว 3', 'CUP-1'], ['แถว 5', 'CUP-2']])
    expect(correlationId).toMatch(/^xlsx:[0-9a-f]{64}$/)
    expect((await readCatalogWorkbook(buffer)).correlationId).toBe(correlationId)
  })

  it('refuses a file that is not this contract', async () => {
    await expect(readCatalogWorkbook(Buffer.from('not a workbook'))).rejects.toMatchObject({ status: 422, message: 'INVENTORY_CATALOG_WORKBOOK_UNREADABLE' })
    const other = new ExcelJS.Workbook(); other.addWorksheet('Sheet1')
    await expect(readCatalogWorkbook(Buffer.from(await other.xlsx.writeBuffer()))).rejects.toMatchObject({ message: 'INVENTORY_CATALOG_WORKBOOK_SHEET_MISSING' })
    const tampered = buildCatalogTemplateWorkbook()
    tampered.getWorksheet('Products').getCell(2, 3).value = 'master'
    await expect(readCatalogWorkbook(await workbookWith([row({ sku_code: 'A' })], { template: tampered }))).rejects.toMatchObject({ message: 'INVENTORY_CATALOG_WORKBOOK_HEADER_MISMATCH', details: [{ column: 3, expected: 'master_code', found: 'master' }] })
    await expect(readCatalogWorkbook(await workbookWith([]))).rejects.toMatchObject({ message: 'INVENTORY_CATALOG_WORKBOOK_EMPTY' })
    const many = Array.from({ length: 501 }, (_, i) => row({ sku_code: `S-${i}`, master_code: 'PM-A' }))
    await expect(readCatalogWorkbook(await workbookWith(many))).rejects.toMatchObject({ message: 'INVENTORY_CATALOG_WORKBOOK_TOO_MANY_ROWS' })
  })
})
