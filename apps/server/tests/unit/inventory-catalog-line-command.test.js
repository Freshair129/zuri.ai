// @req FR-210 — the `#sku` LINE command parser and reply formatters: only a
//   message that starts with `#sku` is a command; Thai and English keys build
//   the same items JSON and Excel produce; a digit run is declared a GTIN so a
//   typo is refused by its check digit; unknown keys are reported, never
//   dropped; confirm and cancel name a preview code; replies stay under the
//   LINE limit and say how to confirm only when the plan is committable.
// @spec ADR-084 D4
// @tested tests/unit/inventory-catalog-line-command.test.js
import { describe, expect, it } from 'vitest'
import {
  LINE_CATALOG_HELP,
  LINE_REPLY_MAX,
  formatLineCatalogError,
  formatLineCatalogPreview,
  formatLineCatalogResult,
  formatLineCatalogUnknownKeys,
  parseLineCatalogCommand,
} from '@/modules/inventory/import/catalog-line-command'
import { zCatalogIntakeItem } from '@/modules/inventory/domain/catalog-intake'

describe('FR-210 parser', () => {
  it('ignores anything that is not a #sku command', () => {
    for (const text of ['สวัสดีครับ', 'มี sku อะไรบ้าง', '#skus', 'sku: A', '', null, 42]) expect(parseLineCatalogCommand(text)).toBeNull()
  })

  it('answers help, confirm and cancel', () => {
    expect(parseLineCatalogCommand('#sku')).toEqual({ kind: 'HELP' })
    expect(parseLineCatalogCommand('  #SKU help ')).toEqual({ kind: 'HELP' })
    expect(parseLineCatalogCommand('#sku ยืนยัน cit-1a2b3c4d')).toEqual({ kind: 'CONFIRM', code: 'CIT-1A2B3C4D' })
    expect(parseLineCatalogCommand('#sku cancel CIT-1A2B3C4D')).toEqual({ kind: 'CANCEL', code: 'CIT-1A2B3C4D' })
    expect(parseLineCatalogCommand('#sku ยืนยัน')).toEqual({ kind: 'HELP', reason: 'CODE_REQUIRED' })
  })

  it('builds items from Thai and English keys, separated by ---', () => {
    const command = parseLineCatalogCommand([
      '#sku',
      'รหัส: TMB-BLK',
      'ชื่อ: แก้วเก็บความเย็น สีดำ',
      'สินค้าหลัก: PM-TUMBLER',
      'หมวด: CAT-DRINK',
      'ชื่อสินค้าหลัก: แก้วเก็บความเย็น',
      'ประเภท: สินค้า',
      'แกน: color, size',
      'สี: ดำ',
      'variant: size=M',
      'นโยบาย: ไม่นับสต๊อก',
      'บาร์โค้ด: 4006381333931, PACK-A',
      'รหัสซัพพลายเออร์: ACME-1',
      'หน่วยแปลง: BOX12=12, CTN=144',
      'จุดสั่งซื้อ: 20',
      '---',
      'code: TMB-RED',
      'master: PM-TUMBLER',
      'barcode ： 1234',
    ].join('\n'))
    expect(command.kind).toBe('PREVIEW')
    expect(command.unknownKeys).toEqual([])
    expect(command.items).toEqual([
      {
        ref: 'รายการ 1',
        sku: { code: 'TMB-BLK', name: 'แก้วเก็บความเย็น สีดำ', color: 'ดำ', variant: { size: 'M' }, stockPolicy: 'UNTRACKED', reorderPoint: 20 },
        master: { code: 'PM-TUMBLER', categoryCode: 'CAT-DRINK', nameTh: 'แก้วเก็บความเย็น', nameEn: 'แก้วเก็บความเย็น', nature: 'GOOD', variantAxes: ['color', 'size'] },
        identifiers: [{ kind: 'GTIN', value: '4006381333931' }, { kind: 'BARCODE', value: 'PACK-A' }, { kind: 'SUPPLIER_CODE', value: 'ACME-1' }],
        unitConversions: [{ unit: 'BOX12', factor: 12 }, { unit: 'CTN', factor: 144 }],
      },
      { ref: 'รายการ 2', sku: { code: 'TMB-RED' }, master: { code: 'PM-TUMBLER' }, identifiers: [{ kind: 'BARCODE', value: '1234' }] },
    ])
    expect(zCatalogIntakeItem.safeParse(command.items[0]).success).toBe(true)
  })

  it('declares a digit run a GTIN so a typo is refused, and reports unknown keys instead of dropping them', () => {
    const typo = parseLineCatalogCommand('#sku\nรหัส: A\nสินค้าหลัก: PM\nบาร์โค้ด: 4006381333932')
    expect(typo.items[0].identifiers).toEqual([{ kind: 'GTIN', value: '4006381333932' }])
    expect(zCatalogIntakeItem.safeParse(typo.items[0]).success).toBe(false)
    const unknown = parseLineCatalogCommand('#sku\nรหัส: A\nราคา: 99\nแค่ข้อความ')
    expect(unknown.unknownKeys).toEqual([{ line: 3, key: 'ราคา' }, { line: 4, key: 'แค่ข้อความ' }])
  })
})

const plan = (items, committable) => ({ items, committable, counts: { total: items.length, create: items.filter((i) => i.decision === 'CREATE').length, match: items.filter((i) => i.decision === 'MATCH').length, unchanged: items.filter((i) => i.decision === 'UNCHANGED').length, conflict: items.filter((i) => i.decision === 'CONFLICT').length, invalid: items.filter((i) => i.decision === 'INVALID').length } })

describe('FR-210 replies', () => {
  it('lists each decision, and offers confirmation only for a committable plan', () => {
    const ok = formatLineCatalogPreview({ code: 'CIT-AAAAAAAA', status: 'PREVIEWED', plan: plan([
      { code: 'NEW-1', decision: 'CREATE', master: { code: 'PM-A', created: true }, actions: [{ type: 'CREATE_PRODUCT' }, { type: 'ADD_IDENTIFIER', payload: { value: '885' } }], issues: [] },
      { code: 'X', decision: 'MATCH', matchedBy: 'IDENTIFIER', product: { code: 'OLD-1' }, actions: [{ type: 'ADD_UNIT_CONVERSION', payload: { unit: 'BOX12', factor: 12 } }], issues: [] },
    ], true) })
    expect(ok).toContain('ผลตรวจรายการสินค้า CIT-AAAAAAAA (2 รายการ)')
    expect(ok).toContain('1) NEW-1 — สร้าง SKU ใหม่ใต้ PM-A (สินค้าหลักใหม่) + บาร์โค้ด/รหัส 885')
    expect(ok).toContain('2) X — พบ SKU เดิม OLD-1 (ตรงบาร์โค้ด/รหัสคู่ค้า) · เพิ่ม หน่วย BOX12=12')
    expect(ok).toContain('#sku ยืนยัน CIT-AAAAAAAA')
    const bad = formatLineCatalogPreview({ code: 'CIT-BBBBBBBB', status: 'PREVIEWED', plan: plan([{ code: 'D', decision: 'CONFLICT', actions: [], issues: [{ code: 'INTAKE_DUPLICATE_IN_BATCH', message: 'ซ้ำ' }, { code: 'X', message: 'y' }] }], false) })
    expect(bad).toContain('1) D — ติดปัญหา: ซ้ำ (+1)')
    expect(bad).not.toContain('ยืนยัน CIT')
    const long = formatLineCatalogPreview({ code: 'CIT-CCCCCCCC', status: 'PREVIEWED', plan: plan(Array.from({ length: 400 }, (_, i) => ({ code: `S-${i}`.padEnd(60, 'x'), decision: 'INVALID', actions: [], issues: [{ message: 'y'.repeat(300) }] })), false) })
    expect(long.length).toBeLessThanOrEqual(LINE_REPLY_MAX)
    // Long lines are clipped, at most 15 are listed, the rest are counted — and the footer is never the part cut off.
    expect(long).toContain('…และอีก 385 รายการ')
    expect(long.trimEnd().endsWith('(บันทึกทั้งชุดหรือไม่บันทึกเลย)')).toBe(true)
    expect(long.split('\n').every((line) => line.length <= 240)).toBe(true)
  })

  it('reports the result, unknown keys, help and each refusal', () => {
    expect(formatLineCatalogResult({ code: 'CIT-AAAAAAAA', result: { created: [{ code: 'NEW-1' }], matched: [{ productCode: 'OLD-1', additions: 2 }], unchanged: [], mastersCreated: [{ code: 'PM-A' }] } })).toContain('สร้าง SKU ใหม่ 1 (สินค้าหลักใหม่ 1) · เพิ่มข้อมูลให้ SKU เดิม 1')
    expect(formatLineCatalogUnknownKeys([{ line: 3, key: 'ราคา' }])).toContain('บรรทัด 3: "ราคา"')
    expect(LINE_CATALOG_HELP).toContain('#sku ยืนยัน CIT-XXXXXXXX')
    expect(formatLineCatalogError({ status: 404 })).toMatch(/ไม่พบรายการนี้/)
    expect(formatLineCatalogError({ message: 'INVENTORY_CATALOG_INTAKE_PLAN_STALE', status: 409 })).toMatch(/ตรวจใหม่/)
    expect(formatLineCatalogError({ issues: [{}] })).toMatch(/ไม่เกิน 500/)
    expect(formatLineCatalogError(new Error('boom'))).toMatch(/ไม่สำเร็จ/)
  })
})
