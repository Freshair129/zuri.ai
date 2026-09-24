import { PAYMENT_ENTITY, SALES_ORDER_ENTITY, dayKey, fromSatang, orderCode, orderTotals, paymentCode, toSatang } from '../kernel/commerce/commerce.js'
import { assertNonNegativeInt32, promptPayPayloadForProfile, zPosCheckout } from '../kernel/commerce/billing.js'
import { commerceAuthority } from '../infrastructure/delegation.js'
import { enqueueOutbox, recordAudit } from '../infrastructure/evidence.js'
import * as inventory from '../modules/inventory/index.js'
import * as commerceRepo from '../modules/commerce/adapters/commerce-repo.js'
import { orderDto } from '../modules/commerce/application/orders.js'

// POS checkout (FR-183) as ONE SCM unit of work — port of apps/server
// pos-cashier-service.checkoutPosSale. The whole group commits or nothing does:
// WALK_IN SalesOrder (COMPLETED) + lines, one PENDING Payment, an ISSUE movement
// per counted line through Inventory's public writer (FEFO, dedication, shelf
// life, no negative stock), audit rows, outbox, and the operation receipt.
//
// Invariants kept exactly: the payment is PENDING — checkout, a QR payload or
// typed cash never makes it VERIFIED (verification stays the FR-163 action);
// every sale price is MANUAL (no pricing engine call); cash change is exact
// integer satang; amounts must fit the persisted int32; a bank reference is
// unique per Tenant; serial lines are refused as before.
//
// Foreign references (Branch — core; Customer — CRM; payment slip — Files) are
// FACTS fetched before the unit of work by `prepareCheckout` and judged here, in
// the legacy order, so refusal codes and their precedence do not change.

const failure = (status, code, details) => Object.assign(new Error(code), { status, code, retryable: false, ...(details ? { details } : {}) })

function safeSatang(value) {
  const satang = toSatang(value)
  try { return assertNonNegativeInt32(satang) } catch { throw failure(422, 'POS_AMOUNT_INVALID') }
}

export function parseCheckout(input) {
  try {
    return zPosCheckout.parse(input)
  } catch (error) {
    if (error?.issues?.some((issue) => issue.path?.[0] === 'lines' && issue.path?.[2] === 'qty' && issue.code === 'too_big')) throw failure(422, 'POS_AMOUNT_INVALID')
    throw error
  }
}

/** Outside the unit of work: authorize first (no reference lookup for an unauthorized caller), then read facts. */
export async function prepareCheckout(scope, body, { references }) {
  const data = parseCheckout(body)
  const business = commerceAuthority.require(scope, data.businessId, 'order')
  if (!inventory.inventoryAuthority.mayManage(scope, business.id)) throw failure(403, 'POS_STOCK_ISSUE_REQUIRES_INVENTORY_AUTHORITY')
  const [branch, customer, slip] = await Promise.all([
    references.branch(scope, { businessId: business.id, branchId: data.branchId }),
    data.customerId ? references.customer(scope, { businessId: business.id, customerId: data.customerId }) : null,
    data.payment.slipFileAssetId ? references.fileAsset(scope, { businessId: business.id, fileAssetId: data.payment.slipFileAssetId }) : null,
  ])
  return { data, facts: { branch, customer, slip, verifiedAt: new Date().toISOString(), authority: references.kind } }
}

function nextCode(sql, kind, business, now, codeFor, exhausted) {
  const prefix = `${kind === 'Payment' ? 'PAY' : 'ORD'}-${dayKey(now).replace(/-/g, '')}-`
  const count = commerceRepo.countCodesWithPrefix(sql, kind, business.tenantId, prefix)
  for (let seq = count + 1; seq < count + 50; seq += 1) {
    const code = codeFor(now, seq)
    if (!commerceRepo.codeTaken(sql, kind, business.tenantId, code)) return code
  }
  throw failure(409, exhausted)
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

export function checkoutPosSale(sql, scope, prepared, { now, requestId, faults = {} }) {
  const { data, facts } = prepared
  const business = commerceAuthority.require(scope, data.businessId, 'order')
  if (!inventory.inventoryAuthority.mayManage(scope, business.id)) throw failure(403, 'POS_STOCK_ISSUE_REQUIRES_INVENTORY_AUTHORITY')
  const branch = facts.branch
  if (!branch || branch.tenantId !== business.tenantId || branch.businessId !== business.id || branch.status !== 'ACTIVE') throw failure(422, 'POS_BRANCH_NOT_CONFIGURED')
  const location = inventory.requireIssuableLocation(sql, business, data.warehouseLocationId)
  const customer = data.customerId ? facts.customer : null
  if (data.customerId && (!customer || customer.tenantId !== business.tenantId || customer.deletedAt || (customer.businessId && customer.businessId !== business.id))) throw failure(422, 'CUSTOMER_NOT_FOUND')

  const products = new Map(inventory.productsByIds(sql, [...new Set(data.lines.map((l) => l.productId).filter(Boolean))]).map((p) => [p.id, p]))
  const lines = data.lines.map((line, index) => {
    const product = line.productId ? products.get(line.productId) ?? null : null
    if (line.productId && (!product || product.businessId !== business.id || product.tenantId !== business.tenantId)) throw failure(422, 'PRODUCT_NOT_FOUND')
    if (product?.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')
    if (product?.stockPolicy === 'TRACKED' && product.trackingMode === 'SERIAL') throw failure(422, 'POS_SERIAL_LINE_UNSUPPORTED')
    const unitPriceSatang = safeSatang(line.unitPrice)
    const discountSatang = safeSatang(line.discount ?? 0)
    const lineAmountSatang = line.qty * unitPriceSatang
    try { assertNonNegativeInt32(lineAmountSatang) } catch { throw failure(422, 'POS_AMOUNT_INVALID') }
    if (discountSatang > lineAmountSatang) throw failure(422, 'POS_LINE_DISCOUNT_INVALID')
    return { productId: product?.id ?? null, description: line.description ?? product?.name ?? product?.code ?? null, qty: line.qty, unitPriceSatang, discountSatang, sortOrder: index, product }
  })
  const totals = orderTotals(lines, 0)
  try { for (const amount of [totals.subtotal, totals.lineDiscount, totals.orderDiscount, totals.total]) assertNonNegativeInt32(amount) } catch { throw failure(422, 'POS_AMOUNT_INVALID') }
  const payment = paymentInput(data.payment, totals.total)
  let promptPay = null
  if (data.payment.method === 'QR') {
    const profile = commerceRepo.billingProfileOf(sql, business.id)
    if (!profile) throw failure(422, 'PROMPTPAY_NOT_CONFIGURED')
    try { promptPay = promptPayPayloadForProfile(profile, totals.total) } catch (error) { throw failure(error.status ?? 422, error.message) }
  }

  const nowDate = new Date(now)
  const code = nextCode(sql, 'SalesOrder', business, nowDate, orderCode, 'SALES_ORDER_CODE_EXHAUSTED')
  const orderId = commerceRepo.insertOrder(sql, {
    code, tenantId: business.tenantId, businessId: business.id, customerId: customer?.id ?? null, origin: 'WALK_IN', status: 'COMPLETED', currency: 'THB',
    discountSatang: totals.orderDiscount, notes: data.terminalLabel ?? null, orderedAt: now, confirmedAt: now, completedAt: now,
    closedByPersonId: scope.actorId, createdByPersonId: scope.actorId, now,
  }, lines.map(({ product, ...line }) => line))
  recordAudit(sql, { entityType: SALES_ORDER_ENTITY, entityId: orderId, action: 'SALES_ORDER_CREATED', actorId: scope.actorId, tenantId: business.tenantId, businessId: business.id, requestId, now, payload: { businessId: business.id, code, origin: 'WALK_IN', lines: lines.length, total: fromSatang(totals.total), pos: true } })
  faults.afterOrderInsert?.()

  const stockDeductions = []
  for (const line of lines) {
    if (!line.product || line.product.stockPolicy !== 'TRACKED') continue
    const movement = inventory.appendMovement(sql, scope, {
      businessId: business.id, productId: line.product.id, kind: 'ISSUE', quantity: line.qty, reason: 'POS_SALE', reference: `POS:${code}`,
      occurredAt: now, sourceLocationId: location.id, salesOrderId: orderId, customerId: customer?.id ?? null, requestId,
    }, { now })
    stockDeductions.push({ productId: line.product.id, code: line.product.code, quantity: line.qty, movementIds: movement.movements.map((row) => row.id), onHandAfter: movement.onHandAfter })
    faults.afterStockIssue?.()
  }
  if (stockDeductions.length) commerceRepo.markStockIssued(sql, orderId, now)
  const bankReference = data.payment.bankReference ?? null
  if (bankReference && commerceRepo.paymentByBankReference(sql, business.tenantId, bankReference)) throw failure(409, 'PAYMENT_REFERENCE_TAKEN')
  if (data.payment.slipFileAssetId) {
    const slip = facts.slip
    if (!slip || slip.businessId !== business.id || slip.deletedAt) throw failure(422, 'PAYMENT_SLIP_NOT_FOUND')
  }
  faults.beforePayment?.()
  const paymentRow = commerceRepo.insertPayment(sql, {
    code: nextCode(sql, 'Payment', business, nowDate, paymentCode, 'PAYMENT_CODE_EXHAUSTED'), tenantId: business.tenantId, businessId: business.id, orderId,
    kind: 'PAYMENT', method: data.payment.method, amountSatang: totals.total, status: 'PENDING', bankReference,
    slipFileAssetId: data.payment.slipFileAssetId ?? null, note: data.payment.note ?? null, paidAt: now, createdByPersonId: scope.actorId, now,
  })
  recordAudit(sql, { entityType: PAYMENT_ENTITY, entityId: paymentRow.id, action: 'PAYMENT_RECORDED', actorId: scope.actorId, tenantId: business.tenantId, businessId: business.id, requestId, now, payload: { businessId: business.id, code: paymentRow.code, orderCode: code, method: paymentRow.method, amount: fromSatang(paymentRow.amountSatang), status: paymentRow.status, pos: true } })
  recordAudit(sql, { entityType: SALES_ORDER_ENTITY, entityId: orderId, action: 'SALES_ORDER_COMPLETED', actorId: scope.actorId, tenantId: business.tenantId, businessId: business.id, requestId, now, payload: { businessId: business.id, code, branchId: branch.id, warehouseLocationId: location.id, stockDeductions: stockDeductions.length, paymentId: paymentRow.id, paymentStatus: 'PENDING', pos: true } })
  faults.afterAudit?.()
  enqueueOutbox(sql, { topic: 'scm.commerce.pos.checked-out', aggregateType: SALES_ORDER_ENTITY, aggregateId: orderId, aggregateVersion: 1, now, payload: { businessId: business.id, code, paymentId: paymentRow.id, paymentStatus: 'PENDING', movementIds: stockDeductions.flatMap((d) => d.movementIds) } })

  const fullOrder = commerceRepo.loadOrder(sql, orderId)
  const { amountSatang, ...paymentFields } = paymentRow
  return {
    response: {
      success: true, status: 'PENDING', orderId, orderCode: code, paymentId: paymentRow.id, paymentCode: paymentRow.code, paymentStatus: paymentRow.status,
      payment: { ...paymentFields, amount: fromSatang(amountSatang) },
      branch: { id: branch.id, code: branch.code, name: branch.name },
      warehouseLocation: location,
      totalSatang: totals.total, totalAmount: fromSatang(totals.total),
      receivedAmountSatang: payment.receivedSatang, receivedAmount: fromSatang(payment.receivedSatang),
      changeAmountSatang: payment.changeSatang, changeAmount: fromSatang(payment.changeSatang),
      paymentMethod: data.payment.method, promptPay, stockDeductions,
      order: orderDto(fullOrder, customer), completedAt: now,
      references: { verifiedAt: facts.verifiedAt, authority: facts.authority },
    },
    affected: { salesOrderId: orderId, salesOrderCode: code, paymentId: paymentRow.id, paymentStatus: 'PENDING', stockMovementIds: stockDeductions.flatMap((d) => d.movementIds) },
  }
}
