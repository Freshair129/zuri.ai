// @req FR-203 — the console's identifier helpers: the input problem a value has
//   before it is sent (empty, whitespace, a GTIN of the wrong length or with a
//   failing check digit), the kind labels covering the whole vocabulary, and
//   the Thai text for each refusal, naming the holder of a taken code.
// @req FR-204 — the console's unit helpers: units offered per product (base
//   first, usage filter, none for serial or service), the conversion label, and
//   the base-quantity preview computed by the domain's own converter.
// @spec ADR-083 D3, D4; BR-037
// @tested tests/unit/inventory-sku-console.test.js
import { describe, expect, it } from 'vitest'
import {
  IDENTIFIER_KIND_LABEL,
  UNIT_USAGE_LABEL,
  baseQuantityPreview,
  conversionBlockReason,
  conversionLabel,
  identifierInputProblem,
  skuConsoleErrorText,
  unitsFor,
  writeBlockReason,
} from '@/modules/inventory/ui/sku-console'
import { INVENTORY_IDENTIFIER_KINDS, INVENTORY_UNIT_USAGES } from '@/lib/validation/enums'

const product = { id: 'p1', businessId: 'b1', unit: 'EA', stockPolicy: 'TRACKED', trackingMode: 'NONE', status: 'ACTIVE' }
const conversions = [
  { unit: 'BOX12', factor: 12, usage: 'PURCHASE', status: 'ACTIVE' },
  { unit: 'PACK3', factor: 3, usage: 'SALES', status: 'ACTIVE' },
  { unit: 'CTN', factor: 144, usage: 'ANY', status: 'ACTIVE' },
  { unit: 'OLD6', factor: 6, usage: 'ANY', status: 'RETIRED' },
]

describe('FR-203 identifier helpers', () => {
  it('labels every identifier kind and every usage the registry declares', () => {
    expect(Object.keys(IDENTIFIER_KIND_LABEL).sort()).toEqual([...INVENTORY_IDENTIFIER_KINDS].sort())
    expect(Object.keys(UNIT_USAGE_LABEL).sort()).toEqual([...INVENTORY_UNIT_USAGES].sort())
  })

  it('catches an empty, spaced, over-long or mis-checked value before it is sent', () => {
    expect(identifierInputProblem('BARCODE', '')).toBe('กรอกรหัส')
    expect(identifierInputProblem('BARCODE', 'A B')).toMatch(/ช่องว่าง/)
    expect(identifierInputProblem('BARCODE', 'x'.repeat(101))).toMatch(/100/)
    expect(identifierInputProblem('GTIN', '12345')).toMatch(/8, 12, 13 หรือ 14/)
    expect(identifierInputProblem('GTIN', '885012345678A')).toMatch(/8, 12, 13 หรือ 14/)
    expect(identifierInputProblem('GTIN', '4006381333932')).toMatch(/check digit/)
    expect(identifierInputProblem('GTIN', '4006381333931')).toBeNull()
    expect(identifierInputProblem('GTIN', '036000291452')).toBeNull()
    // Only a GTIN is held to the check digit; a supplier's code is whatever the supplier says.
    expect(identifierInputProblem('SUPPLIER_CODE', '4006381333932')).toBeNull()
  })

  it('says each refusal in Thai, names the holder of a taken code when known, and keeps a 404 uninformative', () => {
    expect(skuConsoleErrorText({ message: 'INVENTORY_IDENTIFIER_TAKEN' }, { holder: 'SKU-9' })).toMatch(/SKU-9/)
    expect(skuConsoleErrorText({ message: 'INVENTORY_IDENTIFIER_TAKEN' })).toMatch(/SKU อื่น/)
    expect(skuConsoleErrorText({ message: 'INVENTORY_UNIT_IS_BASE' })).toMatch(/หน่วยฐาน/)
    expect(skuConsoleErrorText({ message: 'PRODUCT_UNIT_CONVERSION_VERSION_CONFLICT' })).toMatch(/โหลดใหม่/)
    expect(skuConsoleErrorText({ message: 'Business not found', status: 404 })).toBe('ไม่พบรายการใน Business นี้ หรือคุณไม่มีสิทธิ์ดำเนินการ')
    expect(skuConsoleErrorText({ message: 'Validation failed', issues: ['value: a GTIN is 8, 12, 13 or 14 digits with a valid check digit'] })).toMatch(/check digit/)
    expect(skuConsoleErrorText({ message: 'Validation failed', issues: ['factor: Expected integer'] })).toMatch(/^ข้อมูลไม่ถูกต้อง: factor/)
    expect(skuConsoleErrorText({ message: 'SOMETHING_NEW' })).toBe('SOMETHING_NEW')
  })
})

describe('FR-204 unit helpers', () => {
  it('offers the base unit first and every active conversion that fits the usage', () => {
    expect(unitsFor(product, conversions).map((u) => u.unit)).toEqual(['EA', 'BOX12', 'PACK3', 'CTN'])
    expect(unitsFor(product, conversions, 'PURCHASE').map((u) => u.unit)).toEqual(['EA', 'BOX12', 'CTN'])
    expect(unitsFor(product, conversions, 'SALES').map((u) => u.unit)).toEqual(['EA', 'PACK3', 'CTN'])
    expect(unitsFor(product, conversions)[1].label).toBe('BOX12 (1 BOX12 = 12 EA)')
    expect(unitsFor({ ...product, trackingMode: 'SERIAL' }, conversions).map((u) => u.unit)).toEqual(['EA'])
    expect(unitsFor({ ...product, stockPolicy: 'SERVICE' }, conversions).map((u) => u.unit)).toEqual(['EA'])
    expect(unitsFor(null, conversions)).toEqual([])
  })

  it('labels a conversion as one sentence and previews the base quantity the ledger will write', () => {
    expect(conversionLabel(conversions[0], 'EA')).toBe('1 BOX12 = 12 EA')
    expect(baseQuantityPreview(product, '2', 'BOX12', conversions)).toEqual({ ok: true, quantity: 24, text: '= 24 EA ในสต๊อก' })
    expect(baseQuantityPreview(product, '-1', 'BOX12', conversions)).toMatchObject({ ok: true, quantity: -12, text: '= 12 EA ในสต๊อก' })
    expect(baseQuantityPreview(product, '5', 'EA', conversions)).toEqual({ ok: true, quantity: 5, text: '' })
    expect(baseQuantityPreview(product, '', 'BOX12', conversions)).toMatchObject({ ok: true, text: '' })
    expect(baseQuantityPreview(product, '1', 'OLD6', conversions)).toMatchObject({ ok: false, quantity: null })
  })

  it('explains why a SKU cannot be edited here, or takes no conversion at all', () => {
    expect(writeBlockReason(null, 'b1')).toMatch(/กำลังโหลด/)
    expect(writeBlockReason(product, 'b1')).toBeNull()
    expect(writeBlockReason(product, 'b2')).toMatch(/Business อื่น/)
    expect(writeBlockReason({ ...product, status: 'ARCHIVED' }, 'b1')).toMatch(/เก็บถาวร/)
    expect(writeBlockReason({ ...product, status: 'ARCHIVED', mergedIntoProductId: 'p2' }, 'b1')).toMatch(/รวมเข้ากับ/)
    expect(writeBlockReason({ ...product, status: 'PHASE_OUT' }, 'b1')).toBeNull()
    expect(conversionBlockReason(product)).toBeNull()
    expect(conversionBlockReason({ ...product, stockPolicy: 'SERVICE' })).toMatch(/บริการ/)
    expect(conversionBlockReason({ ...product, trackingMode: 'SERIAL' })).toMatch(/Serial/)
  })
})
