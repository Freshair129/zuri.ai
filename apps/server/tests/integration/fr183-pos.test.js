// @req FR-183 — real SQLite coverage for selected Branch/WarehouseLocation,
// manual POS prices, atomic order + pending payment + Inventory issue,
// cash/change exactness, QR configuration and rollback on payment/stock failure.
// @spec ADR-065; BR-001; BR-002; SEC-001; ZAI:PROPOSAL-COMMERCE-BILLING-POS-20260910
// @tested tests/integration/fr183-pos.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createBranch, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { ROLE_INVENTORY_MANAGER, ROLE_SALES_REP } from '@/modules/identity/rbac'
import { createCategory, createProduct, createProductMaster } from '@/modules/inventory/application/inventory-catalog-service'
import { createLocation } from '@/modules/inventory/application/warehouse-location-service'
import { recordMovement } from '@/modules/inventory/application/inventory-stock-service'
import { applyPaymentAction } from '@/modules/commerce/application/payment-service'
import { checkoutPosSale, getPosTerminalCatalogue } from '@/modules/commerce/application/pos-cashier-service'
import { updateBillingProfile } from '@/modules/commerce/application/billing-invoice-service'

const NOW = new Date('2026-09-06T03:00:00Z')
const DOMAINS = ['projects', 'platform', 'commerce', 'inventory']
let tenant, business, otherBusiness, owner, cashier, member, branch, warehouse, product

describe('FR-183 atomic POS checkout', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-FR183', name: 'POS Group' })
    tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-FR183', name: 'POS Tenant' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-FR183', name: 'POS Fixture' })
    otherBusiness = await createBusiness({ tenantId: tenant.id, code: 'BUS-FR183-OTHER', name: 'Other POS Fixture' })
    branch = await createBranch({ tenantId: tenant.id, businessId: business.id, code: 'BR-FR183', name: 'POS Branch' })
    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: DOMAINS, principal: { id: 'per-fr183-owner', code: 'PER-FR183-OWNER', displayName: 'POS Owner' } })
    cashier = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: DOMAINS, rolesByBusinessId: { [business.id]: [ROLE_SALES_REP, ROLE_INVENTORY_MANAGER] }, principal: { id: 'per-fr183-cashier', code: 'PER-FR183-CASHIER', displayName: 'Cashier' } })
    member = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: DOMAINS })
    const category = await createCategory({ businessId: business.id, code: 'pos-goods', nameTh: 'POS Goods', nameEn: 'POS Goods' }, { viewer: owner })
    const master = await createProductMaster({ businessId: business.id, code: 'PM-FR183', categoryId: category.id, nameTh: 'POS Item', nameEn: 'POS Item' }, { viewer: owner })
    product = await createProduct({ businessId: business.id, code: 'SKU-FR183', productMasterId: master.id, name: 'POS Item' }, { viewer: owner })
    warehouse = await createLocation({ businessId: business.id, code: 'LOC-FR183', name: 'POS Stock', type: 'TH_FINISHED_GOODS' }, { viewer: owner })
    await recordMovement({ businessId: business.id, productId: product.id, kind: 'RECEIPT', quantity: 10, targetLocationId: warehouse.id, reference: 'FIXTURE:FR183' }, { viewer: owner, now: NOW })
  })

  const checkout = (over = {}, viewer = cashier) => checkoutPosSale(business.id, {
    businessId: business.id,
    branchId: branch.id,
    warehouseLocationId: warehouse.id,
    lines: [{ productId: product.id, qty: 2, unitPrice: 10, ...(over.line ?? {}) }],
    payment: { method: 'CASH', receivedAmount: 25, ...(over.payment ?? {}) },
    ...(over.meta ?? {}),
  }, { viewer, now: NOW })

  it('catalogue returns identity and on-hand while leaving price manual', async () => {
    const catalogue = await getPosTerminalCatalogue(business.id, { viewer: member })
    expect(catalogue.branches).toEqual(expect.arrayContaining([expect.objectContaining({ id: branch.id })]))
    expect(catalogue.warehouseLocations).toEqual(expect.arrayContaining([expect.objectContaining({ id: warehouse.id })]))
    expect(catalogue.items.find((item) => item.productId === product.id)).toMatchObject({ code: 'SKU-FR183', onHand: 10, unitPrice: null })
    expect(catalogue.items.find((item) => item.productId === product.id)).not.toHaveProperty('price')
  })

  it('creates a completed WALK_IN order and PENDING payment atomically, with exact cash change and located stock issue', async () => {
    const result = await checkout()
    expect(result).toMatchObject({ success: true, status: 'PENDING', paymentStatus: 'PENDING', totalSatang: 2000, totalAmount: 20, receivedAmount: 25, changeAmount: 5, paymentMethod: 'CASH', branch: { id: branch.id }, warehouseLocation: { id: warehouse.id }, order: { status: 'COMPLETED', origin: 'WALK_IN', paymentState: 'UNPAID' } })
    const movement = await prisma.stockMovement.findFirst({ where: { salesOrderId: result.orderId, productId: product.id, kind: 'ISSUE' } })
    expect(movement).toMatchObject({ quantity: -2, sourceLocationId: warehouse.id, reference: `POS:${result.orderCode}` })
    const payment = await prisma.payment.findUnique({ where: { id: result.paymentId } })
    expect(payment).toMatchObject({ amountSatang: 2000, status: 'PENDING', verifiedAt: null })
    const verified = await applyPaymentAction(result.paymentId, { action: 'VERIFY', version: 1 }, { viewer: owner, now: NOW })
    expect(verified.payment).toMatchObject({ status: 'VERIFIED', amount: 20 })
    expect(verified.order).toMatchObject({ paid: 20, paymentState: 'PAID' })
  })

  it('rejects a persisted integer overflow before writes and keeps maximum cash change exact', async () => {
    const beforeOrders = await prisma.salesOrder.count({ where: { businessId: business.id } })
    const beforePayments = await prisma.payment.count({ where: { businessId: business.id } })
    const beforeMovements = await prisma.stockMovement.count({ where: { businessId: business.id } })
    await expect(checkout({ line: { qty: 2, unitPrice: 15000000 }, payment: { receivedAmount: 30000000 } })).rejects.toMatchObject({ status: 422, message: 'POS_AMOUNT_INVALID' })
    expect(await prisma.salesOrder.count({ where: { businessId: business.id } })).toBe(beforeOrders)
    expect(await prisma.payment.count({ where: { businessId: business.id } })).toBe(beforePayments)
    expect(await prisma.stockMovement.count({ where: { businessId: business.id } })).toBe(beforeMovements)
    const maximumCash = await checkout({ line: { qty: 1, unitPrice: 0.01 }, payment: { receivedAmount: 21474836.47 } })
    expect(maximumCash).toMatchObject({ totalSatang: 1, receivedAmountSatang: 2147483647, changeAmountSatang: 2147483646 })
  })

  it('requires both Commerce order authority and Inventory write authority, and refuses cross-scope locations', async () => {
    await expect(checkout({}, member)).rejects.toMatchObject({ status: 404 })
    await expect(checkout({ meta: { branchId: 'wrong-branch' } }, cashier)).rejects.toMatchObject({ status: 422, message: 'POS_BRANCH_NOT_CONFIGURED' })
    await expect(checkout({ meta: { warehouseLocationId: 'wrong-location' } }, cashier)).rejects.toMatchObject({ status: 422, message: 'WAREHOUSE_LOCATION_NOT_FOUND' })
    const invisible = makeViewer({ visibleBusinessIds: [otherBusiness.id], ownedBusinessIds: [otherBusiness.id], visibleDomains: DOMAINS })
    await expect(checkout({}, invisible)).rejects.toMatchObject({ status: 404 })
  })

  it('keeps the existing payment verifier boundary and rolls back shortage or duplicate-reference failures', async () => {
    const beforeOrders = await prisma.salesOrder.count({ where: { businessId: business.id } })
    const beforePayments = await prisma.payment.count({ where: { businessId: business.id } })
    const beforeMovements = await prisma.stockMovement.count({ where: { businessId: business.id } })
    await expect(checkout({ line: { qty: Number.MAX_SAFE_INTEGER }, payment: { receivedAmount: 1000000000000 } })).rejects.toMatchObject({ status: 422, message: 'POS_AMOUNT_INVALID' })
    await expect(checkout({ payment: { receivedAmount: 20.001 } })).rejects.toThrow()
    expect(await prisma.salesOrder.count({ where: { businessId: business.id } })).toBe(beforeOrders)
    expect(await prisma.payment.count({ where: { businessId: business.id } })).toBe(beforePayments)
    expect(await prisma.stockMovement.count({ where: { businessId: business.id } })).toBe(beforeMovements)
    await expect(checkout({ line: { qty: 100 }, payment: { bankReference: 'POS-DUP-1', receivedAmount: 1000 } })).rejects.toMatchObject({ status: 409 })
    expect(await prisma.salesOrder.count({ where: { businessId: business.id } })).toBe(beforeOrders)
    expect(await prisma.payment.count({ where: { businessId: business.id } })).toBe(beforePayments)
    expect(await prisma.stockMovement.count({ where: { businessId: business.id } })).toBe(beforeMovements)
    const first = await checkout({ payment: { bankReference: 'POS-DUP-1' } })
    await expect(applyPaymentAction(first.paymentId, { action: 'VERIFY', version: 1 }, { viewer: cashier, now: NOW })).rejects.toMatchObject({ status: 404 })
    await expect(checkout({ payment: { bankReference: 'POS-DUP-1' } })).rejects.toMatchObject({ status: 409, message: 'PAYMENT_REFERENCE_TAKEN' })
    const sameRefRows = await prisma.payment.findMany({ where: { bankReference: 'POS-DUP-1' } })
    expect(sameRefRows).toHaveLength(1)
  })

  it('requires configured PromptPay for QR while preserving PENDING status', async () => {
    await updateBillingProfile(business.id, { promptPayProvider: 'PROMPTPAY', promptPayTargetType: 'MOBILE', promptPayTarget: '0812345678', promptPayActive: true, promptPayVerifiedAt: '2026-01-02T00:00:00Z' }, { viewer: owner })
    const result = await checkout({ payment: { method: 'QR', receivedAmount: 20 } })
    expect(result).toMatchObject({ paymentStatus: 'PENDING', paymentMethod: 'QR', promptPay: { provider: 'PROMPTPAY', amountSatang: 2000 } })
    await expect(checkout({ payment: { method: 'QR', receivedAmount: 20 }, line: { qty: 1 } }, member)).rejects.toMatchObject({ status: 404 })
  })
})
