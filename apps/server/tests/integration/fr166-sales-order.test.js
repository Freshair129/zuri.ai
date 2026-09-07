// @req FR-166 — sales orders against a real database: the generated code,
//   lines with exact money and computed totals, the Customer and Conversation
//   reached only through the Business's tenant (the Conversation makes the
//   sale CHAT), the authority ladder, UPDATE while DRAFT, CONFIRM, COMPLETE
//   with stock issued through the Inventory ledger (or refused whole),
//   CANCEL, version conflicts and audit.
// @spec ADR-065; ADR-054 D3/D4; BR-001; BR-002; SEC-001; FR-072
// @tested tests/integration/fr166-sales-order.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { ROLE_INVENTORY_MANAGER, ROLE_SALES_REP } from '@/modules/identity/rbac'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { createCategory, createProduct, createProductMaster } from '@/modules/inventory/application/inventory-catalog-service'
import { recordMovement, stockSummary } from '@/modules/inventory/application/inventory-stock-service'
import { applyOrderAction, createOrder, getOrder, listOrders } from '@/modules/commerce/application/sales-order-service'

const NOW = new Date('2026-09-06T03:00:00Z')
const DOMAINS = ['projects', 'platform', 'commerce', 'customer', 'inventory']
let tenantA, busA, busA2, tenantB, busB, owner, rep, repWithStock, member, noDomain, box, card, gadget, foreignProduct, convA, customerA, customerB

describe('FR-166 SalesOrder', () => {
  beforeAll(async () => {
    const pfA = await createPortfolio({ name: 'Order Group A', code: 'PF-ORD-A' })
    tenantA = await createTenant({ portfolioId: pfA.id, name: 'Order Tenant A', code: 'TNT-ORD-A' })
    busA = await createBusiness({ tenantId: tenantA.id, name: 'ร้านของขวัญ', code: 'BUS-ORD-A' })
    busA2 = await createBusiness({ tenantId: tenantA.id, name: 'ร้านพี่น้อง', code: 'BUS-ORD-A2' })
    const pfB = await createPortfolio({ name: 'Order Group B', code: 'PF-ORD-B' })
    tenantB = await createTenant({ portfolioId: pfB.id, name: 'Order Tenant B', code: 'TNT-ORD-B' })
    busB = await createBusiness({ tenantId: tenantB.id, name: 'ร้านอื่น', code: 'BUS-ORD-B' })

    owner = makeViewer({ visibleBusinessIds: [busA.id, busA2.id], ownedBusinessIds: [busA.id, busA2.id], visibleDomains: DOMAINS })
    rep = makeViewer({ visibleBusinessIds: [busA.id], ownedBusinessIds: [], visibleDomains: DOMAINS, rolesByBusinessId: { [busA.id]: [ROLE_SALES_REP] }, principal: { id: 'per-rep', code: 'PER-REP', displayName: 'Rep' } })
    repWithStock = makeViewer({ visibleBusinessIds: [busA.id], ownedBusinessIds: [], visibleDomains: DOMAINS, rolesByBusinessId: { [busA.id]: [ROLE_SALES_REP, ROLE_INVENTORY_MANAGER] } })
    member = makeViewer({ visibleBusinessIds: [busA.id], ownedBusinessIds: [], visibleDomains: DOMAINS })
    noDomain = makeViewer({ visibleBusinessIds: [busA.id], ownedBusinessIds: [busA.id], visibleDomains: ['projects'] })
    const ownerB = makeViewer({ visibleBusinessIds: [busB.id], ownedBusinessIds: [busB.id], visibleDomains: DOMAINS })

    const category = await createCategory({ businessId: busA.id, code: 'gifts', nameTh: 'ของขวัญ', nameEn: 'Gifts' }, { viewer: owner })
    const master = await createProductMaster({ businessId: busA.id, code: 'PM-ORD', categoryId: category.id, nameTh: 'ชุดของขวัญ', nameEn: 'Gift set' }, { viewer: owner })
    box = await createProduct({ businessId: busA.id, code: 'BOX-ORD', productMasterId: master.id, name: 'Gift box' }, { viewer: owner })
    card = await createProduct({ businessId: busA.id, code: 'CARD-ORD', productMasterId: master.id, name: 'Card', stockPolicy: 'UNTRACKED' }, { viewer: owner })
    gadget = await createProduct({ businessId: busA.id, code: 'GADGET-ORD', productMasterId: master.id, trackingMode: 'SERIAL' }, { viewer: owner })
    await recordMovement({ businessId: busA.id, productId: box.id, kind: 'RECEIPT', quantity: 5 }, { viewer: owner })
    const catB = await createCategory({ businessId: busB.id, code: 'other', nameTh: 'อื่น', nameEn: 'Other' }, { viewer: ownerB })
    const masterB = await createProductMaster({ businessId: busB.id, code: 'PM-B', categoryId: catB.id, nameTh: 'x', nameEn: 'x' }, { viewer: ownerB })
    foreignProduct = await createProduct({ businessId: busB.id, code: 'SKU-B', productMasterId: masterB.id }, { viewer: ownerB })

    const a = await ingestLineMessage({ tenantId: tenantA.id, businessId: busA.id, lineUserId: 'U-ord-a', displayName: 'ลูกค้า เอ', threadId: 'TH-ORD-A', text: 'สั่งซื้อ', externalMessageId: 'MO-1' })
    convA = a.conversationId; customerA = a.customerId
    const b = await ingestLineMessage({ tenantId: tenantB.id, businessId: busB.id, lineUserId: 'U-ord-b', displayName: 'ลูกค้า บี', threadId: 'TH-ORD-B', text: 'x', externalMessageId: 'MO-2' })
    customerB = b.customerId
  })

  const lines = () => [{ productId: box.id, qty: 2, unitPrice: 745, discount: 45 }, { description: 'ค่าจัดส่ง', qty: 1, unitPrice: 100 }]
  const create = (over = {}, viewer = owner) => createOrder({ businessId: busA.id, lines: lines(), ...over }, { viewer, now: NOW })

  it('AC-162.1 — creates with a generated ORD code, exact totals from the lines, and the product lending its name', async () => {
    const order = await create({ discount: 50, notes: 'ส่งวันศุกร์' }, rep)
    expect(order).toMatchObject({ code: 'ORD-20260906-001', businessId: busA.id, tenantId: tenantA.id, origin: 'WALK_IN', status: 'DRAFT', currency: 'THB', attributed: false, version: 1, createdByPersonId: 'per-rep' })
    expect(order.lines.map((l) => [l.description, l.qty, l.unitPrice, l.discount, l.lineTotal])).toEqual([['Gift box', 2, 745, 45, 1445], ['ค่าจัดส่ง', 1, 100, 0, 100]])
    expect(order).toMatchObject({ subtotal: 1590, lineDiscount: 45, discount: 50, total: 1495, paid: 0, balanceDue: 1495, paymentState: 'UNPAID' })
    const second = await create()
    expect(second.code).toBe('ORD-20260906-002')
    const audits = await prisma.auditEvent.findMany({ where: { entityType: 'SALES_ORDER', entityId: order.id } })
    expect(audits.map((a) => a.action)).toEqual(['SALES_ORDER_CREATED'])
  })

  it('AC-162.2 — a Conversation makes the sale CHAT and supplies its Customer; every reference stays inside the tenant', async () => {
    const chat = await create({ conversationId: convA, origin: 'ONLINE' })
    expect(chat).toMatchObject({ origin: 'CHAT', attributed: true, customerId: customerA })
    expect(chat.customer).toMatchObject({ displayName: 'ลูกค้า เอ' })
    await expect(create({ customerId: customerB })).rejects.toMatchObject({ status: 422, message: 'CUSTOMER_NOT_FOUND' })
    await expect(create({ conversationId: convA, customerId: customerB })).rejects.toMatchObject({ status: 422, message: 'CUSTOMER_NOT_FOUND' })
    await expect(create({ conversationId: 'no-such' })).rejects.toMatchObject({ status: 422, message: 'CONVERSATION_NOT_FOUND' })
    await expect(create({ lines: [{ productId: foreignProduct.id, qty: 1, unitPrice: 1 }] })).rejects.toMatchObject({ status: 422, message: 'PRODUCT_NOT_FOUND' })
  })

  it('AC-162.3 — the authority ladder: the commerce domain gate, then OWNER or SALES_REP writes; members read', async () => {
    await expect(listOrders({ businessId: busA.id }, { viewer: member })).resolves.toMatchObject({ businessId: busA.id })
    await expect(create({}, member)).rejects.toMatchObject({ status: 404, message: 'Business not found' })
    await expect(listOrders({ businessId: busA.id }, { viewer: noDomain })).rejects.toMatchObject({ status: 404 })
    await expect(listOrders({ businessId: busB.id }, { viewer: owner })).rejects.toMatchObject({ status: 404 })
    await expect(getOrder('no-such-order', { viewer: owner })).rejects.toMatchObject({ status: 404, message: 'Business not found' })
    const order = await create({}, rep)
    await expect(getOrder(order.id, { viewer: member })).resolves.toMatchObject({ id: order.id })
    await expect(applyOrderAction(order.id, { action: 'CONFIRM', version: 1 }, { viewer: member })).rejects.toMatchObject({ status: 404 })
  })

  it('AC-162.4 — UPDATE replaces lines only while DRAFT; CONFIRM locks them; a stale version conflicts', async () => {
    const order = await create()
    const updated = await applyOrderAction(order.id, { action: 'UPDATE', version: 1, fields: { lines: [{ description: 'บริการห่อ', qty: 3, unitPrice: 20 }], discount: 0, notes: 'แก้ไข' } }, { viewer: owner, now: NOW })
    expect(updated).toMatchObject({ total: 60, notes: 'แก้ไข', version: 2 })
    expect(updated.lines).toHaveLength(1)
    const confirmed = await applyOrderAction(order.id, { action: 'CONFIRM', version: 2 }, { viewer: rep, now: NOW })
    expect(confirmed).toMatchObject({ status: 'CONFIRMED', version: 3 })
    expect(confirmed.confirmedAt).toBeTruthy()
    await expect(applyOrderAction(order.id, { action: 'UPDATE', version: 3, fields: { lines: [{ description: 'x', qty: 1, unitPrice: 1 }] } }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'SALES_ORDER_LINES_LOCKED' })
    const noted = await applyOrderAction(order.id, { action: 'UPDATE', version: 3, fields: { notes: 'ยังแก้หมายเหตุได้' } }, { viewer: owner, now: NOW })
    expect(noted).toMatchObject({ notes: 'ยังแก้หมายเหตุได้', version: 4 })
    await expect(applyOrderAction(order.id, { action: 'CONFIRM', version: 4 }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'SALES_ORDER_STATUS_INVALID' })
    await expect(applyOrderAction(order.id, { action: 'CANCEL', version: 1 }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'SALES_ORDER_VERSION_CONFLICT' })
    await expect(applyOrderAction(order.id, { action: 'COMPLETE', version: 4 }, { viewer: owner, now: NOW })).resolves.toMatchObject({ status: 'COMPLETED', stockIssuedAt: null })
  })

  it('AC-162.5 — COMPLETE with issueStock takes every counted line from the Inventory ledger, or nothing', async () => {
    const order = await create({ lines: [{ productId: box.id, qty: 2, unitPrice: 745 }, { productId: card.id, qty: 2, unitPrice: 30 }, { description: 'ค่าจัดส่ง', qty: 1, unitPrice: 100 }] }, rep)
    await applyOrderAction(order.id, { action: 'CONFIRM', version: 1 }, { viewer: rep, now: NOW })
    await expect(applyOrderAction(order.id, { action: 'COMPLETE', version: 2, issueStock: true }, { viewer: rep, now: NOW })).rejects.toMatchObject({ status: 403, message: 'COMMERCE_STOCK_ISSUE_REQUIRES_INVENTORY_AUTHORITY' })
    const done = await applyOrderAction(order.id, { action: 'COMPLETE', version: 2, issueStock: true }, { viewer: repWithStock, now: NOW })
    expect(done).toMatchObject({ status: 'COMPLETED', version: 3 })
    expect(done.stockIssuedAt).toBeTruthy()
    const stock = await stockSummary({ businessId: busA.id, viewer: owner })
    expect(stock.products.find((p) => p.code === 'BOX-ORD').onHand).toBe(3)
    const issued = await prisma.stockMovement.findMany({ where: { reference: `ORDER:${order.code}` } })
    expect(issued.map((m) => [m.kind, m.quantity])).toEqual([['ISSUE', -2]])
    const audit = await prisma.auditEvent.findFirst({ where: { entityType: 'SALES_ORDER', entityId: order.id, action: 'SALES_ORDER_COMPLETED' } })
    expect(JSON.parse(audit.payloadJson).issued).toEqual([{ productId: box.id, code: 'BOX-ORD', quantity: 2, onHandAfter: 3 }])

    const big = await create({ lines: [{ productId: box.id, qty: 10, unitPrice: 745 }] })
    await applyOrderAction(big.id, { action: 'CONFIRM', version: 1 }, { viewer: owner, now: NOW })
    const error = await applyOrderAction(big.id, { action: 'COMPLETE', version: 2, issueStock: true }, { viewer: owner, now: NOW }).catch((e) => e)
    expect(error).toMatchObject({ status: 409, message: 'COMMERCE_STOCK_SHORTAGE' })
    expect(error.details).toEqual([{ productId: box.id, code: 'BOX-ORD', required: 10, onHand: 3, shortage: 7 }])
    expect((await getOrder(big.id, { viewer: owner })).status).toBe('CONFIRMED')

    const serial = await create({ lines: [{ productId: gadget.id, qty: 1, unitPrice: 1 }] })
    await applyOrderAction(serial.id, { action: 'CONFIRM', version: 1 }, { viewer: owner, now: NOW })
    await expect(applyOrderAction(serial.id, { action: 'COMPLETE', version: 2, issueStock: true }, { viewer: owner, now: NOW })).rejects.toMatchObject({ status: 422, message: 'COMMERCE_SERIAL_LINE_UNSUPPORTED' })
  })

  it('AC-162.6 — CANCEL keeps the row; the list hides closed orders unless asked and summarises open work', async () => {
    const business = await createBusiness({ tenantId: tenantA.id, name: 'ร้านสรุป', code: 'BUS-ORD-SUM' })
    const boss = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: DOMAINS })
    const mk = (title) => createOrder({ businessId: business.id, lines: [{ description: title, qty: 1, unitPrice: 100 }] }, { viewer: boss, now: NOW })
    const a = await mk('a')
    const b = await mk('b')
    const c = await mk('c')
    await applyOrderAction(b.id, { action: 'CONFIRM', version: 1 }, { viewer: boss, now: NOW })
    const cancelled = await applyOrderAction(c.id, { action: 'CANCEL', version: 1, reason: 'ลูกค้ายกเลิก' }, { viewer: boss, now: NOW })
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelReason: 'ลูกค้ายกเลิก' })
    expect(await prisma.salesOrder.findUnique({ where: { id: c.id }, select: { id: true } })).toBeTruthy()
    const open = await listOrders({ businessId: business.id }, { viewer: boss })
    expect(open.orders.map((o) => o.id).sort()).toEqual([a.id, b.id].sort())
    expect(open.summary).toEqual({ open: 2, unpaid: 2, pendingPayments: 0 })
    expect((await listOrders({ businessId: business.id, includeClosed: true }, { viewer: boss })).orders).toHaveLength(3)
    expect((await listOrders({ businessId: business.id, status: 'CANCELLED' }, { viewer: boss })).orders.map((o) => o.id)).toEqual([c.id])
  })
})
