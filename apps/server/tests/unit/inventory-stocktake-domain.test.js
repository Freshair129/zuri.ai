// @req FR-184 — strict physical stocktake input: UUID joins, explicit
// location/null and LOT/null identity, non-negative integer counts, stable
// normalization and bounded idempotency keys.
// @spec ADR-074 D1, D2; BR-002, BR-008, BR-012, BR-026
// @tested tests/unit/inventory-stocktake-domain.test.js
import { describe, expect, it } from 'vitest'
import {
  hashStocktake,
  normalizeStocktakeLines,
  stocktakeLineKey,
  zStocktakeCommitInput,
  zStocktakePreviewInput,
} from '@/modules/inventory/domain/inventory-stocktake'

const businessId = '00000000-0000-4000-8000-000000000001'
const productId = '00000000-0000-4000-8000-000000000002'
const locationId = '00000000-0000-4000-8000-000000000003'
const previewId = '00000000-0000-4000-8000-000000000004'
const line = { productId, locationId, lotId: null, countedQuantity: 4 }

describe('FR-184 stocktake input contract', () => {
  it('requires UUID identities and an explicit location choice', () => {
    expect(zStocktakePreviewInput.parse({ businessId, lines: [line] })).toMatchObject({ businessId, lines: [line] })
    expect(zStocktakePreviewInput.parse({ businessId, lines: [{ ...line, locationId: null }] }).lines[0].locationId).toBeNull()
    expect(() => zStocktakePreviewInput.parse({ businessId: 'business', lines: [line] })).toThrow()
    expect(() => zStocktakePreviewInput.parse({ businessId, lines: [{ productId, lotId: null, countedQuantity: 4 }] })).toThrow()
    expect(() => zStocktakePreviewInput.parse({ businessId, lines: [{ ...line, countedQuantity: 1.5 }] })).toThrow()
    expect(() => zStocktakePreviewInput.parse({ businessId, lines: [{ ...line, countedQuantity: -1 }] })).toThrow()
  })

  it('normalizes line order and rejects duplicate product/location/lot buckets', () => {
    const other = { productId, locationId: null, lotId: null, countedQuantity: 0 }
    const normalized = normalizeStocktakeLines([line, other])
    const keys = normalized.map(stocktakeLineKey)
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)))
    expect(() => normalizeStocktakeLines([line, line])).toThrow(/DUPLICATE_LINE/)
  })

  it('keeps the commit key bounded and hashes the canonical payload deterministically', () => {
    const input = { businessId, previewId, snapshotToken: 'a'.repeat(64), idempotencyKey: 'stocktake-1', lines: [line] }
    expect(zStocktakeCommitInput.parse(input).idempotencyKey).toBe('stocktake-1')
    expect(() => zStocktakeCommitInput.parse({ ...input, idempotencyKey: '' })).toThrow()
    expect(hashStocktake(input)).toBe(hashStocktake(input))
  })
})
