// @req FR-174 — the located ledger's pure half: what a transfer is allowed to
//   do, and how a signed movement becomes on-hand per location with the
//   unlocated remainder reported beside it rather than folded in.
// @spec BR-026; BR-028; ADR-074 D1, D2
// @tested tests/unit/warehouse-location.test.js
import { describe, expect, it } from 'vitest'
import {
  isGenericStockLocation,
  locatedStockSummary,
  onHandAtLocation,
  onHandByLocation,
  transferRule,
  zTransferStock,
} from '@/modules/inventory/domain/warehouse-location'

const loc = (id, type, over = {}) => ({ id, code: id, businessId: 'b-1', type, status: 'ACTIVE', isVirtual: false, name: id, ...over })

const RAW = loc('RAW', 'TH_CENTRAL_RAW')
const WIP = loc('WIP', 'TH_WIP_CUSTOMIZATION')
const SEA = loc('SEA', 'INTL_SEA_TRANSIT', { isVirtual: true })
const SCRAP = loc('SCRAP', 'TH_QUARANTINE_SCRAP')

describe('FR-174 transfer rules (BR-026, BR-028)', () => {
  it('AC-174.1 — a transfer needs two different, live locations of the same Business', () => {
    expect(transferRule({ product: { businessId: 'b-1' }, source: RAW, target: WIP }).ok).toBe(true)
    expect(transferRule({ product: { businessId: 'b-1' }, source: RAW, target: RAW }))
      .toMatchObject({ ok: false, code: 'WAREHOUSE_TRANSFER_SAME_LOCATION' })
    expect(transferRule({ product: { businessId: 'b-1' }, source: RAW, target: null }))
      .toMatchObject({ ok: false, code: 'WAREHOUSE_LOCATION_NOT_FOUND' })
    expect(transferRule({ product: { businessId: 'b-1' }, source: RAW, target: loc('OLD', 'TH_CENTRAL_RAW', { status: 'ARCHIVED' }) }))
      .toMatchObject({ ok: false, code: 'WAREHOUSE_LOCATION_NOT_FOUND' })
    // A location of another Business is not found, not forbidden: the refusal
    // is no oracle for what exists elsewhere (FR-072).
    expect(transferRule({ product: { businessId: 'b-1' }, source: RAW, target: loc('OTHER', 'TH_CENTRAL_RAW', { businessId: 'b-2' }) }))
      .toMatchObject({ ok: false, code: 'WAREHOUSE_LOCATION_NOT_FOUND' })
  })

  it('AC-174.2 — branded stock can never be transferred back into a generic-stock location (BR-028)', () => {
    const branded = { businessId: 'b-1', itemKind: 'CUSTOM_COMPONENT' }
    expect(transferRule({ product: branded, source: WIP, target: RAW }))
      .toMatchObject({ ok: false, code: 'INVENTORY_CUSTOM_COMPONENT_NOT_RETURNABLE' })
    expect(transferRule({ product: branded, source: WIP, target: SEA }))
      .toMatchObject({ ok: false, code: 'INVENTORY_CUSTOM_COMPONENT_NOT_RETURNABLE' })
    // Quarantine and the assembly line are not the free pool, so both are open.
    expect(transferRule({ product: branded, source: WIP, target: SCRAP }).ok).toBe(true)
    expect(transferRule({ product: branded, source: WIP, target: loc('ASM', 'TH_WIP_ASSEMBLY') }).ok).toBe(true)
    // A blank of the same shape moves freely — the lock is the logo, not the SKU.
    expect(transferRule({ product: { businessId: 'b-1', itemKind: 'RAW_COMPONENT' }, source: WIP, target: RAW }).ok).toBe(true)
  })

  it('AC-174.3 — the four places unbranded stock may sit are named, not inferred', () => {
    expect(isGenericStockLocation(RAW)).toBe(true)
    expect(isGenericStockLocation(SEA)).toBe(true)
    expect(isGenericStockLocation(loc('CN', 'CN_FACTORY'))).toBe(true)
    expect(isGenericStockLocation(loc('PORT', 'TH_PORT_CUSTOMS'))).toBe(true)
    expect(isGenericStockLocation(WIP)).toBe(false)
    expect(isGenericStockLocation(SCRAP)).toBe(false)
    expect(isGenericStockLocation(loc('FG', 'TH_FINISHED_GOODS'))).toBe(false)
    expect(isGenericStockLocation(null)).toBe(false)
  })

  it('AC-174.4 — the contract refuses a transfer to the same place, or one naming a lot two ways', () => {
    const base = { businessId: 'b-1', productId: 'p-1', quantity: 10 }
    expect(() => zTransferStock.parse({ ...base, sourceLocationId: 'a', targetLocationId: 'a' })).toThrow()
    expect(() => zTransferStock.parse({ ...base, sourceLocationId: 'a', targetLocationId: 'b', lotId: 'l1', lotCode: 'LOT-1' })).toThrow()
    expect(() => zTransferStock.parse({ ...base, quantity: 0, sourceLocationId: 'a', targetLocationId: 'b' })).toThrow()
    expect(zTransferStock.parse({ ...base, sourceLocationId: 'a', targetLocationId: 'b' }).quantity).toBe(10)
  })
})

describe('FR-174 located on-hand (BR-026)', () => {
  // One receipt into RAW, a transfer of 200 to WIP, and one old row from before
  // locations existed.
  const movements = [
    { quantity: 500, targetLocationId: 'RAW', sourceLocationId: null },
    { quantity: -200, sourceLocationId: 'RAW', targetLocationId: null },
    { quantity: 200, targetLocationId: 'WIP', sourceLocationId: null },
    { quantity: 40, targetLocationId: null, sourceLocationId: null },
  ]

  it('AC-174.5 — an issue leaves its source and a receipt arrives at its target', () => {
    const byLocation = onHandByLocation(movements)
    expect(byLocation.get('RAW')).toBe(300)
    expect(byLocation.get('WIP')).toBe(200)
    expect(onHandAtLocation(movements, 'WIP')).toBe(200)
    expect(onHandAtLocation(movements, 'NOWHERE')).toBe(0)
  })

  it('AC-174.6 — the unlocated remainder is reported beside the total, never folded into a location', () => {
    const summary = locatedStockSummary(movements, new Map([['RAW', RAW], ['WIP', WIP]]))
    expect(summary.unlocated).toBe(40)
    expect(summary.total).toBe(540)
    expect(summary.located.map((r) => [r.code, r.onHand])).toEqual([['RAW', 300], ['WIP', 200]])
    // The located rows alone would understate what the Business holds — which
    // is precisely why `total` is not their sum.
    expect(summary.located.reduce((sum, r) => sum + r.onHand, 0)).toBe(500)
  })

  it('AC-174.7 — a transfer leaves Business-wide on-hand untouched by construction', () => {
    const before = movements.reduce((sum, m) => sum + m.quantity, 0)
    const transferred = [...movements, { quantity: -100, sourceLocationId: 'RAW' }, { quantity: 100, targetLocationId: 'WIP' }]
    expect(transferred.reduce((sum, m) => sum + m.quantity, 0)).toBe(before)
    const summary = locatedStockSummary(transferred, new Map([['RAW', RAW], ['WIP', WIP]]))
    expect(summary.total).toBe(540)
    expect(summary.located.map((r) => [r.code, r.onHand])).toEqual([['RAW', 200], ['WIP', 300]])
  })

  it('AC-174.8 — a location the summary has no row for still reports its quantity, with null names', () => {
    const summary = locatedStockSummary([{ quantity: 5, targetLocationId: 'GONE' }], new Map())
    expect(summary.located).toEqual([{ locationId: 'GONE', code: null, name: null, type: null, isVirtual: null, onHand: 5 }])
  })
})
