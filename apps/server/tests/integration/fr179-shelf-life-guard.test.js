// @req FR-179 — the storage guard against a real database: an aged lot is
//   skipped by FEFO and refused when named, an issue that could only come from
//   aged lots is refused as an ageing problem rather than a shortage, a
//   recorded maintenance resets the clock, and a product that declares no
//   limit is never affected.
// @spec ADR-074 D7; BR-030; SEC-001; FR-072
// @tested tests/integration/fr179-shelf-life-guard.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { createCategory, createProduct, createProductMaster } from '@/modules/inventory/application/inventory-catalog-service'
import { createLot, recordMovement } from '@/modules/inventory/application/inventory-stock-service'
import { recordLotMaintenance, shelfLifeAudit } from '@/modules/inventory/application/inventory-shelf-life-service'

const DOMAINS = ['projects', 'platform', 'inventory']
const DAY = 86400000
const NOW = new Date(Date.UTC(2026, 8, 10))
const daysAgo = (n) => new Date(NOW.getTime() - n * DAY)

let business, owner, member, master, powerbank, tumbler
let freshLot, dueLot, deadLot
const b = () => business.id

describe('FR-179 Shelf-life storage guard', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-SHELF', name: 'Shelf Group' })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-SHELF', name: 'Shelf Tenant' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-SHELF', name: 'Battery holder' })
    owner = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [b()], visibleDomains: DOMAINS })
    member = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [], visibleDomains: DOMAINS })

    const category = await createCategory({ businessId: b(), code: 'tech', nameTh: 'ไอที', nameEn: 'Tech' }, { viewer: owner })
    master = await createProductMaster({ businessId: b(), code: 'PM-PB', categoryId: category.id, nameTh: 'พาวเวอร์แบงก์', nameEn: 'Power bank' }, { viewer: owner })
    // The SmartGift case: recharge due at 180 days, refuse dispatch past 240.
    powerbank = await createProduct({
      businessId: b(), code: 'COMP-PB-10000MAH-MAGSAFE', productMasterId: master.id, name: 'Power bank 10,000mAh',
      trackingMode: 'LOT', maintenanceIntervalDays: 180, maxStorageDays: 240,
    }, { viewer: owner })
    // A stainless tumbler does not age, and nothing about it changes.
    tumbler = await createProduct({ businessId: b(), code: 'COMP-TUMBLER', productMasterId: master.id, name: 'Tumbler', trackingMode: 'LOT' }, { viewer: owner })

    freshLot = await createLot({ businessId: b(), productId: powerbank.id, code: 'LOT-PB-FRESH', manufacturedAt: daysAgo(30) }, { viewer: owner })
    dueLot = await createLot({ businessId: b(), productId: powerbank.id, code: 'LOT-PB-DUE', manufacturedAt: daysAgo(200) }, { viewer: owner })
    deadLot = await createLot({ businessId: b(), productId: powerbank.id, code: 'LOT-PB-DEAD', manufacturedAt: daysAgo(300) }, { viewer: owner })
    for (const lot of [freshLot, dueLot, deadLot]) {
      await recordMovement({ businessId: b(), productId: powerbank.id, kind: 'RECEIPT', quantity: 100, lotId: lot.id, occurredAt: NOW }, { viewer: owner })
    }
    const oldTumblerLot = await createLot({ businessId: b(), productId: tumbler.id, code: 'LOT-TM-OLD', manufacturedAt: daysAgo(900) }, { viewer: owner })
    await recordMovement({ businessId: b(), productId: tumbler.id, kind: 'RECEIPT', quantity: 100, lotId: oldTumblerLot.id, occurredAt: NOW }, { viewer: owner })
  })

  it('AC-179.1 — the audit separates OK, DUE and EXPIRED and names the deadline each batch is measured against', async () => {
    const audit = await shelfLifeAudit({ businessId: b(), viewer: member, now: NOW })
    expect(audit.counts).toMatchObject({ total: 3, ok: 1, due: 1, expired: 1 })
    const row = (code) => audit.rows.find((r) => r.lotCode === code)
    expect(row('LOT-PB-FRESH')).toMatchObject({ state: 'OK', ageDays: 30, dueInDays: 150, onHand: 100 })
    expect(row('LOT-PB-DUE')).toMatchObject({ state: 'DUE', ageDays: 200, maxStorageDays: 240 })
    expect(row('LOT-PB-DEAD')).toMatchObject({ state: 'EXPIRED', ageDays: 300 })
    // A product that declares no storage limit is not in the report at all —
    // a 900-day-old tumbler is not a job for anyone.
    expect(audit.rows.map((r) => r.productCode)).not.toContain('COMP-TUMBLER')

    const narrowed = await shelfLifeAudit({ businessId: b(), thresholdDays: 250, viewer: member, now: NOW })
    expect(narrowed.rows.map((r) => r.lotCode)).toEqual(['LOT-PB-DEAD'])
  })

  it('AC-179.2 — a DUE lot still issues; an EXPIRED one is refused by name (BR-030)', async () => {
    const fine = await recordMovement({ businessId: b(), productId: powerbank.id, kind: 'ISSUE', quantity: 10, lotId: dueLot.id, occurredAt: NOW }, { viewer: owner })
    expect(fine.onHandAfter).toBe(290)

    await expect(recordMovement({ businessId: b(), productId: powerbank.id, kind: 'ISSUE', quantity: 10, lotId: deadLot.id, occurredAt: NOW }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'INVENTORY_LOT_STORAGE_EXPIRED' })
  })

  it('AC-179.3 — FEFO skips an expired lot entirely rather than picking the oldest stock first', async () => {
    // None of these lots carries an expiry date — a power bank degrades, it does
    // not spoil — so FEFO falls back to lot age and would ordinarily consider
    // every open lot, LOT-PB-DEAD included. It is not considered at all.
    const issued = await recordMovement({ businessId: b(), productId: powerbank.id, kind: 'ISSUE', quantity: 50, occurredAt: NOW }, { viewer: owner })
    const touched = issued.allocations.map((a) => a.lotId)
    expect(touched).not.toContain(deadLot.id)
    expect(touched).toContain(freshLot.id)
    expect((await prisma.stockMovement.aggregate({ where: { productId: powerbank.id, lotId: deadLot.id }, _sum: { quantity: true } }))._sum.quantity).toBe(100)
  })

  it('AC-179.4 — an issue that only the aged lots could cover is refused as an ageing problem, not as a shortage', async () => {
    // 40 left in the DUE lot and 100 in the fresh one; asking for 200 can only
    // be met by reaching into the expired 100.
    await expect(recordMovement({ businessId: b(), productId: powerbank.id, kind: 'ISSUE', quantity: 200, occurredAt: NOW }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'INVENTORY_LOT_STORAGE_EXPIRED' })
  })

  it('AC-179.5 — recording maintenance resets the clock, and only for a product that actually ages', async () => {
    const maintained = await recordLotMaintenance({ businessId: b(), lotId: deadLot.id, note: 'charged to 65% storage voltage' }, { viewer: owner, now: NOW })
    expect(maintained.lastMaintainedAt.toISOString()).toBe(NOW.toISOString())

    const issued = await recordMovement({ businessId: b(), productId: powerbank.id, kind: 'ISSUE', quantity: 10, lotId: deadLot.id, occurredAt: NOW }, { viewer: owner })
    expect(issued.onHandAfter).toBeGreaterThan(0)

    const audit = await shelfLifeAudit({ businessId: b(), viewer: member, now: NOW })
    expect(audit.rows.find((r) => r.lotCode === 'LOT-PB-DEAD')).toMatchObject({ state: 'OK', ageDays: 0 })

    const tumblerLot = await prisma.productLot.findFirst({ where: { productId: tumbler.id } })
    await expect(recordLotMaintenance({ businessId: b(), lotId: tumblerLot.id }, { viewer: owner, now: NOW }))
      .rejects.toMatchObject({ status: 422, message: 'INVENTORY_PRODUCT_DOES_NOT_AGE' })
    await expect(recordLotMaintenance({ businessId: b(), lotId: deadLot.id }, { viewer: member, now: NOW }))
      .rejects.toMatchObject({ status: 404, message: 'Business not found' })

    const audits = await prisma.auditEvent.findMany({ where: { entityType: 'PRODUCT_LOT', entityId: deadLot.id, action: 'PRODUCT_LOT_MAINTAINED' } })
    expect(audits).toHaveLength(1)
  })
})
