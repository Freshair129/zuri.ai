// @req FR-155 — the stock ledger against a real database: receipts, issues
//   and adjustments on a plain counted SKU; lots created by code on receipt
//   and by the explicit path; serial units created on receipt and issued one
//   by one; the refusals by code; the recomputed summary; audit.
// @spec BR-002; SEC-001; FR-072
// @tested tests/integration/fr155-inventory-stock.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { ROLE_INVENTORY_MANAGER } from '@/modules/identity/rbac'
import { createCategory, createFactory, createProduct, createProductMaster } from '@/modules/inventory/application/inventory-catalog-service'
import { createLot, listLots, listMovements, listSerialUnits, recordMovement, stockSummary } from '@/modules/inventory/application/inventory-stock-service'

const DOMAINS = ['projects', 'platform', 'inventory']
let tenant, business, owner, manager, member, master, factory, plain, lotted, serial, service
const b = () => business.id

describe('FR-155 Inventory stock ledger', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-INV-STK', name: 'Stock Group' })
    tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-INV-STK', name: 'Stock Tenant' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-INV-STK', name: 'Stock Business' })
    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: DOMAINS })
    manager = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: DOMAINS, rolesByBusinessId: { [business.id]: [ROLE_INVENTORY_MANAGER] } })
    member = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: DOMAINS })
    const category = await createCategory({ businessId: b(), code: 'classic-oriental', nameTh: 'คลาสสิก', nameEn: 'Classic oriental' }, { viewer: owner })
    factory = await createFactory({ businessId: b(), code: 'FAC-1', name: 'Factory One' }, { viewer: owner })
    master = await createProductMaster({ businessId: b(), code: 'PM-TEA', categoryId: category.id, factoryId: factory.id, nameTh: 'ชุดชา', nameEn: 'Tea set' }, { viewer: owner })
    plain = await createProduct({ businessId: b(), code: 'TEA-PLAIN', productMasterId: master.id, safetyStock: 4 }, { viewer: owner })
    lotted = await createProduct({ businessId: b(), code: 'TEA-LOT', productMasterId: master.id, trackingMode: 'LOT', safetyStock: 0 }, { viewer: owner })
    serial = await createProduct({ businessId: b(), code: 'TEA-SERIAL', productMasterId: master.id, trackingMode: 'SERIAL', safetyStock: 1 }, { viewer: owner })
    service = await createProduct({ businessId: b(), code: 'TEA-CEREMONY', productMasterId: master.id, stockPolicy: 'UNTRACKED' }, { viewer: owner })
  })

  it('AC-155.1 — a plain counted SKU: receipt adds, issue removes, adjustment corrects, and on-hand is recomputed from the rows', async () => {
    const receipt = await recordMovement({ businessId: b(), productId: plain.id, kind: 'RECEIPT', quantity: 10, reference: 'PO-1' }, { viewer: manager })
    expect(receipt).toMatchObject({ kind: 'RECEIPT', quantity: 10, onHandBefore: 0, onHandAfter: 10, lotId: null })
    expect(receipt.movements).toHaveLength(1)
    await recordMovement({ businessId: b(), productId: plain.id, kind: 'ISSUE', quantity: 3 }, { viewer: owner })
    const adjusted = await recordMovement({ businessId: b(), productId: plain.id, kind: 'ADJUSTMENT', quantity: -4, reason: 'stocktake' }, { viewer: owner })
    expect(adjusted).toMatchObject({ onHandBefore: 7, onHandAfter: 3 })
    await expect(recordMovement({ businessId: b(), productId: plain.id, kind: 'ISSUE', quantity: 4 }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'INVENTORY_INSUFFICIENT_STOCK' })
    const rows = await listMovements({ businessId: b(), productId: plain.id, viewer: member })
    expect(rows.map((r) => r.quantity)).toEqual([-4, -3, 10])
    const audits = await prisma.auditEvent.findMany({ where: { entityType: 'STOCK_MOVEMENT', entityId: { in: rows.map((r) => r.id) } }, orderBy: { occurredAt: 'asc' } })
    expect(audits.map((a) => a.action)).toEqual(['STOCK_RECEIPT_RECORDED', 'STOCK_ISSUE_RECORDED', 'STOCK_ADJUSTMENT_RECORDED'])
    expect(JSON.parse(audits[0].payloadJson)).toMatchObject({ onHandBefore: 0, onHandAfter: 10, reference: 'PO-1' })
  })

  it('AC-155.2 — the refusals by code: uncounted, wrong tracking mode, unknown product, member cannot write', async () => {
    await expect(recordMovement({ businessId: b(), productId: service.id, kind: 'RECEIPT', quantity: 1 }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'INVENTORY_PRODUCT_UNTRACKED' })
    await expect(recordMovement({ businessId: b(), productId: plain.id, kind: 'RECEIPT', quantity: 1, lotCode: 'L' }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'INVENTORY_LOT_NOT_TRACKED' })
    await expect(recordMovement({ businessId: b(), productId: plain.id, kind: 'RECEIPT', quantity: 1, serialNos: ['S'] }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'INVENTORY_SERIAL_NOT_TRACKED' })
    await expect(recordMovement({ businessId: b(), productId: lotted.id, kind: 'RECEIPT', quantity: 1 }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'INVENTORY_LOT_REQUIRED' })
    await expect(recordMovement({ businessId: b(), productId: 'no-such', kind: 'RECEIPT', quantity: 1 }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'INVENTORY_PRODUCT_NOT_FOUND' })
    await expect(recordMovement({ businessId: b(), productId: plain.id, kind: 'RECEIPT', quantity: 1 }, { viewer: member })).rejects.toMatchObject({ status: 404, message: 'Business not found' })
    await expect(recordMovement({ businessId: 'no-such-business', productId: plain.id, kind: 'RECEIPT', quantity: 1 }, { viewer: owner })).rejects.toMatchObject({ status: 404 })
  })

  it('AC-155.3 — a LOT-tracked SKU: a receipt names or creates its lot, the lot counts what it received, an explicit lot carries dates', async () => {
    const first = await recordMovement({ businessId: b(), productId: lotted.id, kind: 'RECEIPT', quantity: 20, lotCode: 'LOT-2026-09' }, { viewer: owner })
    expect(first.lotId).toBeTruthy()
    const again = await recordMovement({ businessId: b(), productId: lotted.id, kind: 'RECEIPT', quantity: 5, lotCode: 'LOT-2026-09' }, { viewer: owner })
    expect(again.lotId).toBe(first.lotId)
    const lots = await listLots({ businessId: b(), productId: lotted.id, viewer: member })
    expect(lots).toHaveLength(1)
    expect(lots[0]).toMatchObject({ code: 'LOT-2026-09', receivedQty: 25, status: 'OPEN' })

    const dated = await createLot({ businessId: b(), productId: lotted.id, code: 'LOT-2026-10', factoryId: factory.id, manufacturedAt: '2026-10-01T00:00:00Z', expiresAt: '2027-10-01T00:00:00Z' }, { viewer: manager })
    expect(dated).toMatchObject({ factoryId: factory.id, receivedQty: 0 })
    await expect(createLot({ businessId: b(), productId: lotted.id, code: 'LOT-2026-10' }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'PRODUCT_LOT_CODE_TAKEN' })
    await expect(createLot({ businessId: b(), productId: plain.id, code: 'LOT-X' }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'INVENTORY_LOT_NOT_TRACKED' })
    await expect(createLot({ businessId: b(), productId: lotted.id, code: 'LOT-BAD', manufacturedAt: '2027-01-01T00:00:00Z', expiresAt: '2026-01-01T00:00:00Z' }, { viewer: owner })).rejects.toThrow(/expiresAt/)

    const issued = await recordMovement({ businessId: b(), productId: lotted.id, kind: 'ISSUE', quantity: 7, lotId: first.lotId }, { viewer: owner })
    expect(issued).toMatchObject({ onHandBefore: 25, onHandAfter: 18, lotId: first.lotId })
    await expect(recordMovement({ businessId: b(), productId: lotted.id, kind: 'ISSUE', quantity: 1, lotCode: 'LOT-NOPE' }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'PRODUCT_LOT_NOT_FOUND' })
  })

  it('AC-155.4 — a SERIAL-tracked SKU: one row per serial, a unit exists from its receipt, is ISSUED by its issue, and cannot be issued twice', async () => {
    const receipt = await recordMovement({ businessId: b(), productId: serial.id, kind: 'RECEIPT', quantity: 3, serialNos: ['SN-1', 'SN-2', 'SN-3'], lotCode: 'SER-LOT' }, { viewer: manager })
    expect(receipt).toMatchObject({ onHandBefore: 0, onHandAfter: 3 })
    expect(receipt.movements).toHaveLength(3)
    expect(receipt.movements.every((m) => m.quantity === 1 && m.serialUnitId)).toBe(true)
    const units = await listSerialUnits({ businessId: b(), productId: serial.id, viewer: member })
    expect(units.map((u) => [u.serialNo, u.status])).toEqual([['SN-1', 'IN_STOCK'], ['SN-2', 'IN_STOCK'], ['SN-3', 'IN_STOCK']])
    expect(units.every((u) => u.lotId === receipt.lotId)).toBe(true)

    await expect(recordMovement({ businessId: b(), productId: serial.id, kind: 'RECEIPT', quantity: 1, serialNos: ['SN-1'] }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'INVENTORY_SERIAL_ALREADY_IN_STOCK' })
    await expect(recordMovement({ businessId: b(), productId: serial.id, kind: 'RECEIPT', quantity: 2, serialNos: ['SN-9'] }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'INVENTORY_SERIAL_COUNT_MISMATCH' })
    await expect(recordMovement({ businessId: b(), productId: serial.id, kind: 'ADJUSTMENT', quantity: 1 }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'INVENTORY_SERIAL_ADJUSTMENT_NOT_ALLOWED' })

    const issue = await recordMovement({ businessId: b(), productId: serial.id, kind: 'ISSUE', quantity: 2, serialNos: ['SN-1', 'SN-3'] }, { viewer: owner })
    expect(issue).toMatchObject({ onHandBefore: 3, onHandAfter: 1 })
    expect((await listSerialUnits({ businessId: b(), productId: serial.id, status: 'ISSUED', viewer: member })).map((u) => u.serialNo)).toEqual(['SN-1', 'SN-3'])
    await expect(recordMovement({ businessId: b(), productId: serial.id, kind: 'ISSUE', quantity: 1, serialNos: ['SN-1'] }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'INVENTORY_SERIAL_NOT_IN_STOCK' })
    await expect(recordMovement({ businessId: b(), productId: serial.id, kind: 'ISSUE', quantity: 1, serialNos: ['SN-404'] }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'INVENTORY_SERIAL_NOT_IN_STOCK' })

    const returned = await recordMovement({ businessId: b(), productId: serial.id, kind: 'RECEIPT', quantity: 1, serialNos: ['SN-1'] }, { viewer: owner })
    expect(returned.onHandAfter).toBe(2)
    const unitAudits = await prisma.auditEvent.findMany({ where: { entityType: 'SERIAL_UNIT', entityId: units[0].id }, orderBy: { occurredAt: 'asc' } })
    expect(unitAudits.map((a) => a.action)).toEqual(['SERIAL_UNIT_RECEIVED', 'SERIAL_UNIT_ISSUED', 'SERIAL_UNIT_RECEIVED'])
  })

  it('AC-155.5 — the summary recomputes every on-hand, flags safety stock, and prints null (never zero) for an uncounted product', async () => {
    const summary = await stockSummary({ businessId: b(), viewer: member })
    const byCode = Object.fromEntries(summary.products.map((p) => [p.code, p]))
    expect(byCode['TEA-PLAIN']).toMatchObject({ onHand: 3, safetyStock: 4, belowSafetyStock: true })
    expect(byCode['TEA-LOT']).toMatchObject({ onHand: 18, belowSafetyStock: false })
    expect(byCode['TEA-SERIAL']).toMatchObject({ onHand: 2, safetyStock: 1, belowSafetyStock: false })
    expect(byCode['TEA-CEREMONY']).toMatchObject({ onHand: null, stockPolicy: 'UNTRACKED', belowSafetyStock: false })
    // @req FR-201 — services are counted apart from uncounted goods since ADR-083; none exists here.
    expect(summary.counts).toEqual({ products: 4, tracked: 3, untracked: 1, services: 0, phaseOut: 0, belowSafetyStock: 1, belowReorderPoint: 1 })
    await expect(stockSummary({ businessId: b(), viewer: makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [b()], visibleDomains: ['projects'] }) })).rejects.toMatchObject({ status: 404 })
  })

  it('AC-155.6 — an issue that names no lot is consumed FEFO across open lots; one that names a lot may not exceed it', async () => {
    // LOT-2026-09 holds 18 with no expiry; LOT-2026-10 expires 2027-10 and now receives 5.
    const dated = (await listLots({ businessId: b(), productId: lotted.id, viewer: member })).find((l) => l.code === 'LOT-2026-10')
    await recordMovement({ businessId: b(), productId: lotted.id, kind: 'RECEIPT', quantity: 5, lotId: dated.id }, { viewer: owner })
    const fefo = await recordMovement({ businessId: b(), productId: lotted.id, kind: 'ISSUE', quantity: 20 }, { viewer: owner })
    expect(fefo).toMatchObject({ onHandBefore: 23, onHandAfter: 3, lotId: null })
    expect(fefo.movements).toHaveLength(2)
    // The dated lot goes first (an unknown expiry sorts last), then the rest from the undated one.
    expect(fefo.allocations.map((a) => a.qty)).toEqual([5, 15])
    expect(fefo.allocations[0].lotId).toBe(dated.id)
    const lots = Object.fromEntries((await listLots({ businessId: b(), productId: lotted.id, viewer: member })).map((l) => [l.code, l.onHand]))
    expect(lots).toEqual({ 'LOT-2026-09': 3, 'LOT-2026-10': 0 })
    // With 5 more in the dated lot the product holds 8, but the undated lot still holds 3:
    // an issue that names that lot is refused by the lot, an unnamed one only by the total.
    await recordMovement({ businessId: b(), productId: lotted.id, kind: 'RECEIPT', quantity: 5, lotId: dated.id }, { viewer: owner })
    const undated = (await listLots({ businessId: b(), productId: lotted.id, viewer: member })).find((l) => l.code === 'LOT-2026-09')
    await expect(recordMovement({ businessId: b(), productId: lotted.id, kind: 'ISSUE', quantity: 4, lotId: undated.id }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'INVENTORY_LOT_INSUFFICIENT_STOCK' })
    await expect(recordMovement({ businessId: b(), productId: lotted.id, kind: 'ISSUE', quantity: 9 }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'INVENTORY_INSUFFICIENT_STOCK' })
    await expect(recordMovement({ businessId: b(), productId: lotted.id, kind: 'ISSUE', quantity: 8 }, { viewer: owner })).resolves.toMatchObject({ onHandAfter: 0 })
    const audit = await prisma.auditEvent.findFirst({ where: { entityType: 'STOCK_MOVEMENT', entityId: fefo.movements[0].id } })
    expect(JSON.parse(audit.payloadJson).allocations).toHaveLength(2)
  })
})
