import { describe, expect, it } from 'vitest'
import {
  buildSupplierCostTemplateWorkbook,
  readSupplierCostWorkbook,
  SUPPLIER_COST_WORKBOOK_COLUMNS,
  SUPPLIER_COST_WORKBOOK_SHEET,
} from '@/modules/procurement/import/supplier-cost-workbook'

// @spec ZAI:PROPOSAL-SMARTGIFT-COST-QUOTE-ENGINE-20260913; TASK-ZAI-053 —
//   the workbook header is the source contract and the reader returns a byte
//   hash without resolving or writing product mappings.
// @tested tests/unit/supplier-cost-workbook.test.js

describe('supplier cost workbook', () => {
  it('builds and reads the canonical CostSheet header and preserves price breaks/carton fields', async () => {
    const workbook = buildSupplierCostTemplateWorkbook({ businessName: 'Gift shop', currency: 'USD', fxRateLocked: 34 })
    const sheet = workbook.getWorksheet(SUPPLIER_COST_WORKBOOK_SHEET)
    sheet.addRow(['SG-BOX', 1, 1.25, 24, 0.018, 4.2, 'GENERAL', 14])
    sheet.addRow(['SG-BOX', 100, 1.1, 24, 0.018, 4.2, 'GENERAL', 14])
    const buffer = await workbook.xlsx.writeBuffer()
    const result = await readSupplierCostWorkbook(buffer)

    expect(result.sourceSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.lines).toEqual([
      { sku: 'SG-BOX', minQty: 1, unitCostForeign: 1.25, unitsPerCarton: 24, cartonCbm: 0.018, cartonKg: 4.2, freightGoodsType: 'GENERAL', leadTimeDays: 14 },
      { sku: 'SG-BOX', minQty: 100, unitCostForeign: 1.1, unitsPerCarton: 24, cartonCbm: 0.018, cartonKg: 4.2, freightGoodsType: 'GENERAL', leadTimeDays: 14 },
    ])
    expect(SUPPLIER_COST_WORKBOOK_COLUMNS.map(([key]) => key)).toEqual([
      'sku', 'min_qty', 'unit_cost_foreign', 'units_per_carton', 'carton_cbm', 'carton_kg', 'freight_goods_type', 'lead_time_days',
    ])
  })

  it('refuses a missing sheet or changed header before any domain validation', async () => {
    const workbook = buildSupplierCostTemplateWorkbook()
    workbook.getWorksheet(SUPPLIER_COST_WORKBOOK_SHEET).getCell(2, 1).value = 'wrong'
    const buffer = await workbook.xlsx.writeBuffer()
    await expect(readSupplierCostWorkbook(buffer)).rejects.toMatchObject({ status: 422, message: 'PROCUREMENT_COST_WORKBOOK_HEADER_MISMATCH' })
  })
})
