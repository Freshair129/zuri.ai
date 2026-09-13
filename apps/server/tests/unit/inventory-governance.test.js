// @req FR-201 — the nature rule: a SERVICE master yields SERVICE and refuses
//   anything else; a GOOD master yields the request or its default and refuses
//   SERVICE.
// @req FR-202 — normalization, variant values from axes (with the legacy
//   colour / material columns standing in), the variant key, and the
//   exact-match lookalike fingerprint that says nothing when nothing is said.
// @req FR-203 — the GTIN check digit and the shared value space of the two
//   scannable kinds.
// @req FR-204 — base-unit conversion: pass-through, factor, unknown unit,
//   never on a serial product.
// @req FR-205 — the lifecycle rule per status, the archive guard, the merge
//   rule (same nature, living survivor, stock moves only NONE→NONE).
// @req FR-206 — the hygiene report over plain rows: every kind fires on the
//   row built to fire it and on nothing else, and the report is pure.
// @req FR-207 — the replenishment row: threshold, suggestion, exclusions.
// @spec ADR-083 D1..D6; BR-037, BR-038, BR-039, BR-040
// @tested tests/unit/inventory-governance.test.js
import { describe, expect, it } from 'vitest'
import {
  archiveGuard,
  hygieneReport,
  identifierCollision,
  isValidGtin,
  lookalikeFingerprint,
  mergeRule,
  natureAgrees,
  natureRule,
  normalizeToken,
  parseVariant,
  parseVariantAxes,
  productLifecycleRule,
  replenishmentRow,
  toBaseQuantity,
  variantKeyFor,
  variantValues,
  zCreateIdentifier,
  zCreateUnitConversion,
  zVariantAxes,
} from '@/modules/inventory/domain/inventory-governance'
import { movementRule, stockSummaryRow, zCreateProductMaster, zProductAction } from '@/modules/inventory/domain/inventory'
import { INVENTORY_HYGIENE_FINDING_KINDS, INVENTORY_PRODUCT_ACTIONS } from '@/lib/validation/enums'

describe('FR-201 nature at the master', () => {
  it('a SERVICE master yields SERVICE and refuses a good; a GOOD master yields the request or its default and refuses a service', () => {
    expect(natureRule({ nature: 'SERVICE' }, undefined)).toMatchObject({ ok: true, stockPolicy: 'SERVICE' })
    expect(natureRule({ nature: 'SERVICE' }, 'SERVICE')).toMatchObject({ ok: true, stockPolicy: 'SERVICE' })
    expect(natureRule({ nature: 'SERVICE' }, 'TRACKED')).toMatchObject({ ok: false, code: 'INVENTORY_NATURE_MISMATCH' })
    expect(natureRule({ nature: 'GOOD', defaultStockPolicy: 'UNTRACKED' }, undefined)).toMatchObject({ ok: true, stockPolicy: 'UNTRACKED' })
    expect(natureRule({ nature: 'GOOD' }, 'TRACKED')).toMatchObject({ ok: true, stockPolicy: 'TRACKED' })
    expect(natureRule({ nature: 'GOOD' }, 'SERVICE')).toMatchObject({ ok: false, code: 'INVENTORY_NATURE_MISMATCH' })
    // A master written before ADR-083 has no nature column value in memory: it reads as GOOD.
    expect(natureRule({}, undefined)).toMatchObject({ ok: true, stockPolicy: 'TRACKED' })
    expect(natureAgrees('GOOD', 'UNTRACKED')).toBe(true)
    expect(natureAgrees('GOOD', 'SERVICE')).toBe(false)
    expect(natureAgrees('SERVICE', 'SERVICE')).toBe(true)
    expect(natureAgrees('SERVICE', 'TRACKED')).toBe(false)
  })

  it('the master contract refuses a default policy or axes on a SERVICE master', () => {
    const base = { businessId: 'b', code: 'PM-1', categoryId: 'c', nameTh: 'x', nameEn: 'x' }
    expect(zCreateProductMaster.parse({ ...base, nature: 'GOOD', defaultStockPolicy: 'UNTRACKED', variantAxes: ['color'] }).variantAxes).toEqual(['color'])
    expect(() => zCreateProductMaster.parse({ ...base, nature: 'SERVICE', defaultStockPolicy: 'TRACKED' })).toThrow(/no stock policy/)
    expect(() => zCreateProductMaster.parse({ ...base, nature: 'SERVICE', variantAxes: ['color'] })).toThrow(/no physical variants/)
    expect(() => zCreateProductMaster.parse({ ...base, defaultStockPolicy: 'SERVICE' })).toThrow()
  })
})

describe('FR-202 variant identity', () => {
  it('normalizes to one token: case, spacing and punctuation vanish, Thai marks survive', () => {
    expect(normalizeToken('Tumbler  Black')).toBe('tumblerblack')
    expect(normalizeToken('tumbler-black')).toBe('tumblerblack')
    expect(normalizeToken(' TUMBLER_BLACK ')).toBe('tumblerblack')
    expect(normalizeToken('แก้ว น้ำ')).toBe('แก้วน้ำ')
    expect(normalizeToken(null)).toBe('')
    expect(normalizeToken(12)).toBe('12')
  })

  it('reads every declared axis from the variant or the legacy column, and reports what is missing or unknown', () => {
    expect(variantValues(['color', 'size'], { variant: { color: 'Black', size: 'M' } })).toEqual({ values: { color: 'Black', size: 'M' }, missing: [], extra: [] })
    expect(variantValues(['color', 'material'], { variant: {}, color: 'black', material: 'steel' })).toEqual({ values: { color: 'black', material: 'steel' }, missing: [], extra: [] })
    expect(variantValues(['color', 'size'], { variant: { color: 'black' } })).toMatchObject({ missing: ['size'] })
    expect(variantValues(['color'], { variant: { color: 'black', size: 'M' } })).toMatchObject({ extra: ['size'] })
    expect(variantValues([], { variant: {} })).toEqual({ values: {}, missing: [], extra: [] })
  })

  it('the variant key is the normalized axis=value chain in axis order, and null without axes', () => {
    expect(variantKeyFor(['color', 'size'], { color: 'Black ', size: 'm' })).toBe('color=black|size=m')
    expect(variantKeyFor(['size', 'color'], { color: 'Black', size: 'M' })).toBe('size=m|color=black')
    expect(variantKeyFor([], {})).toBeNull()
    expect(zVariantAxes.parse(['color', 'pack_size'])).toEqual(['color', 'pack_size'])
    expect(() => zVariantAxes.parse(['Color'])).toThrow()
    expect(() => zVariantAxes.parse(['color', 'color'])).toThrow(/once/)
    expect(parseVariantAxes('["color","size"]')).toEqual(['color', 'size'])
    expect(parseVariantAxes('not json')).toEqual([])
    expect(parseVariant('{"color":"black","n":1}')).toEqual({ color: 'black' })
  })

  it('the lookalike fingerprint matches an exact description and says nothing when nothing is said', () => {
    expect(lookalikeFingerprint({ name: 'Tumbler black', color: 'Black' })).toBe(lookalikeFingerprint({ name: 'tumbler-black', color: 'black' }))
    expect(lookalikeFingerprint({ name: 'Tumbler black' })).not.toBe(lookalikeFingerprint({ name: 'Tumbler red' }))
    expect(lookalikeFingerprint({ name: 'Tumbler', variantKey: 'color=black' })).not.toBe(lookalikeFingerprint({ name: 'Tumbler', variantKey: 'color=red' }))
    expect(lookalikeFingerprint({})).toBeNull()
    expect(lookalikeFingerprint({ name: '  ', color: null })).toBeNull()
  })
})

describe('FR-203 identifiers', () => {
  it('validates the GS1 check digit for 8, 12, 13 and 14 digits', () => {
    expect(isValidGtin('4006381333931')).toBe(true) // EAN-13
    expect(isValidGtin('036000291452')).toBe(true) // UPC-A
    expect(isValidGtin('96385074')).toBe(true) // EAN-8
    expect(isValidGtin('10614141000415')).toBe(true) // GTIN-14
    expect(isValidGtin('4006381333932')).toBe(false)
    expect(isValidGtin('12345')).toBe(false)
    expect(isValidGtin('ABC')).toBe(false)
    expect(() => zCreateIdentifier.parse({ businessId: 'b', kind: 'GTIN', value: '4006381333932' })).toThrow(/check digit/)
    expect(zCreateIdentifier.parse({ businessId: 'b', kind: 'BARCODE', value: 'X-77' }).value).toBe('X-77')
    expect(() => zCreateIdentifier.parse({ businessId: 'b', kind: 'BARCODE', value: 'has space' })).toThrow()
  })

  it('a scannable value is one thing whatever its label; other kinds collide only with themselves', () => {
    const existing = [{ kind: 'GTIN', value: '4006381333931', productId: 'p1' }, { kind: 'SUPPLIER_CODE', value: 'ACME-1', productId: 'p2' }]
    expect(identifierCollision('BARCODE', '4006381333931', existing)?.productId).toBe('p1')
    expect(identifierCollision('GTIN', '4006381333931', existing)?.productId).toBe('p1')
    expect(identifierCollision('SUPPLIER_CODE', '4006381333931', existing)).toBeNull()
    expect(identifierCollision('SUPPLIER_CODE', 'ACME-1', existing)?.productId).toBe('p2')
    expect(identifierCollision('MANUFACTURER_PART', 'ACME-1', existing)).toBeNull()
  })
})

describe('FR-204 unit conversions', () => {
  const product = { unit: 'EA', trackingMode: 'NONE' }
  const conversions = [{ unit: 'BOX12', factor: 12, status: 'ACTIVE' }, { unit: 'OLD', factor: 6, status: 'RETIRED' }]

  it('converts through an active factor, passes the base unit through, refuses an unknown or retired unit and any unit on a serial product', () => {
    expect(toBaseQuantity(product, 2, 'BOX12', conversions)).toMatchObject({ ok: true, quantity: 24, factor: 12 })
    expect(toBaseQuantity(product, -1, 'BOX12', conversions)).toMatchObject({ ok: true, quantity: -12 })
    expect(toBaseQuantity(product, 5, 'EA', conversions)).toMatchObject({ ok: true, quantity: 5, factor: 1 })
    expect(toBaseQuantity(product, 5, undefined, conversions)).toMatchObject({ ok: true, quantity: 5 })
    expect(toBaseQuantity(product, 1, 'OLD', conversions)).toMatchObject({ ok: false, code: 'INVENTORY_UNIT_UNKNOWN' })
    expect(toBaseQuantity(product, 1, 'PALLET', conversions)).toMatchObject({ ok: false, code: 'INVENTORY_UNIT_UNKNOWN' })
    expect(toBaseQuantity({ unit: 'EA', trackingMode: 'SERIAL' }, 1, 'BOX12', conversions)).toMatchObject({ ok: false, code: 'INVENTORY_UNIT_NOT_FOR_SERIAL' })
    expect(zCreateUnitConversion.parse({ businessId: 'b', unit: 'BOX12', factor: 12 }).factor).toBe(12)
    expect(() => zCreateUnitConversion.parse({ businessId: 'b', unit: 'BOX12', factor: 1.5 })).toThrow()
    expect(() => zCreateUnitConversion.parse({ businessId: 'b', unit: 'a box', factor: 12 })).toThrow()
  })
})

describe('FR-205 lifecycle', () => {
  const active = { status: 'ACTIVE', stockPolicy: 'TRACKED', trackingMode: 'NONE', businessId: 'b', id: 'dup' }

  it('the action vocabulary is five and the contract ties `into` to MERGE and `fields` to UPDATE', () => {
    expect(INVENTORY_PRODUCT_ACTIONS).toEqual(['UPDATE', 'ARCHIVE', 'PHASE_OUT', 'REACTIVATE', 'MERGE'])
    expect(zProductAction.parse({ action: 'MERGE', version: 1, into: 'p2', reason: 'duplicate' }).into).toBe('p2')
    expect(() => zProductAction.parse({ action: 'MERGE', version: 1 })).toThrow(/into/)
    expect(() => zProductAction.parse({ action: 'ARCHIVE', version: 1, into: 'p2' })).toThrow(/only MERGE/)
    expect(() => zProductAction.parse({ action: 'PHASE_OUT', version: 1, fields: { name: 'x' } })).toThrow(/only UPDATE/)
    expect(zProductAction.parse({ action: 'UPDATE', version: 2, fields: { reorderPoint: 20, reorderQty: 50, leadTimeDays: 7, variant: { color: 'red' } } }).fields.reorderQty).toBe(50)
  })

  it('each status admits its own actions; a merged duplicate admits none', () => {
    expect(productLifecycleRule(active, 'PHASE_OUT')).toMatchObject({ ok: true })
    expect(productLifecycleRule(active, 'REACTIVATE')).toMatchObject({ ok: false, code: 'INVENTORY_PRODUCT_ALREADY_ACTIVE' })
    expect(productLifecycleRule({ ...active, status: 'PHASE_OUT' }, 'PHASE_OUT')).toMatchObject({ ok: false, code: 'INVENTORY_PRODUCT_PHASED_OUT' })
    expect(productLifecycleRule({ ...active, status: 'PHASE_OUT' }, 'UPDATE')).toMatchObject({ ok: true })
    expect(productLifecycleRule({ ...active, status: 'PHASE_OUT' }, 'REACTIVATE')).toMatchObject({ ok: true })
    expect(productLifecycleRule({ ...active, status: 'ARCHIVED' }, 'UPDATE')).toMatchObject({ ok: false, code: 'PRODUCT_ARCHIVED' })
    expect(productLifecycleRule({ ...active, status: 'ARCHIVED' }, 'ARCHIVE')).toMatchObject({ ok: false, code: 'PRODUCT_ARCHIVED' })
    expect(productLifecycleRule({ ...active, status: 'ARCHIVED' }, 'REACTIVATE')).toMatchObject({ ok: true })
    expect(productLifecycleRule({ ...active, status: 'ARCHIVED', mergedIntoProductId: 'p2' }, 'REACTIVATE')).toMatchObject({ ok: false, code: 'INVENTORY_PRODUCT_MERGED' })
    expect(productLifecycleRule(active, 'EXPLODE')).toMatchObject({ ok: false, code: 'INVENTORY_PRODUCT_ACTION_UNKNOWN' })
  })

  it('a phased-out SKU refuses a receipt and still issues', () => {
    expect(movementRule({ ...active, status: 'PHASE_OUT' }, { kind: 'RECEIPT', quantity: 1 })).toMatchObject({ ok: false, code: 'INVENTORY_PRODUCT_PHASED_OUT' })
    expect(movementRule({ ...active, status: 'PHASE_OUT' }, { kind: 'ISSUE', quantity: 1 })).toMatchObject({ ok: true })
    expect(movementRule({ ...active, status: 'PHASE_OUT' }, { kind: 'ADJUSTMENT', quantity: -1 })).toMatchObject({ ok: true })
  })

  it('the archive guard holds a counted SKU with stock or a live promise (BR-040)', () => {
    expect(archiveGuard({ onHand: 0, activeReservations: 0 })).toMatchObject({ ok: true })
    expect(archiveGuard({ onHand: null, activeReservations: 0 })).toMatchObject({ ok: true })
    expect(archiveGuard({ onHand: 3 })).toMatchObject({ ok: false, code: 'INVENTORY_PRODUCT_HAS_STOCK' })
    expect(archiveGuard({ onHand: 0, activeReservations: 1 })).toMatchObject({ ok: false, code: 'INVENTORY_PRODUCT_HAS_RESERVATIONS' })
  })

  it('the merge rule: same Business, same nature, a living survivor, stock only NONE→NONE', () => {
    const survivor = { ...active, id: 'keep' }
    expect(mergeRule(active, survivor, { onHand: 0 })).toMatchObject({ ok: true, movesStock: false })
    expect(mergeRule(active, survivor, { onHand: 5 })).toMatchObject({ ok: true, movesStock: true })
    expect(mergeRule(active, null, {})).toMatchObject({ ok: false, code: 'INVENTORY_MERGE_TARGET_NOT_FOUND' })
    expect(mergeRule(active, active, {})).toMatchObject({ ok: false, code: 'INVENTORY_MERGE_INTO_SELF' })
    expect(mergeRule(active, { ...survivor, businessId: 'other' }, {})).toMatchObject({ ok: false, code: 'INVENTORY_MERGE_TARGET_NOT_FOUND' })
    expect(mergeRule(active, { ...survivor, status: 'PHASE_OUT' }, {})).toMatchObject({ ok: false, code: 'INVENTORY_MERGE_TARGET_NOT_ACTIVE' })
    expect(mergeRule(active, { ...survivor, mergedIntoProductId: 'x' }, {})).toMatchObject({ ok: false, code: 'INVENTORY_MERGE_TARGET_NOT_ACTIVE' })
    expect(mergeRule(active, { ...survivor, stockPolicy: 'UNTRACKED' }, {})).toMatchObject({ ok: false, code: 'INVENTORY_MERGE_NATURE_MISMATCH' })
    expect(mergeRule(active, survivor, { onHand: 0, activeReservations: 2 })).toMatchObject({ ok: false, code: 'INVENTORY_PRODUCT_HAS_RESERVATIONS' })
    expect(mergeRule({ ...active, trackingMode: 'LOT' }, survivor, { onHand: 5 })).toMatchObject({ ok: false, code: 'INVENTORY_MERGE_REQUIRES_EMPTY_STOCK' })
    expect(mergeRule({ ...active, trackingMode: 'LOT' }, survivor, { onHand: 0 })).toMatchObject({ ok: true, movesStock: false })
    expect(mergeRule(active, { ...survivor, trackingMode: 'SERIAL' }, { onHand: 5 })).toMatchObject({ ok: false, code: 'INVENTORY_MERGE_REQUIRES_EMPTY_STOCK' })
  })
})

describe('FR-207 replenishment', () => {
  const sku = { id: 'p', code: 'SKU', name: 'x', unit: 'EA', stockPolicy: 'TRACKED', status: 'ACTIVE', safetyStock: 4 }

  it('suggests below the reorder point or the safety stock, the declared quantity or the gap, and never for a service, an uncounted, a phased-out or a stocked SKU', () => {
    expect(replenishmentRow({ ...sku, reorderPoint: 20, reorderQty: 50, leadTimeDays: 7 }, 5)).toMatchObject({ threshold: 20, suggestedQty: 50, leadTimeDays: 7, onHand: 5 })
    expect(replenishmentRow(sku, 3)).toMatchObject({ threshold: 4, suggestedQty: 1, reorderPoint: null })
    expect(replenishmentRow(sku, 4)).toBeNull()
    expect(replenishmentRow({ ...sku, status: 'PHASE_OUT' }, 0)).toBeNull()
    expect(replenishmentRow({ ...sku, stockPolicy: 'UNTRACKED' }, null)).toBeNull()
    expect(replenishmentRow({ ...sku, stockPolicy: 'SERVICE' }, null)).toBeNull()
    expect(stockSummaryRow({ ...sku, trackingMode: 'NONE', reorderPoint: 10 }, [{ quantity: 6 }])).toMatchObject({ belowSafetyStock: false, belowReorderPoint: true, reorderPoint: 10, status: 'ACTIVE' })
    expect(stockSummaryRow({ ...sku, trackingMode: 'NONE', status: 'PHASE_OUT' }, [{ quantity: 1 }])).toMatchObject({ belowSafetyStock: true, belowReorderPoint: false })
  })
})

describe('FR-206 the hygiene report', () => {
  const now = new Date('2026-09-13T00:00:00Z')
  const old = new Date('2026-01-01T00:00:00Z')
  const masters = [
    { id: 'm-good', code: 'PM-GOOD', nature: 'GOOD', variantAxes: [], status: 'ACTIVE' },
    { id: 'm-axes', code: 'PM-AXES', nature: 'GOOD', variantAxes: ['color'], status: 'ACTIVE' },
    { id: 'm-svc', code: 'PM-SVC', nature: 'SERVICE', variantAxes: [], status: 'ACTIVE' },
    { id: 'm-empty', code: 'PM-EMPTY', nature: 'GOOD', variantAxes: [], status: 'ACTIVE' },
    { id: 'm-archived', code: 'PM-OLD', nature: 'GOOD', variantAxes: [], status: 'ARCHIVED' },
  ]
  const row = (over) => ({ id: over.code, name: null, color: null, material: null, variantKey: null, productMasterId: 'm-good', stockPolicy: 'TRACKED', trackingMode: 'NONE', safetyStock: 0, status: 'ACTIVE', onHand: 1, lastMovementAt: now, identifierCount: 1, createdAt: now, ...over })
  const products = [
    row({ code: 'A1', name: 'Tumbler black' }),
    row({ code: 'A2', name: 'tumbler-black' }),
    row({ code: 'A3', name: 'Tumbler red', identifierCount: 0 }),
    row({ code: 'A4', name: 'Tumbler red', status: 'ARCHIVED' }),
    row({ code: 'SVC-UNDER-GOOD', stockPolicy: 'SERVICE', safetyStock: 10, onHand: null, identifierCount: 0 }),
    row({ code: 'GOOD-UNDER-SVC', productMasterId: 'm-svc', name: 'x' }),
    row({ code: 'SVC-OK', productMasterId: 'm-svc', stockPolicy: 'SERVICE', safetyStock: 0, onHand: null, identifierCount: 0 }),
    row({ code: 'DORMANT', productMasterId: 'm-axes', variantKey: 'color=black', onHand: 0, lastMovementAt: old }),
    row({ code: 'NEVER-MOVED', productMasterId: 'm-axes', variantKey: 'color=red', onHand: 0, lastMovementAt: null, createdAt: old }),
    row({ code: 'PHASING', productMasterId: 'm-axes', variantKey: 'color=blue', status: 'PHASE_OUT', onHand: 7 }),
  ]

  it('raises every kind on the row built to raise it, and nothing on the rest', () => {
    const report = hygieneReport({ masters, products, now, dormantDays: 180 })
    const byKind = (kind) => report.findings.filter((f) => f.kind === kind)
    expect(byKind('LOOKALIKE_SKUS')).toHaveLength(1)
    expect(byKind('LOOKALIKE_SKUS')[0].codes).toEqual(['A1', 'A2'])
    expect(byKind('LOOKALIKE_SKUS')[0]).toMatchObject({ severity: 'HIGH', suggestion: 'MERGE', masterId: 'm-good' })
    expect(byKind('NATURE_MISMATCH').map((f) => f.codes[0]).sort()).toEqual(['GOOD-UNDER-SVC', 'SVC-UNDER-GOOD'])
    expect(byKind('SERVICE_WITH_STOCK_FIELDS').map((f) => f.codes[0])).toEqual(['SVC-UNDER-GOOD'])
    expect(byKind('MASTER_WITHOUT_AXES').map((f) => f.masterId)).toEqual(['m-good'])
    expect(byKind('MASTER_WITHOUT_SKUS').map((f) => f.masterId)).toEqual(['m-empty'])
    expect(byKind('DORMANT_SKU').map((f) => f.codes[0]).sort()).toEqual(['DORMANT', 'NEVER-MOVED'])
    expect(byKind('DORMANT_SKU').find((f) => f.codes[0] === 'DORMANT').idleDays).toBe(255)
    // Only a counted, live SKU with no active identifier: the service under the good master is not a good.
    expect(byKind('SKU_WITHOUT_IDENTIFIER').map((f) => f.codes[0])).toEqual(['A3'])
    expect(byKind('PHASE_OUT_WITH_STOCK').map((f) => f.codes[0])).toEqual(['PHASING'])
    expect(report.total).toBe(report.findings.length)
    expect(Object.keys(report.counts).sort()).toEqual([...INVENTORY_HYGIENE_FINDING_KINDS].sort())
    expect(report.bySeverity.HIGH).toBe(byKind('LOOKALIKE_SKUS').length + byKind('NATURE_MISMATCH').length)
    // Sorted most severe first, and stable for the same input.
    expect(report.findings[0].severity).toBe('HIGH')
    expect(hygieneReport({ masters, products, now, dormantDays: 180 })).toEqual(report)
  })

  it('a longer dormancy window silences the dormant finding, and an archived SKU or master is never reported', () => {
    const report = hygieneReport({ masters, products, now, dormantDays: 400 })
    expect(report.findings.filter((f) => f.kind === 'DORMANT_SKU')).toHaveLength(0)
    expect(report.findings.flatMap((f) => f.codes)).not.toContain('A4')
    expect(report.findings.flatMap((f) => f.codes)).not.toContain('PM-OLD')
    expect(hygieneReport({})).toMatchObject({ total: 0, findings: [] })
  })
})
