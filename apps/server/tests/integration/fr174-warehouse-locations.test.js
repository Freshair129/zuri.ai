// @req FR-174 — warehouse locations and the located ledger against a real
//   database: identity and authority, the atomic transfer that leaves
//   Business-wide on-hand untouched, the located view that reports its
//   unlocated remainder, the branded-stock refusal, and the lot identity a
//   transfer preserves.
// @spec ADR-074 D1, D2; BR-026; BR-028; BR-002; SEC-001; FR-072
// @tested tests/integration/fr174-warehouse-locations.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { ROLE_INVENTORY_MANAGER } from '@/modules/identity/rbac'
import { createCategory, createProduct, createProductMaster } from '@/modules/inventory/application/inventory-catalog-service'
import { recordMovement } from '@/modules/inventory/application/inventory-stock-service'
import { applyLocationAction, createLocation, listLocations, locationStock } from '@/modules/inventory/application/warehouse-location-service'
import { transferStock } from '@/modules/inventory/application/location-transfer-service'

const DOMAINS = ['projects', 'platform', 'inventory']
let tenant, business, owner, manager, member, master, tumbler, branded, teaLot
let raw, wip, finished, scrap, foreign
const b = () => business.id

describe('FR-174 Warehouse locations and the located ledger', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-WHLOC', name: 'Warehouse Group' })
    tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-WHLOC', name: 'Warehouse Tenant' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-WHLOC', name: 'SmartGift-like' })
    const otherBusiness = await createBusiness({ tenantId: tenant.id, code: 'BUS-WHLOC-2', name: 'Other' })
    owner = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [b()], visibleDomains: DOMAINS })
    manager = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [], visibleDomains: DOMAINS, rolesByBusinessId: { [b()]: [ROLE_INVENTORY_MANAGER] } })
    member = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [], visibleDomains: DOMAINS })
    const foreignOwner = makeViewer({ visibleBusinessIds: [otherBusiness.id], ownedBusinessIds: [otherBusiness.id], visibleDomains: DOMAINS })

    const category = await createCategory({ businessId: b(), code: 'drinkware', nameTh: 'แก้วน้ำ', nameEn: 'Drinkware' }, { viewer: owner })
    master = await createProductMaster({ businessId: b(), code: 'PM-TUMBLER', categoryId: category.id, nameTh: 'กระบอกน้ำ', nameEn: 'Tumbler' }, { viewer: owner })
    tumbler = await createProduct({ businessId: b(), code: 'COMP-TUMBLER-SUS304-500ML', productMasterId: master.id, name: 'SUS304 500ml' }, { viewer: owner })
    branded = await createProduct({ businessId: b(), code: 'BRANDED-TUMBLER-PTT', productMasterId: master.id, name: 'PTT tumbler', itemKind: 'CUSTOM_COMPONENT', dedicatedCustomerId: 'cust-ptt', dedicatedSalesOrderId: 'so-ptt-1' }, { viewer: owner })
    teaLot = await createProduct({ businessId: b(), code: 'COMP-PB-10000MAH', productMasterId: master.id, name: 'Power bank', trackingMode: 'LOT' }, { viewer: owner })

    raw = await createLocation({ businessId: b(), code: 'LOC-TH-RAW-01', name: 'คลังวัตถุดิบกลาง', type: 'TH_CENTRAL_RAW' }, { viewer: owner })
    wip = await createLocation({ businessId: b(), code: 'LOC-TH-LASER', name: 'ห้องยิงเลเซอร์', type: 'TH_WIP_CUSTOMIZATION' }, { viewer: manager })
    finished = await createLocation({ businessId: b(), code: 'LOC-TH-FG', name: 'คลังสินค้าสำเร็จรูป', type: 'TH_FINISHED_GOODS' }, { viewer: owner })
    scrap = await createLocation({ businessId: b(), code: 'LOC-TH-SCRAP', name: 'ของเสีย', type: 'TH_QUARANTINE_SCRAP' }, { viewer: owner })
    foreign = await createLocation({ businessId: otherBusiness.id, code: 'LOC-OTHER', name: 'Other', type: 'TH_CENTRAL_RAW' }, { viewer: foreignOwner })
  })

  it('AC-174.1 — a location is Business-scoped with a Tenant-unique code, typed, and writable only by an inventory authority', async () => {
    expect(raw).toMatchObject({ code: 'LOC-TH-RAW-01', type: 'TH_CENTRAL_RAW', isVirtual: false, status: 'ACTIVE', version: 1 })

    const vessel = await createLocation({ businessId: b(), code: 'LOC-SEA-01', name: 'ตู้คอนเทนเนอร์บนเรือ', type: 'INTL_SEA_TRANSIT', isVirtual: true }, { viewer: owner })
    expect(vessel.isVirtual).toBe(true)

    await expect(createLocation({ businessId: b(), code: 'LOC-TH-RAW-01', name: 'dup', type: 'TH_CENTRAL_RAW' }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'WAREHOUSE_LOCATION_CODE_TAKEN' })
    await expect(createLocation({ businessId: b(), code: 'LOC-X', name: 'x', type: 'MOON_BASE' }, { viewer: owner })).rejects.toThrow()
    // FR-072 — a member who may see the domain may not write it, and the
    // refusal is the same 404 an unknown Business gets.
    await expect(createLocation({ businessId: b(), code: 'LOC-Y', name: 'y', type: 'TH_CENTRAL_RAW' }, { viewer: member }))
      .rejects.toMatchObject({ status: 404, message: 'Business not found' })

    const list = await listLocations({ businessId: b(), viewer: member })
    expect(list.map((l) => l.code)).toContain('LOC-SEA-01')
    expect(list.every((l) => l.businessId === b())).toBe(true)
    const audits = await prisma.auditEvent.findMany({ where: { entityType: 'WAREHOUSE_LOCATION', entityId: raw.id } })
    expect(audits.map((a) => a.action)).toEqual(['WAREHOUSE_LOCATION_CREATED'])
  })

  it('AC-174.2 — a transfer moves stock between locations in one transaction and leaves Business-wide on-hand untouched', async () => {
    await recordMovement({ businessId: b(), productId: tumbler.id, kind: 'RECEIPT', quantity: 1000, reference: 'GRN:INITIAL', targetLocationId: raw.id, costSatang: 11346 }, { viewer: owner })

    const before = await prisma.stockMovement.aggregate({ where: { productId: tumbler.id }, _sum: { quantity: true } })
    const result = await transferStock({ businessId: b(), productId: tumbler.id, sourceLocationId: raw.id, targetLocationId: wip.id, quantity: 510, reference: 'CWO:TEST' }, { viewer: manager })
    const after = await prisma.stockMovement.aggregate({ where: { productId: tumbler.id }, _sum: { quantity: true } })

    expect(after._sum.quantity).toBe(before._sum.quantity)
    expect(result).toMatchObject({ quantity: 510, sourceLocationId: raw.id, targetLocationId: wip.id })
    // Two rows, one each way, both carrying their end of the move.
    expect(result.issued.movements[0]).toMatchObject({ kind: 'ISSUE', quantity: -510, sourceLocationId: raw.id })
    expect(result.received[0].movements[0]).toMatchObject({ kind: 'RECEIPT', quantity: 510, targetLocationId: wip.id })

    const located = await locationStock({ businessId: b(), productId: tumbler.id, viewer: member })
    expect(located.total).toBe(1000)
    expect(located.unlocated).toBe(0)
    expect(located.located.map((r) => [r.code, r.onHand]).sort()).toEqual([['LOC-TH-LASER', 510], ['LOC-TH-RAW-01', 490]])
  })

  it('AC-174.3 — a transfer is refused when it names one place twice, an unknown place, another Business\'s place, or more than the source holds', async () => {
    await expect(transferStock({ businessId: b(), productId: tumbler.id, sourceLocationId: raw.id, targetLocationId: raw.id, quantity: 1 }, { viewer: owner })).rejects.toThrow()
    await expect(transferStock({ businessId: b(), productId: tumbler.id, sourceLocationId: raw.id, targetLocationId: 'nope', quantity: 1 }, { viewer: owner }))
      .rejects.toMatchObject({ status: 422, message: 'WAREHOUSE_LOCATION_NOT_FOUND' })
    await expect(transferStock({ businessId: b(), productId: tumbler.id, sourceLocationId: raw.id, targetLocationId: foreign.id, quantity: 1 }, { viewer: owner }))
      .rejects.toMatchObject({ status: 422, message: 'WAREHOUSE_LOCATION_NOT_FOUND' })
    await expect(transferStock({ businessId: b(), productId: tumbler.id, sourceLocationId: raw.id, targetLocationId: wip.id, quantity: 99999 }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'INVENTORY_INSUFFICIENT_STOCK' })
    await expect(transferStock({ businessId: b(), productId: tumbler.id, sourceLocationId: raw.id, targetLocationId: wip.id, quantity: 1 }, { viewer: member }))
      .rejects.toMatchObject({ status: 404 })
  })

  it('AC-174.4 — branded stock can never be transferred back into a generic-stock location (BR-028)', async () => {
    await recordMovement({ businessId: b(), productId: branded.id, kind: 'RECEIPT', quantity: 100, targetLocationId: wip.id, customerId: 'cust-ptt', salesOrderId: 'so-ptt-1' }, { viewer: owner })
    await expect(transferStock({ businessId: b(), productId: branded.id, sourceLocationId: wip.id, targetLocationId: raw.id, quantity: 10 }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'INVENTORY_CUSTOM_COMPONENT_NOT_RETURNABLE' })
    // Quarantine is not the free pool, so a write-off route stays open.
    const toScrap = await transferStock({ businessId: b(), productId: branded.id, sourceLocationId: wip.id, targetLocationId: scrap.id, quantity: 10 }, { viewer: owner })
    expect(toScrap.quantity).toBe(10)
    const located = await locationStock({ businessId: b(), productId: branded.id, viewer: member })
    expect(located.located.map((r) => [r.code, r.onHand]).sort()).toEqual([['LOC-TH-LASER', 90], ['LOC-TH-SCRAP', 10]])
  })

  it('AC-174.5 — a lot-tracked transfer keeps its batch identity, and its receivedQty is not inflated by the move', async () => {
    await recordMovement({ businessId: b(), productId: teaLot.id, kind: 'RECEIPT', quantity: 200, lotCode: 'LOT-PB-2026A', targetLocationId: raw.id }, { viewer: owner })
    const lot = await prisma.productLot.findFirst({ where: { productId: teaLot.id, code: 'LOT-PB-2026A' } })
    expect(lot.receivedQty).toBe(200)

    const moved = await transferStock({ businessId: b(), productId: teaLot.id, sourceLocationId: raw.id, targetLocationId: finished.id, quantity: 50 }, { viewer: owner })
    expect(moved.allocations).toEqual([{ lotId: lot.id, qty: 50 }])
    expect(moved.received[0].movements[0].lotId).toBe(lot.id)

    const after = await prisma.productLot.findUnique({ where: { id: lot.id } })
    // A transfer is not an arrival from outside, so the batch's intake is unchanged.
    expect(after.receivedQty).toBe(200)
    const located = await locationStock({ businessId: b(), productId: teaLot.id, viewer: member })
    expect(located.located.map((r) => [r.code, r.onHand]).sort()).toEqual([['LOC-TH-FG', 50], ['LOC-TH-RAW-01', 150]])
  })

  it('AC-174.6 — an unlocated row is reported beside the total, never folded into a location (BR-026)', async () => {
    // A movement written the way every movement before ADR-074 was written.
    await recordMovement({ businessId: b(), productId: tumbler.id, kind: 'RECEIPT', quantity: 40, reference: 'LEGACY' }, { viewer: owner })
    const located = await locationStock({ businessId: b(), productId: tumbler.id, viewer: member })
    expect(located.unlocated).toBe(40)
    expect(located.total).toBe(1040)
    expect(located.located.reduce((sum, r) => sum + r.onHand, 0)).toBe(1000)
  })

  it('AC-174.7 — a location holding stock cannot be archived; an empty one can, and archiving stops new transfers', async () => {
    await expect(applyLocationAction(raw.id, { action: 'ARCHIVE', version: raw.version }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'WAREHOUSE_LOCATION_NOT_EMPTY' })

    const spare = await createLocation({ businessId: b(), code: 'LOC-SPARE', name: 'ชั้นว่าง', type: 'TH_CENTRAL_RAW' }, { viewer: owner })
    const renamed = await applyLocationAction(spare.id, { action: 'UPDATE', version: spare.version, fields: { name: 'ชั้นว่าง (ปิด)' } }, { viewer: owner })
    expect(renamed).toMatchObject({ name: 'ชั้นว่าง (ปิด)', version: 2 })
    await expect(applyLocationAction(spare.id, { action: 'UPDATE', version: 1, fields: { name: 'stale' } }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'WAREHOUSE_LOCATION_VERSION_CONFLICT' })

    const archived = await applyLocationAction(spare.id, { action: 'ARCHIVE', version: renamed.version }, { viewer: owner })
    expect(archived.status).toBe('ARCHIVED')
    await expect(transferStock({ businessId: b(), productId: tumbler.id, sourceLocationId: raw.id, targetLocationId: spare.id, quantity: 1 }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'WAREHOUSE_LOCATION_NOT_FOUND' })
    // The row survives archiving, so past movements stay readable.
    expect(await prisma.warehouseLocation.findUnique({ where: { id: spare.id } })).not.toBeNull()
  })
})
