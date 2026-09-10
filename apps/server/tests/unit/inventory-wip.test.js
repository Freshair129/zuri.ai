// @req FR-176 — the scrap-buffer arithmetic, run reconciliation and the
//   customer-dedication guard that makes branding irreversible.
// @req FR-177 — the explosion with a declared scrap allowance.
// @req FR-179 — storage ageing: due, expired, and the maintenance that resets it.
// @req FR-180 — Available-to-Promise and the buildable count from ATP.
// @spec BR-028, BR-029, BR-030, BR-031; ADR-074 D4, D5, D7, D8
// @tested tests/unit/inventory-wip.test.js
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_QUOTE_RESERVATION_DAYS,
  auditShelfLife,
  availableToPromise,
  customizationCompletionRule,
  customizationWorkOrderCode,
  dedicationRule,
  explodeWithScrap,
  grossIssueQuantity,
  isReservationLive,
  kittingRequirements,
  kittingWorkOrderCode,
  lotShelfLifeState,
  lotStorageAgeDays,
  maxBuildableFromAvailable,
  quoteExpiryAt,
  reconcileCustomizationRun,
  scrapBufferQuantity,
  shelfLifeIssueRule,
} from '@/modules/inventory/domain/inventory-wip'

const DAY = 86400000
const at = (days) => new Date(Date.UTC(2026, 0, 1) + days * DAY)

describe('FR-176/FR-177 scrap allowance (BR-029)', () => {
  it('AC-176.1 — the gross issue is ceil(net × (1 + factor)), so the buffer leaves the shelf with the rest', () => {
    expect(grossIssueQuantity(500, 0.02)).toBe(510)
    expect(scrapBufferQuantity(500, 0.02)).toBe(10)
    // 100 × 1.02 = 102 exactly; floating point must not turn that into 103.
    expect(grossIssueQuantity(100, 0.02)).toBe(102)
    // A partial unit always rounds up: you cannot issue a third of a tumbler.
    expect(grossIssueQuantity(7, 0.02)).toBe(8)
    // No declared allowance means no buffer at all — every recipe written
    // before ADR-074 behaves exactly as it did.
    expect(grossIssueQuantity(500, 0)).toBe(500)
    expect(grossIssueQuantity(0, 0.2)).toBe(0)
    // Above the ceiling the factor is clamped, never honoured.
    expect(grossIssueQuantity(100, 0.9)).toBe(120)
  })

  it('AC-176.2 — a completed run accounts for every issued unit: branded, scrapped, or unused buffer', () => {
    expect(reconcileCustomizationRun({ issuedQty: 510, completedQty: 502, scrapQty: 8 }))
      .toMatchObject({ unusedBufferQty: 0, overIssued: false })
    expect(reconcileCustomizationRun({ issuedQty: 510, completedQty: 500, scrapQty: 5 }))
      .toMatchObject({ unusedBufferQty: 5, overIssued: false })
    // Reporting more than went out is a mistake, not a clamp.
    expect(reconcileCustomizationRun({ issuedQty: 510, completedQty: 520, scrapQty: 0 }).overIssued).toBe(true)
  })

  it('AC-176.3 — a run that scrapped past its buffer is BLOCKED, not quietly COMPLETED', () => {
    const order = { status: 'IN_PROGRESS', issuedQty: 510, plannedQty: 500 }
    // The spec's own worked example: 25 ruined out of 510, so only 485 good.
    const short = customizationCompletionRule(order, { completedQty: 485, scrapQty: 25 })
    expect(short).toMatchObject({ ok: true, shortfall: 15, blocked: true })
    const full = customizationCompletionRule(order, { completedQty: 502, scrapQty: 8 })
    expect(full).toMatchObject({ ok: true, shortfall: 0, blocked: false })

    expect(customizationCompletionRule({ status: 'DRAFT', issuedQty: 0, plannedQty: 500 }, { completedQty: 1 }).code)
      .toBe('CUSTOMIZATION_WORK_ORDER_NOT_RELEASED')
    expect(customizationCompletionRule({ status: 'COMPLETED' }, { completedQty: 1 }).code)
      .toBe('CUSTOMIZATION_WORK_ORDER_COMPLETED')
    expect(customizationCompletionRule(order, { completedQty: 600 }).code)
      .toBe('CUSTOMIZATION_WORK_ORDER_OVER_ISSUED')
  })

  it('AC-176.4 — a branded SKU may only be issued for the customer and order it was branded for (BR-028)', () => {
    const branded = { id: 'p1', dedicatedCustomerId: 'ptt', dedicatedSalesOrderId: 'so-1' }
    const blank = { id: 'p0', dedicatedCustomerId: null, dedicatedSalesOrderId: null }

    expect(dedicationRule(blank, { customerId: 'anyone' }).ok).toBe(true)
    expect(dedicationRule(branded, { customerId: 'ptt', salesOrderId: 'so-1' }).ok).toBe(true)
    expect(dedicationRule(branded, { customerId: 'scg' })).toMatchObject({ ok: false, code: 'INVENTORY_CUSTOM_COMPONENT_WRONG_CUSTOMER' })
    expect(dedicationRule(branded, { customerId: 'ptt', salesOrderId: 'so-2' })).toMatchObject({ ok: false, code: 'INVENTORY_CUSTOM_COMPONENT_WRONG_SALES_ORDER' })
    // An issue that names nobody is a write-off or a correction; refusing it
    // would leave branded stock nobody could ever dispose of.
    expect(dedicationRule(branded, {}).ok).toBe(true)
    // …unless the caller is a build, which must name its order.
    expect(dedicationRule(branded, { allowUndedicated: false })).toMatchObject({ ok: false, code: 'INVENTORY_CUSTOM_COMPONENT_DEDICATED' })
  })

  it('AC-177.3 — the explosion buffers scaled lines and leaves fixed lines alone: you do not need 1.02 crates', () => {
    const exploded = explodeWithScrap({
      lines: [
        { componentProductId: 'tumbler', qty: 1, fixed: false, required: 500 },
        { componentProductId: 'ribbon', qty: 0.5, fixed: false, required: 250 },
        { componentProductId: 'crate', qty: 1, fixed: true, required: 1 },
      ],
    }, 0.02)
    const line = (id) => exploded.lines.find((l) => l.componentProductId === id)
    expect(line('tumbler')).toMatchObject({ netQty: 500, grossQty: 510, scrapBufferQty: 10 })
    expect(line('ribbon')).toMatchObject({ netQty: 250, grossQty: 255 })
    expect(line('crate')).toMatchObject({ netQty: 1, grossQty: 1, scrapBufferQty: 0 })
    expect(exploded.scrapAllowanceFactor).toBe(0.02)
  })

  it('AC-177.4 — requirements are measured against ATP, and an uncounted component never blocks', () => {
    const exploded = explodeWithScrap({ lines: [{ componentProductId: 'a', qty: 1, fixed: false, required: 100 }, { componentProductId: 'b', qty: 1, fixed: false, required: 100 }] }, 0.02)
    const short = kittingRequirements(exploded, { a: 50, b: null })
    expect(short.canBuild).toBe(false)
    expect(short.lines.find((l) => l.componentProductId === 'a')).toMatchObject({ shortage: 52 })
    expect(short.lines.find((l) => l.componentProductId === 'b')).toMatchObject({ available: null, shortage: 0 })
    expect(kittingRequirements(exploded, { a: 200, b: 200 }).canBuild).toBe(true)
  })

  it('AC-176.5 — work-order codes are day-keyed and zero-padded', () => {
    expect(customizationWorkOrderCode(at(0), 1)).toBe('CWO-20260101-001')
    expect(kittingWorkOrderCode(at(40), 12)).toBe('KWO-20260210-012')
  })
})

describe('FR-179 storage ageing (BR-030)', () => {
  const powerBank = { id: 'pb', code: 'COMP-PB-10000MAH', maintenanceIntervalDays: 180, maxStorageDays: 240 }
  const tumbler = { id: 'tm', code: 'COMP-TUMBLER', maintenanceIntervalDays: null, maxStorageDays: null }

  it('AC-179.1 — a lot ages from its last maintenance, not from manufacture, because a recharge resets the clock', () => {
    expect(lotStorageAgeDays({ manufacturedAt: at(0) }, at(100))).toBe(100)
    expect(lotStorageAgeDays({ manufacturedAt: at(0), lastMaintainedAt: at(90) }, at(100))).toBe(10)
    // No date at all means no measurable age — the honest answer, and the one
    // that never blocks.
    expect(lotStorageAgeDays({}, at(100))).toBeNull()
  })

  it('AC-179.2 — DUE is surfaced and still issuable; EXPIRED is refused', () => {
    expect(lotShelfLifeState(powerBank, { manufacturedAt: at(0) }, at(100))).toMatchObject({ state: 'OK', ageDays: 100, dueInDays: 80 })
    expect(lotShelfLifeState(powerBank, { manufacturedAt: at(0) }, at(180))).toMatchObject({ state: 'DUE', ageDays: 180 })
    expect(lotShelfLifeState(powerBank, { manufacturedAt: at(0) }, at(241))).toMatchObject({ state: 'EXPIRED', ageDays: 241 })

    expect(shelfLifeIssueRule(powerBank, { manufacturedAt: at(0) }, at(180)).ok).toBe(true)
    expect(shelfLifeIssueRule(powerBank, { manufacturedAt: at(0) }, at(241)))
      .toMatchObject({ ok: false, code: 'INVENTORY_LOT_STORAGE_EXPIRED' })
    // The recharge is what unblocks it — not the passage of time.
    expect(shelfLifeIssueRule(powerBank, { manufacturedAt: at(0), lastMaintainedAt: at(200) }, at(241)).ok).toBe(true)
  })

  it('AC-179.3 — a product that declares no storage limit is never aged, however old its lots are', () => {
    expect(lotShelfLifeState(tumbler, { manufacturedAt: at(-3650) }, at(0)).state).toBe('OK')
    expect(shelfLifeIssueRule(tumbler, { manufacturedAt: at(-3650) }, at(0)).ok).toBe(true)
  })

  it('AC-179.4 — the audit counts each standing and names the hard deadline a batch is measured against', () => {
    const audit = auditShelfLife([
      { product: powerBank, lot: { id: 'l1', code: 'LOT-A', manufacturedAt: at(0) }, onHand: 200 },
      { product: powerBank, lot: { id: 'l2', code: 'LOT-B', manufacturedAt: at(80) }, onHand: 300 },
      { product: powerBank, lot: { id: 'l3', code: 'LOT-C', manufacturedAt: at(-60) }, onHand: 50 },
    ], at(185))
    expect(audit.counts).toMatchObject({ total: 3, expired: 1, due: 1, ok: 1 })
    const rowA = audit.rows.find((r) => r.lotCode === 'LOT-A')
    expect(rowA).toMatchObject({ state: 'DUE', ageDays: 185, maxStorageDays: 240 })
    expect(rowA.hardDeadlineAt.toISOString()).toBe(at(240).toISOString())
  })
})

describe('FR-180 Available-to-Promise (BR-031)', () => {
  it('AC-180.1 — ATP subtracts committed orders and live quote holds, and never goes negative', () => {
    const now = at(10)
    const live = { status: 'ACTIVE', purpose: 'QUOTE', quantity: 300, expiresAt: at(17) }
    const committed = { status: 'ACTIVE', purpose: 'ORDER', quantity: 200, expiresAt: null }
    expect(availableToPromise({ onHand: 1000, reservations: [live, committed], now }))
      .toMatchObject({ onHand: 1000, committed: 200, reservedForQuotes: 300, available: 500, overCommitted: 0 })
    // Over-promised stock reports the excess rather than a negative available.
    expect(availableToPromise({ onHand: 100, reservations: [committed, live], now }))
      .toMatchObject({ available: 0, overCommitted: 400 })
  })

  it('AC-180.2 — a hold whose clock has run out is already spent, whether or not a sweeper has run', () => {
    const expired = { status: 'ACTIVE', purpose: 'QUOTE', quantity: 300, expiresAt: at(5) }
    expect(isReservationLive(expired, at(10))).toBe(false)
    expect(availableToPromise({ onHand: 1000, reservations: [expired], now: at(10) }).available).toBe(1000)
    // Released and converted holds never count either.
    expect(isReservationLive({ status: 'RELEASED', quantity: 5 }, at(0))).toBe(false)
    expect(isReservationLive({ status: 'ACTIVE', quantity: 5, expiresAt: null }, at(9999))).toBe(true)
  })

  it('AC-180.3 — a quote holds for seven days by default', () => {
    expect(quoteExpiryAt(at(0)).toISOString()).toBe(at(DEFAULT_QUOTE_RESERVATION_DAYS).toISOString())
    expect(quoteExpiryAt(at(0), 14).toISOString()).toBe(at(14).toISOString())
  })

  it('AC-180.4 — the buildable count comes from ATP, so two quotes cannot promise the same tumblers', () => {
    const recipe = { batchSize: 10, lines: [{ componentProductId: 'tumbler', qty: 10, fixed: false }, { componentProductId: 'crate', qty: 1, fixed: true }] }
    // 1,200 free tumblers build 1,200 sets.
    expect(maxBuildableFromAvailable(recipe, { tumbler: 1200, crate: 5 })).toBe(1200)
    // The same on-hand with 700 already promised builds only 500.
    expect(maxBuildableFromAvailable(recipe, { tumbler: 500, crate: 5 })).toBe(500)
    // A fixed line allows the batch or nothing at all.
    expect(maxBuildableFromAvailable(recipe, { tumbler: 1200, crate: 0 })).toBe(0)
    // Nothing counted, nothing to say.
    expect(maxBuildableFromAvailable(recipe, {})).toBeNull()
  })
})
