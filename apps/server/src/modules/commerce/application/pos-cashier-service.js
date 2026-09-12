import prisma from '@/lib/db'
import { seesBusiness } from '@/modules/identity/viewer-authority'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { appendMovement, mayManage as mayManageInventory } from '@/modules/inventory'
import { INVENTORY_DOMAIN_KEY } from '@/modules/inventory/domain/inventory'
import { assertDomainVisible } from '@/modules/identity/viewer-domains'
import {
  SALES_ORDER_ENTITY,
  PAYMENT_ENTITY,
  dayKey,
  fromSatang,
  orderCode,
  orderTotals,
  paymentCode,
  toSatang,
} from '../domain/commerce'
import { assertNonNegativeInt32, promptPayPayloadForProfile, zPosCheckout } from '../domain/billing'
import { loadBusiness, notFound } from './commerce-authority'
import { ORDER_SELECT, orderDto } from './sales-order-service'

// @req FR-183 — the POS adapter creates a WALK_IN SalesOrder, records one
// PENDING Payment and issues counted stock through Inventory's exported
// appendMovement, all in one transaction. Cash change is integer-satang exact;
// payment verification remains the existing FR-163 action.
// @spec ADR-065; BR-001; BR-002; SEC-001
// @tested tests/integration/fr183-pos.test.js

const failure = (status, message) => Object.assign(new Error(message), { status })
const actor = (viewer) => viewer?.principal?.id ?? null

const PRODUCT_SELECT = { id: true, code: true, name: true, businessId: true, status: true, stockPolicy: true, trackingMode: true, unit: true }
const PROFILE_SELECT = { active: true, promptPayProvider: true, promptPayTargetType: true, promptPayTarget: true, promptPayActive: true, promptPayVerifiedAt: true }

function safeSatang(value) {
  const satang = toSatang(value)
  try { return assertNonNegativeInt32(satang) } catch { throw failure(422, 'POS_AMOUNT_INVALID') }
}

async function nextOrderCode(tx, business, now) {
  const prefix = `ORD-${dayKey(now).replace(/-/g, '')}-`
  const count = await tx.salesOrder.count({ where: { tenantId: business.tenantId, code: { startsWith: prefix } } })
  for (let sequence = count + 1; sequence < count + 50; sequence += 1) {
    const code = orderCode(now, sequence)
    const existing = await tx.salesOrder.findUnique({ where: { tenantId_code: { tenantId: business.tenantId, code } }, select: { id: true } })
    if (!existing) return code
  }
  throw failure(409, 'SALES_ORDER_CODE_EXHAUSTED')
}

async function nextPaymentCode(tx, business, now) {
  const prefix = `PAY-${dayKey(now).replace(/-/g, '')}-`
  const count = await tx.payment.count({ where: { tenantId: business.tenantId, code: { startsWith: prefix } } })
  for (let sequence = count + 1; sequence < count + 50; sequence += 1) {
    const code = paymentCode(now, sequence)
    const existing = await tx.payment.findUnique({ where: { tenantId_code: { tenantId: business.tenantId, code } }, select: { id: true } })
    if (!existing) return code
  }
  throw failure(409, 'PAYMENT_CODE_EXHAUSTED')
}

async function resolveCustomer(tx, business, viewer, customerId) {
  if (!customerId) return null
  const customer = await tx.customer.findUnique({ where: { id: customerId }, select: { id: true, tenantId: true, businessId: true, deletedAt: true } })
  if (!customer || customer.tenantId !== business.tenantId || customer.deletedAt || (customer.businessId && customer.businessId !== business.id) || (customer.businessId && !seesBusiness(viewer, customer.businessId))) throw failure(422, 'CUSTOMER_NOT_FOUND')
  return customer
}

async function resolveLines(tx, business, lines) {
  const resolved = []
  for (const [index, line] of lines.entries()) {
    const product = line.productId ? await tx.product.findUnique({ where: { id: line.productId }, select: PRODUCT_SELECT }) : null
    if (line.productId && (!product || product.businessId !== business.id)) throw failure(422, 'PRODUCT_NOT_FOUND')
    if (product?.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')
    if (product?.stockPolicy === 'TRACKED' && product.trackingMode === 'SERIAL') throw failure(422, 'POS_SERIAL_LINE_UNSUPPORTED')
    const unitPriceSatang = safeSatang(line.unitPrice)
    const discountSatang = safeSatang(line.discount ?? 0)
    const lineAmountSatang = line.qty * unitPriceSatang
    try { assertNonNegativeInt32(lineAmountSatang, 'POS line amount exceeds the persisted integer range') } catch { throw failure(422, 'POS_AMOUNT_INVALID') }
    if (discountSatang > lineAmountSatang) throw failure(422, 'POS_LINE_DISCOUNT_INVALID')
    resolved.push({
      productId: product?.id ?? null,
      description: line.description ?? product?.name ?? product?.code ?? null,
      qty: line.qty,
      unitPriceSatang,
      discountSatang,
      sortOrder: index,
      product,
    })
  }
  return resolved
}

function paymentInput(payment, totalSatang) {
  const receivedSatang = safeSatang(payment.receivedAmount ?? payment.amount ?? fromSatang(totalSatang))
  if (payment.method === 'CASH') {
    if (receivedSatang < totalSatang) throw failure(422, 'POS_CASH_INSUFFICIENT')
  } else if (receivedSatang !== totalSatang) {
    throw failure(422, 'POS_PAYMENT_AMOUNT_MISMATCH')
  }
  return { receivedSatang, changeSatang: payment.method === 'CASH' ? receivedSatang - totalSatang : 0 }
}

async function resolveLocation(tx, business, branchId, warehouseLocationId) {
  const branch = await tx.branch.findUnique({ where: { id: branchId }, select: { id: true, code: true, name: true, tenantId: true, businessId: true, status: true } })
  if (!branch || branch.tenantId !== business.tenantId || branch.businessId !== business.id || branch.status !== 'ACTIVE') throw failure(422, 'POS_BRANCH_NOT_CONFIGURED')
  const location = await tx.warehouseLocation.findUnique({ where: { id: warehouseLocationId }, select: { id: true, code: true, name: true, tenantId: true, businessId: true, status: true, isVirtual: true } })
  if (!location || location.tenantId !== business.tenantId || location.businessId !== business.id || location.status !== 'ACTIVE' || location.isVirtual) throw failure(422, 'WAREHOUSE_LOCATION_NOT_FOUND')
  return { branch, location }
}

async function profileForQr(tx, business, method) {
  if (method !== 'QR') return null
  const profile = await tx.businessBillingProfile.findUnique({ where: { businessId: business.id }, select: PROFILE_SELECT })
  if (!profile) throw failure(422, 'PROMPTPAY_NOT_CONFIGURED')
  return profile
}

/** Atomic POS sale: order + pending payment + stock issues, or no rows. */
export async function checkoutPosSale(businessId, input, { viewer, db = prisma, now = new Date() } = {}) {
  const requestedBusinessId = input?.businessId ?? businessId
  if (requestedBusinessId !== businessId) throw failure(422, 'POS_BUSINESS_MISMATCH')
  let data
  try {
    data = zPosCheckout.parse({ ...input, businessId })
  } catch (error) {
    if (error?.issues?.some((issue) => issue.path?.[0] === 'lines' && issue.path?.[2] === 'qty' && issue.code === 'too_big')) throw failure(422, 'POS_AMOUNT_INVALID')
    throw error
  }
  return db.$transaction(async (tx) => {
    const business = await loadBusiness(tx, viewer, data.businessId, { capability: 'order' })
    if (!mayManageInventory(viewer, business.id)) throw failure(403, 'POS_STOCK_ISSUE_REQUIRES_INVENTORY_AUTHORITY')
    const { branch, location } = await resolveLocation(tx, business, data.branchId, data.warehouseLocationId)
    const customer = await resolveCustomer(tx, business, viewer, data.customerId ?? null)
    const lines = await resolveLines(tx, business, data.lines)
    const totals = orderTotals(lines, 0)
    try {
      for (const amount of [totals.subtotal, totals.lineDiscount, totals.orderDiscount, totals.total]) assertNonNegativeInt32(amount)
    } catch { throw failure(422, 'POS_AMOUNT_INVALID') }
    const payment = paymentInput(data.payment, totals.total)
    const profile = await profileForQr(tx, business, data.payment.method)
    const promptPay = profile ? promptPayPayloadForProfile(profile, totals.total) : null
    const orderCodeValue = await nextOrderCode(tx, business, now)
    const order = await tx.salesOrder.create({
      data: {
        code: orderCodeValue,
        tenantId: business.tenantId,
        businessId: business.id,
        customerId: customer?.id ?? null,
        origin: 'WALK_IN',
        status: 'COMPLETED',
        currency: 'THB',
        discountSatang: totals.orderDiscount,
        notes: data.terminalLabel ?? null,
        orderedAt: now,
        confirmedAt: now,
        completedAt: now,
        closedByPersonId: actor(viewer),
        createdByPersonId: actor(viewer),
        lines: { create: lines.map(({ product, ...line }) => line) },
      },
      select: { id: true, code: true, status: true, businessId: true, tenantId: true },
    })
    await recordAudit(tx, { entityType: SALES_ORDER_ENTITY, entityId: order.id, action: 'SALES_ORDER_CREATED', actorId: actor(viewer), payload: { businessId: business.id, code: order.code, origin: 'WALK_IN', lines: lines.length, total: fromSatang(totals.total), pos: true } })
    const stockDeductions = []
    for (const line of lines) {
      if (!line.product || line.product.stockPolicy !== 'TRACKED') continue
      const movement = await appendMovement(tx, {
        businessId: business.id,
        productId: line.product.id,
        kind: 'ISSUE',
        quantity: line.qty,
        reason: 'POS_SALE',
        reference: `POS:${order.code}`,
        occurredAt: now,
        sourceLocationId: location.id,
        salesOrderId: order.id,
        customerId: customer?.id ?? null,
      }, { viewer })
      stockDeductions.push({ productId: line.product.id, code: line.product.code, quantity: line.qty, movementIds: movement.movements.map((row) => row.id), onHandAfter: movement.onHandAfter })
    }
    if (stockDeductions.length) await tx.salesOrder.update({ where: { id: order.id }, data: { stockIssuedAt: now } })
    const bankReference = data.payment.bankReference ?? null
    if (bankReference) {
      const taken = await tx.payment.findFirst({ where: { tenantId: business.tenantId, bankReference }, select: { id: true } })
      if (taken) throw failure(409, 'PAYMENT_REFERENCE_TAKEN')
    }
    if (data.payment.slipFileAssetId) {
      const slip = await tx.fileAsset.findUnique({ where: { id: data.payment.slipFileAssetId }, select: { businessId: true, deletedAt: true } })
      if (!slip || slip.businessId !== business.id || slip.deletedAt) throw failure(422, 'PAYMENT_SLIP_NOT_FOUND')
    }
    const paymentCodeValue = await nextPaymentCode(tx, business, now)
    const paymentRow = await tx.payment.create({
      data: {
        code: paymentCodeValue,
        tenantId: business.tenantId,
        businessId: business.id,
        orderId: order.id,
        kind: 'PAYMENT',
        method: data.payment.method,
        amountSatang: totals.total,
        status: 'PENDING',
        bankReference,
        slipFileAssetId: data.payment.slipFileAssetId ?? null,
        note: data.payment.note ?? null,
        paidAt: now,
        createdByPersonId: actor(viewer),
      },
      select: { id: true, code: true, amountSatang: true, status: true, method: true, orderId: true, bankReference: true, slipFileAssetId: true, createdByPersonId: true, version: true, paidAt: true },
    })
    await recordAudit(tx, { entityType: PAYMENT_ENTITY, entityId: paymentRow.id, action: 'PAYMENT_RECORDED', actorId: actor(viewer), payload: { businessId: business.id, code: paymentRow.code, orderCode: order.code, method: paymentRow.method, amount: fromSatang(paymentRow.amountSatang), status: paymentRow.status, pos: true } })
    await recordAudit(tx, { entityType: SALES_ORDER_ENTITY, entityId: order.id, action: 'SALES_ORDER_COMPLETED', actorId: actor(viewer), payload: { businessId: business.id, code: order.code, branchId: branch.id, warehouseLocationId: location.id, stockDeductions: stockDeductions.length, paymentId: paymentRow.id, paymentStatus: 'PENDING', pos: true } })
    const fullOrder = await tx.salesOrder.findUnique({ where: { id: order.id }, select: ORDER_SELECT })
    return {
      success: true,
      status: 'PENDING',
      orderId: order.id,
      orderCode: order.code,
      paymentId: paymentRow.id,
      paymentCode: paymentRow.code,
      paymentStatus: paymentRow.status,
      payment: { ...paymentRow, amount: fromSatang(paymentRow.amountSatang), amountSatang: undefined },
      branch: { id: branch.id, code: branch.code, name: branch.name },
      warehouseLocation: { id: location.id, code: location.code, name: location.name },
      totalSatang: totals.total,
      totalAmount: fromSatang(totals.total),
      receivedAmountSatang: payment.receivedSatang,
      receivedAmount: fromSatang(payment.receivedSatang),
      changeAmountSatang: payment.changeSatang,
      changeAmount: fromSatang(payment.changeSatang),
      paymentMethod: data.payment.method,
      promptPay,
      stockDeductions,
      order: orderDto(fullOrder),
      completedAt: now,
    }
  })
}

/** POS catalogue is identity plus recomputed on-hand; every sale price is manual. */
export async function getPosTerminalCatalogue(businessId, { viewer, db = prisma } = {}) {
  const business = await loadBusiness(db, viewer, businessId)
  try { assertDomainVisible(viewer, business.id, INVENTORY_DOMAIN_KEY) } catch { throw notFound() }
  const [products, movements, categories, branches, locations] = await Promise.all([
    db.product.findMany({ where: { businessId: business.id, status: 'ACTIVE' }, orderBy: [{ code: 'asc' }], select: { id: true, code: true, name: true, unit: true, stockPolicy: true, trackingMode: true, productMaster: { select: { categoryId: true, nameTh: true } } } }),
    db.stockMovement.groupBy({ by: ['productId'], where: { businessId: business.id }, _sum: { quantity: true } }),
    db.inventoryCategory.findMany({ where: { businessId: business.id, status: 'ACTIVE' }, orderBy: [{ code: 'asc' }], select: { id: true, code: true, nameTh: true, nameEn: true } }),
    // @req FR-194 — POS reads Branch as an operating site; `taxBranchCode` is
    // gone (a VAT branch code is now the LegalEntity's own TaxRegistrationBranch,
    // resolved by billing at document-issue time, never needed here).
    db.branch.findMany({ where: { businessId: business.id, status: 'ACTIVE' }, orderBy: [{ code: 'asc' }], select: { id: true, code: true, name: true, address: true, kind: true, status: true } }),
    db.warehouseLocation.findMany({ where: { businessId: business.id, status: 'ACTIVE', isVirtual: false }, orderBy: [{ code: 'asc' }], select: { id: true, code: true, name: true, type: true, isVirtual: true, status: true } }),
  ])
  const onHand = new Map(movements.map((row) => [row.productId, row._sum.quantity ?? 0]))
  const categoryMap = new Map(categories.map((category) => [category.id, category]))
  return {
    businessId: business.id,
    branches,
    warehouseLocations: locations,
    categories,
    items: products.map((product) => {
      const category = product.productMaster?.categoryId ? categoryMap.get(product.productMaster.categoryId) : null
      const tracked = product.stockPolicy === 'TRACKED'
      return {
        productId: product.id,
        code: product.code,
        name: product.name ?? product.productMaster?.nameTh ?? product.code,
        unit: product.unit,
        stockPolicy: product.stockPolicy,
        trackingMode: product.trackingMode,
        onHand: tracked ? (onHand.get(product.id) ?? 0) : null,
        isAvailable: tracked ? (onHand.get(product.id) ?? 0) > 0 : true,
        categoryId: category?.id ?? null,
        categoryName: category?.nameTh ?? null,
        unitPrice: null,
      }
    }),
  }
}
