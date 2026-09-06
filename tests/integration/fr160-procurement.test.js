// @req FR-160 — suppliers and purchase orders against a real database: the
//   supplier with its code unique per Tenant, archived never deleted; the
//   order with a generated code, lines that name same-Business SKUs at the
//   agreed cost, totals computed on read, the authority ladder, UPDATE while
//   DRAFT, SEND, CLOSE, CANCEL, version conflicts and audit.
// @spec ADR-066; ADR-054 D3/D4; BR-001; BR-002; SEC-001; FR-072
// @tested tests/integration/fr160-procurement.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { ROLE_PROCUREMENT_BUYER } from '@/modules/identity/rbac'
import { createCategory, createProduct, createProductMaster } from '@/modules/inventory/application/inventory-catalog-service'
import { applySupplierAction, createSupplier, getSupplier, listSuppliers } from '@/modules/procurement/application/supplier-service'
import { applyPurchaseOrderAction, createPurchaseOrder, getPurchaseOrder, listPurchaseOrders } from '@/modules/procurement/application/purchase-order-service'

const NOW = new Date('2026-09-06T03:00:00Z')
const DOMAINS = ['projects', 'platform', 'procurement', 'inventory']
let tenantA, busA, busA2, busB, owner, buyer, member, noDomain, ownerB, box, service, foreignProduct, supplier, otherSupplier, foreignSupplier

describe('FR-160 Supplier and PurchaseOrder', () => {
  beforeAll(async () => {
    const pfA = await createPortfolio({ name: 'Buy Group A', code: 'PF-PO-A' })
    tenantA = await createTenant({ portfolioId: pfA.id, name: 'Buy Tenant A', code: 'TNT-PO-A' })
    busA = await createBusiness({ tenantId: tenantA.id, name: 'ร้านของขวัญ', code: 'BUS-PO-A' })
    busA2 = await createBusiness({ tenantId: tenantA.id, name: 'ร้านพี่น้อง', code: 'BUS-PO-A2' })
    const pfB = await createPortfolio({ name: 'Buy Group B', code: 'PF-PO-B' })
    const tenantB = await createTenant({ portfolioId: pfB.id, name: 'Buy Tenant B', code: 'TNT-PO-B' })
    busB = await createBusiness({ tenantId: tenantB.id, name: 'ร้านอื่น', code: 'BUS-PO-B' })

    owner = makeViewer({ visibleBusinessIds: [busA.id, busA2.id], ownedBusinessIds: [busA.id, busA2.id], visibleDomains: DOMAINS })
    buyer = makeViewer({ visibleBusinessIds: [busA.id], ownedBusinessIds: [], visibleDomains: DOMAINS, rolesByBusinessId: { [busA.id]: [ROLE_PROCUREMENT_BUYER] }, principal: { id: 'per-buyer', code: 'PER-BUYER', displayName: 'Buyer' } })
    member = makeViewer({ visibleBusinessIds: [busA.id], ownedBusinessIds: [], visibleDomains: DOMAINS })
    noDomain = makeViewer({ visibleBusinessIds: [busA.id], ownedBusinessIds: [busA.id], visibleDomains: ['projects'] })
    ownerB = makeViewer({ visibleBusinessIds: [busB.id], ownedBusinessIds: [busB.id], visibleDomains: DOMAINS })

    const category = await createCategory({ businessId: busA.id, code: 'packaging', nameTh: 'บรรจุภัณฑ์', nameEn: 'Packaging' }, { viewer: owner })
    const master = await createProductMaster({ businessId: busA.id, code: 'PM-PO', categoryId: category.id, nameTh: 'กล่อง', nameEn: 'Box' }, { viewer: owner })
    box = await createProduct({ businessId: busA.id, code: 'BOX-PO', productMasterId: master.id, name: 'Gift box' }, { viewer: owner })
    service = await createProduct({ businessId: busA.id, code: 'PRINT-PO', productMasterId: master.id, name: 'Printing', stockPolicy: 'UNTRACKED' }, { viewer: owner })
    const catB = await createCategory({ businessId: busB.id, code: 'other', nameTh: 'อื่น', nameEn: 'Other' }, { viewer: ownerB })
    const masterB = await createProductMaster({ businessId: busB.id, code: 'PM-B', categoryId: catB.id, nameTh: 'x', nameEn: 'x' }, { viewer: ownerB })
    foreignProduct = await createProduct({ businessId: busB.id, code: 'SKU-B', productMasterId: masterB.id }, { viewer: ownerB })
    otherSupplier = await createSupplier({ businessId: busA2.id, code: 'SUP-A2', name: 'ผู้ขายของร้านพี่น้อง' }, { viewer: owner })
    foreignSupplier = await createSupplier({ businessId: busB.id, code: 'SUP-B', name: 'ผู้ขายของร้านอื่น' }, { viewer: ownerB })
  })

  const lines = () => [{ productId: box.id, qty: 10, unitCost: 12.5 }, { productId: service.id, qty: 2, unitCost: 30 }, { description: 'ค่าขนส่ง', qty: 1, unitCost: 100 }]
  const create = (over = {}, viewer = owner) => createPurchaseOrder({ businessId: busA.id, supplierId: supplier.id, lines: lines(), ...over }, { viewer, now: NOW })

  it('AC-160.1 — a supplier is created with a code unique per Tenant, updated, archived and never deleted', async () => {
    supplier = await createSupplier({ businessId: busA.id, code: 'SUP-001', name: 'บริษัท กล่องดี จำกัด', contactName: 'คุณเอ', phone: '02-000-0000', paymentTerms: 'เครดิต 30 วัน', leadTimeDays: 7 }, { viewer: buyer })
    expect(supplier).toMatchObject({ code: 'SUP-001', businessId: busA.id, tenantId: tenantA.id, status: 'ACTIVE', leadTimeDays: 7, purchaseOrders: 0, version: 1 })
    await expect(createSupplier({ businessId: busA.id, code: 'SUP-001', name: 'ซ้ำ' }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'SUPPLIER_CODE_TAKEN' })
    await expect(createSupplier({ businessId: busA.id, code: 'bad code', name: 'x' }, { viewer: owner })).rejects.toThrow(/code/)
    const audits = await prisma.auditEvent.findMany({ where: { entityType: 'SUPPLIER', entityId: supplier.id } })
    expect(audits.map((a) => a.action)).toEqual(['SUPPLIER_CREATED'])

    const spare = await createSupplier({ businessId: busA.id, code: 'SUP-OLD', name: 'ผู้ขายเก่า' }, { viewer: owner })
    const updated = await applySupplierAction(spare.id, { action: 'UPDATE', version: 1, fields: { name: 'ผู้ขายเก่า (แก้ชื่อ)', leadTimeDays: 3 } }, { viewer: buyer })
    expect(updated).toMatchObject({ name: 'ผู้ขายเก่า (แก้ชื่อ)', leadTimeDays: 3, version: 2 })
    await expect(applySupplierAction(spare.id, { action: 'ARCHIVE', version: 1 }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'SUPPLIER_VERSION_CONFLICT' })
    const archived = await applySupplierAction(spare.id, { action: 'ARCHIVE', version: 2, reason: 'เลิกกิจการ' }, { viewer: owner, now: NOW })
    expect(archived).toMatchObject({ status: 'ARCHIVED', version: 3 })
    expect(archived.archivedAt).toBeTruthy()
    await expect(applySupplierAction(spare.id, { action: 'UPDATE', version: 3, fields: { name: 'x' } }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'SUPPLIER_STATUS_INVALID' })
    expect((await listSuppliers({ businessId: busA.id }, { viewer: member })).map((s) => s.code)).toEqual(['SUP-001'])
    expect((await listSuppliers({ businessId: busA.id, includeArchived: true }, { viewer: member })).map((s) => s.code)).toEqual(['SUP-001', 'SUP-OLD'])
    expect(await prisma.supplier.findUnique({ where: { id: spare.id }, select: { id: true } })).toBeTruthy()
  })

  it('AC-160.2 — the authority ladder: the procurement domain gate, then OWNER or PROCUREMENT_BUYER writes; members read', async () => {
    await expect(getSupplier(supplier.id, { viewer: member })).resolves.toMatchObject({ id: supplier.id })
    await expect(createSupplier({ businessId: busA.id, code: 'SUP-M', name: 'x' }, { viewer: member })).rejects.toMatchObject({ status: 404, message: 'Business not found' })
    await expect(listSuppliers({ businessId: busA.id }, { viewer: noDomain })).rejects.toMatchObject({ status: 404 })
    await expect(listSuppliers({ businessId: busB.id }, { viewer: owner })).rejects.toMatchObject({ status: 404 })
    await expect(getSupplier(foreignSupplier.id, { viewer: owner })).rejects.toMatchObject({ status: 404, message: 'Business not found' })
    await expect(getSupplier('no-such', { viewer: owner })).rejects.toMatchObject({ status: 404 })
    await expect(listPurchaseOrders({ businessId: busA.id }, { viewer: member })).resolves.toMatchObject({ businessId: busA.id })
    await expect(create({}, member)).rejects.toMatchObject({ status: 404, message: 'Business not found' })
    await expect(getPurchaseOrder('no-such-order', { viewer: owner })).rejects.toMatchObject({ status: 404 })
  })

  it('AC-160.3 — creates with a generated PO code, exact totals from the lines, the product lending its name; every reference stays inside the Business', async () => {
    const order = await create({ notes: 'ส่งภายในศุกร์', expectedAt: '2026-09-11T00:00:00Z' }, buyer)
    expect(order).toMatchObject({ code: 'PO-20260906-001', businessId: busA.id, tenantId: tenantA.id, status: 'DRAFT', currency: 'THB', receiptState: 'NONE', receiptCount: 0, version: 1, createdByPersonId: 'per-buyer' })
    expect(order.supplier).toMatchObject({ code: 'SUP-001', name: 'บริษัท กล่องดี จำกัด' })
    expect(order.lines.map((l) => [l.description, l.qty, l.unitCost, l.lineTotal, l.receivedQty, l.outstandingQty, l.product?.counted ?? null])).toEqual([
      ['Gift box', 10, 12.5, 125, 0, 10, true], ['Printing', 2, 30, 60, 0, 2, false], ['ค่าขนส่ง', 1, 100, 100, 0, 1, null],
    ])
    expect(order).toMatchObject({ total: 285, receivedValue: 0, outstandingValue: 285 })
    expect((await create()).code).toBe('PO-20260906-002')
    const audits = await prisma.auditEvent.findMany({ where: { entityType: 'PURCHASE_ORDER', entityId: order.id } })
    expect(audits.map((a) => a.action)).toEqual(['PURCHASE_ORDER_CREATED'])
    expect((await getSupplier(supplier.id, { viewer: member })).purchaseOrders).toBe(2)

    await expect(create({ supplierId: otherSupplier.id })).rejects.toMatchObject({ status: 422, message: 'SUPPLIER_NOT_FOUND' })
    await expect(create({ supplierId: foreignSupplier.id })).rejects.toMatchObject({ status: 422, message: 'SUPPLIER_NOT_FOUND' })
    await expect(create({ lines: [{ productId: foreignProduct.id, qty: 1, unitCost: 1 }] })).rejects.toMatchObject({ status: 422, message: 'PRODUCT_NOT_FOUND' })
    const archived = await createSupplier({ businessId: busA.id, code: 'SUP-GONE', name: 'x' }, { viewer: owner })
    await applySupplierAction(archived.id, { action: 'ARCHIVE', version: 1 }, { viewer: owner })
    await expect(create({ supplierId: archived.id })).rejects.toMatchObject({ status: 409, message: 'SUPPLIER_ARCHIVED' })
  })

  it('AC-160.4 — UPDATE replaces lines and supplier only while DRAFT; SEND locks them; CLOSE short-closes; a stale version conflicts', async () => {
    const order = await create()
    const second = await createSupplier({ businessId: busA.id, code: 'SUP-002', name: 'ผู้ขายสอง' }, { viewer: owner })
    const updated = await applyPurchaseOrderAction(order.id, { action: 'UPDATE', version: 1, fields: { supplierId: second.id, lines: [{ description: 'ริบบิ้น', qty: 4, unitCost: 5 }], notes: 'แก้ไข' } }, { viewer: buyer, now: NOW })
    expect(updated).toMatchObject({ total: 20, notes: 'แก้ไข', version: 2 })
    expect(updated.supplier.code).toBe('SUP-002')
    expect(updated.lines).toHaveLength(1)
    const sent = await applyPurchaseOrderAction(order.id, { action: 'SEND', version: 2 }, { viewer: buyer, now: NOW })
    expect(sent).toMatchObject({ status: 'SENT', version: 3 })
    expect(sent.sentAt).toBeTruthy()
    await expect(applyPurchaseOrderAction(order.id, { action: 'UPDATE', version: 3, fields: { lines: [{ description: 'x', qty: 1, unitCost: 1 }] } }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'PURCHASE_ORDER_LINES_LOCKED' })
    await expect(applyPurchaseOrderAction(order.id, { action: 'UPDATE', version: 3, fields: { supplierId: supplier.id } }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'PURCHASE_ORDER_SUPPLIER_LOCKED' })
    const noted = await applyPurchaseOrderAction(order.id, { action: 'UPDATE', version: 3, fields: { notes: 'ยังแก้หมายเหตุได้', expectedAt: '2026-09-20T00:00:00Z' } }, { viewer: owner, now: NOW })
    expect(noted).toMatchObject({ notes: 'ยังแก้หมายเหตุได้', version: 4 })
    await expect(applyPurchaseOrderAction(order.id, { action: 'SEND', version: 4 }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'PURCHASE_ORDER_STATUS_INVALID' })
    await expect(applyPurchaseOrderAction(order.id, { action: 'CLOSE', version: 1 }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'PURCHASE_ORDER_VERSION_CONFLICT' })
    const closed = await applyPurchaseOrderAction(order.id, { action: 'CLOSE', version: 4, reason: 'ผู้ขายส่งไม่ได้' }, { viewer: owner, now: NOW })
    expect(closed).toMatchObject({ status: 'CLOSED', closeReason: 'ผู้ขายส่งไม่ได้', receiptState: 'NONE', version: 5 })
    expect(closed.closedAt).toBeTruthy()
    await expect(applyPurchaseOrderAction(order.id, { action: 'UPDATE', version: 5, fields: { notes: 'x' } }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'PURCHASE_ORDER_STATUS_INVALID' })
    await expect(applyPurchaseOrderAction(order.id, { action: 'SEND', version: 5 }, { viewer: member })).rejects.toMatchObject({ status: 404 })
    const audit = await prisma.auditEvent.findFirst({ where: { entityType: 'PURCHASE_ORDER', entityId: order.id, action: 'PURCHASE_ORDER_CLOSED' } })
    expect(JSON.parse(audit.payloadJson)).toMatchObject({ reason: 'ผู้ขายส่งไม่ได้', receiptState: 'NONE', version: 5 })
  })

  it('AC-160.5 — CANCEL keeps the row; the list hides closed orders unless asked and summarises what is waited for', async () => {
    const business = await createBusiness({ tenantId: tenantA.id, name: 'ร้านสรุป', code: 'BUS-PO-SUM' })
    const boss = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: DOMAINS })
    const vendor = await createSupplier({ businessId: business.id, code: 'SUP-SUM', name: 'ผู้ขายสรุป' }, { viewer: boss })
    const mk = (title, cost) => createPurchaseOrder({ businessId: business.id, supplierId: vendor.id, lines: [{ description: title, qty: 2, unitCost: cost }] }, { viewer: boss, now: NOW })
    const a = await mk('a', 100)
    const b = await mk('b', 250)
    const c = await mk('c', 1)
    await applyPurchaseOrderAction(b.id, { action: 'SEND', version: 1 }, { viewer: boss, now: NOW })
    const cancelled = await applyPurchaseOrderAction(c.id, { action: 'CANCEL', version: 1, reason: 'สั่งผิด' }, { viewer: boss, now: NOW })
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelReason: 'สั่งผิด' })
    expect(await prisma.purchaseOrder.findUnique({ where: { id: c.id }, select: { id: true } })).toBeTruthy()
    const open = await listPurchaseOrders({ businessId: business.id }, { viewer: boss })
    expect(open.orders.map((o) => o.id).sort()).toEqual([a.id, b.id].sort())
    expect(open.summary).toEqual({ open: 2, draft: 1, awaitingDelivery: 1, partiallyReceived: 0, outstandingValue: 500 })
    expect((await listPurchaseOrders({ businessId: business.id, includeClosed: true }, { viewer: boss })).orders).toHaveLength(3)
    expect((await listPurchaseOrders({ businessId: business.id, status: 'CANCELLED' }, { viewer: boss })).orders.map((o) => o.id)).toEqual([c.id])
    expect((await listPurchaseOrders({ businessId: business.id, supplierId: vendor.id }, { viewer: boss })).orders).toHaveLength(2)
  })
})
