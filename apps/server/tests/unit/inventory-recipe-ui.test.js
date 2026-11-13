// @req FR-156, FR-177 — recipe payloads, line validation, service-error translation
//   and draft reset are pure and follow the recipe service's accepted shapes.
// @spec BR-002; SEC-001
// @tested tests/unit/inventory-recipe-ui.test.js
import { describe, expect, it } from 'vitest'
import {
  buildRecipeArchivePayload,
  buildRecipeBuildPayload,
  buildRecipeCreatePayload,
  buildRecipeUpdatePayload,
  recipeErrorMessage,
  resetRecipeDraft,
  validateRecipeLines,
} from '@/modules/inventory/components/recipe-ui'

describe('FR-156 recipe management UI logic', () => {
  it('builds a create payload using only the fields accepted by the recipe service', () => {
    expect(buildRecipeCreatePayload({
      businessId: ' business-1 ',
      code: ' RCP-1 ',
      productId: ' output-1 ',
      name: ' Gift box ',
      batchSize: '10',
      yieldQty: '12',
      unit: ' EA ',
      notes: ' ',
      scrapAllowanceFactor: '0.02',
      lines: [{ componentProductId: ' ribbon-1 ', qty: '2.5', unit: ' m ', fixed: true, note: ' one per batch ' }],
    })).toEqual({
      businessId: 'business-1',
      code: 'RCP-1',
      productId: 'output-1',
      name: 'Gift box',
      batchSize: 10,
      yieldQty: 12,
      unit: 'EA',
      scrapAllowanceFactor: 0.02,
      lines: [{ componentProductId: 'ribbon-1', qty: 2.5, fixed: true, unit: 'm', note: 'one per batch' }],
    })
  })

  it('builds UPDATE and ARCHIVE actions with versioned service payloads', () => {
    expect(buildRecipeUpdatePayload({
      version: '3',
      name: ' Gift box v2 ',
      yieldQty: '12',
      unit: 'EA',
      notes: '',
      scrapAllowanceFactor: '0.05',
      lines: [{ componentProductId: 'ribbon-1', qty: '2', fixed: false }],
    })).toEqual({
      action: 'UPDATE',
      version: 3,
      fields: {
        name: 'Gift box v2',
        yieldQty: 12,
        unit: 'EA',
        notes: null,
        scrapAllowanceFactor: 0.05,
        lines: [{ componentProductId: 'ribbon-1', qty: 2, fixed: false }],
      },
    })
    expect(buildRecipeArchivePayload('4')).toEqual({ action: 'ARCHIVE', version: 4 })
  })

  it('builds the required build fields and only includes an entered output Lot code', () => {
    expect(buildRecipeBuildPayload({ businessId: 'business-1', quantity: '5', outputLotCode: ' LOT-5 ' }))
      .toEqual({ businessId: 'business-1', quantity: 5, outputLotCode: 'LOT-5' })
    expect(buildRecipeBuildPayload({ businessId: 'business-1', quantity: '5', outputLotCode: '' }))
      .toEqual({ businessId: 'business-1', quantity: 5 })
  })

  it('validates component selection, distinct Products, positive quantities and exact line limits', () => {
    expect(validateRecipeLines([], 'output-1')).toEqual(['เพิ่มส่วนประกอบอย่างน้อย 1 รายการ'])
    expect(validateRecipeLines([
      { componentProductId: '', qty: 1 },
      { componentProductId: 'output-1', qty: 1 },
      { componentProductId: 'part-1', qty: 0 },
      { componentProductId: 'part-1', qty: 1 },
    ], 'output-1')).toEqual([
      'กรุณาเลือก Product ของส่วนประกอบรายการที่ 1',
      'Product ผลลัพธ์ห้ามเป็นส่วนประกอบของสูตรเดียวกัน',
      'จำนวนต่อ batch ของส่วนประกอบรายการที่ 3 ต้องมากกว่า 0',
      'เลือก Product ซ้ำในสูตรเดียวกันไม่ได้',
    ])
    expect(validateRecipeLines([{ componentProductId: 'part-1', qty: 1, unit: 'x'.repeat(21) }], 'output-1'))
      .toContain('หน่วยของส่วนประกอบรายการที่ 1 ยาวได้ไม่เกิน 20 ตัวอักษร')
    expect(validateRecipeLines(Array.from({ length: 201 }, (_, index) => ({
      componentProductId: 'part-' + index,
      qty: 1,
    })), 'output-1')).toContain('สูตรมีส่วนประกอบได้ไม่เกิน 200 รายการ')
  })

  it('maps stock shortage and hidden-Business authority refusals to Thai', () => {
    expect(recipeErrorMessage({
      status: 409,
      payload: { error: 'INVENTORY_RECIPE_SHORTAGE', details: [{ code: 'RIBBON', shortage: 2 }] },
    })).toBe('สต๊อกส่วนประกอบไม่พอสำหรับจำนวนที่ต้องการผลิต')
    expect(recipeErrorMessage({ status: 404, payload: { error: 'Business not found' } }))
      .toBe('ไม่พบสูตรหรือ Business นี้ หรือคุณไม่มีสิทธิ์ดำเนินการ')
    expect(recipeErrorMessage('PRODUCT_RECIPE_VERSION_CONFLICT'))
      .toBe('สูตรถูกแก้ไขไปแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนบันทึก')
  })

  it('resets the recipe draft to independent empty component state', () => {
    const first = resetRecipeDraft()
    first.lines[0].qty = '9'
    const next = resetRecipeDraft()
    expect(next).toMatchObject({ code: '', name: '', productId: '', batchSize: '', unit: '', scrapAllowanceFactor: '0' })
    expect(next.lines).toEqual([{ componentProductId: '', qty: '', unit: '', fixed: false, note: '' }])
    expect(next).not.toBe(first)
    expect(next.lines).not.toBe(first.lines)
    expect(next.lines[0].qty).toBe('')
  })
})
