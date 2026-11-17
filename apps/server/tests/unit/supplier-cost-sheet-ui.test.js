import { describe, expect, it } from 'vitest'
import {
  buildSupplierCostSheetCommitPayload,
  createSupplierCostSheetPreviewState,
  supplierCostSheetDetailProductLabel,
  supplierCostSheetErrorMessage,
  supplierCostSheetPreviewReducer,
} from '@/modules/procurement/components/cost-sheet-ui'

// @req FR-164, FR-154 — preview suggestions remain unconfirmed until a person chooses a Product.
// @spec ZAI:PROPOSAL-SMARTGIFT-COST-QUOTE-ENGINE-20260913; TASK-ZAI-053
// @tested tests/unit/supplier-cost-sheet-ui.test.js

describe('supplier cost-sheet UI logic', () => {
  it('does not accept Product mapping suggestions when a preview first loads', () => {
    const state = supplierCostSheetPreviewReducer(createSupplierCostSheetPreviewState(), {
      type: 'previewSucceeded',
      sheet: { id: 'sheet-1', preview: { hash: 'hash', lines: [{ sku: 'SKU-A', mapping: { productId: 'product-a', confidence: 'EXACT_PRODUCT_CODE' } }] } },
    })

    expect(state.mappings).toEqual({})
  })

  it('restores only persisted Product mappings when a replay returns a confirmed sheet', () => {
    const state = supplierCostSheetPreviewReducer(createSupplierCostSheetPreviewState(), {
      type: 'previewSucceeded',
      sheet: {
        id: 'sheet-1',
        status: 'CONFIRMED',
        preview: { hash: 'hash', lines: [{ sku: 'SKU-A', mapping: { candidates: [{ productId: 'suggested-only' }] } }] },
        lines: [
          { sourceSku: 'SKU-A', productId: 'saved-product' },
          { sourceSku: 'SKU-A', productId: 'saved-product' },
        ],
      },
    })

    expect(state.mappings).toEqual({ 'SKU-A': { productId: 'saved-product', confirmed: true } })
  })

  it('uses the server-saved mappings when a commit response is a replay', () => {
    const draft = supplierCostSheetPreviewReducer(createSupplierCostSheetPreviewState(), {
      type: 'previewSucceeded',
      sheet: { id: 'sheet-1', status: 'DRAFT', preview: { hash: 'hash', lines: [{ sku: 'SKU-A' }] } },
    })
    const locallyMapped = supplierCostSheetPreviewReducer(draft, {
      type: 'mappingChanged', sourceSku: 'SKU-A', productId: 'local-choice',
    })
    const result = supplierCostSheetPreviewReducer(locallyMapped, {
      type: 'commitSucceeded',
      replayed: true,
      sheet: { id: 'sheet-1', status: 'CONFIRMED', lines: [{ sourceSku: 'SKU-A', productId: 'saved-choice' }] },
    })

    expect(result.mappings).toEqual({ 'SKU-A': { productId: 'saved-choice', confirmed: true } })
  })

  it('labels draft Product candidates as unconfirmed suggestions', () => {
    expect(supplierCostSheetDetailProductLabel({
      status: 'DRAFT',
      line: { mapping: { candidates: [{ productId: 'product-a', code: 'P-A', name: 'Gift Box' }] } },
    })).toBe('คำแนะนำ (ยังไม่ยืนยัน): P-A · Gift Box')
  })

  it('builds a commit payload from confirmed mappings for this preview only', () => {
    const sheet = { id: 'sheet-1', preview: { hash: 'preview-hash', lines: [{ sku: 'SKU-A' }, { sku: 'SKU-B' }] } }
    const payload = buildSupplierCostSheetCommitPayload({
      businessId: 'business-1',
      sheet,
      mappings: {
        'SKU-A': { productId: 'product-a', confirmed: true },
        'SKU-B': { productId: 'suggested-only', confirmed: false },
        'SKU-OLD': { productId: 'old-product', confirmed: true },
      },
    })

    expect(payload).toEqual({
      businessId: 'business-1',
      sheetId: 'sheet-1',
      previewHash: 'preview-hash',
      mappings: [{ sourceSku: 'SKU-A', productId: 'product-a', confirmed: true }],
    })
  })

  it('preserves supplier SKUs that collide with object prototype keys', () => {
    const preview = supplierCostSheetPreviewReducer(createSupplierCostSheetPreviewState(), {
      type: 'previewSucceeded',
      sheet: { id: 'sheet-prototype', preview: { hash: 'hash', lines: [{ sku: '__proto__' }] } },
    })
    const mapped = supplierCostSheetPreviewReducer(preview, {
      type: 'mappingChanged', sourceSku: '__proto__', productId: 'product-safe',
    })

    expect(buildSupplierCostSheetCommitPayload({
      businessId: 'business-1', sheet: preview.sheet, mappings: mapped.mappings,
    }).mappings).toEqual([{ sourceSku: '__proto__', productId: 'product-safe', confirmed: true }])
  })

  it('maps stale-preview, mapping, and authority errors to clear Thai messages', () => {
    expect(supplierCostSheetErrorMessage('PROCUREMENT_COST_SHEET_PREVIEW_STALE')).toContain('Preview')
    expect(supplierCostSheetErrorMessage('PROCUREMENT_COST_SHEET_MAPPING_UNCONFIRMED')).toContain('ยืนยัน Product')
    expect(supplierCostSheetErrorMessage('Business not found')).toContain('ไม่มีสิทธิ์')
  })

  it('clears preview, selections, and result when supplier or file changes', () => {
    const populated = supplierCostSheetPreviewReducer(createSupplierCostSheetPreviewState(), {
      type: 'previewSucceeded',
      sheet: { id: 'sheet-1', preview: { hash: 'hash', lines: [{ sku: 'SKU-A' }] } },
    })
    const mapped = supplierCostSheetPreviewReducer(populated, { type: 'mappingChanged', sourceSku: 'SKU-A', productId: 'product-a' })
    const committed = supplierCostSheetPreviewReducer(mapped, { type: 'commitSucceeded', sheet: mapped.sheet, replayed: false })

    for (const type of ['supplierChanged', 'fileChanged']) {
      expect(supplierCostSheetPreviewReducer(committed, { type })).toEqual({ sheet: null, mappings: {}, commitResult: null })
    }
  })
})
