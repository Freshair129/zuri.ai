import { PAYMENT_ENTITY, fromSatang, nextPaymentStatus, paymentSummary, toSatang, zPaymentActionInput, zRecordPayment } from '../../../kernel/commerce/commerce.js'
import { commerceAuthority, denied } from '../../../infrastructure/delegation.js'
import { enqueueOutbox, recordAudit } from '../../../infrastructure/evidence.js'
import * as repo from '../adapters/commerce-repo.js'
import { nextCommerceCode } from './codes.js'
import { orderDto } from './orders.js'

// Payments (FR-163, FR-196) inside SCM — port of apps/server payment-service with
// the same codes, the same order of refusals and the same audit actions:
//   record  — PENDING only; bank reference unique per Tenant; slip must be a
//             FileAsset of the same Business (fact from Files, via ReferenceAuthority);
//             no PAYMENT on a CANCELLED order (a REFUND is allowed).
//   verify  — needs the verifier capability; FR-196: the recorder may not verify
//             their own payment, an OWNER included, unless `selfVerifyAttested`
//             (audited as selfVerified); a REFUND may not exceed the verified net.
//   reject  — PENDING → REJECTED with a reason; rejected money never counts.
// Every change is a compare-and-swap on (id, version). Only VERIFIED money moves
// the order's paid / balance / payment state, which are recomputed on read.

const failure = (status, code) => Object.assign(new Error(code), { status, code, retryable: false })
const toDto = ({ amountSatang, ...row }) => ({ ...row, amount: fromSatang(amountSatang) })

function loadPaymentInScope(sql, scope, id, capability) {
  const paymentId = typeof id === 'string' ? id.trim() : ''
  const row = paymentId ? repo.paymentById(sql, paymentId) : null
  if (!row || row.tenantId !== scope.tenantId) throw denied()
  commerceAuthority.require(scope, row.businessId, capability)
  return row
}

export function loadOrderForPayment(sql, scope, orderId) {
  const id = typeof orderId === 'string' ? orderId.trim() : ''
  const order = id ? repo.orderHeader(sql, id) : null
  if (!order || order.tenantId !== scope.tenantId) throw denied()
  commerceAuthority.require(scope, order.businessId, 'order')
  return order
}

/** Outside the unit of work: authorize, then read the slip fact from Files (if any). */
export async function prepareRecordPayment(scope, { orderId, body }, { references, readOrder }) {
  const data = zRecordPayment.parse(body)
  const order = await readOrder(orderId)
  const slip = data.slipFileAssetId ? await references.fileAsset(scope, { businessId: order.businessId, fileAssetId: data.slipFileAssetId }) : null
  return { data, facts: { slip, verifiedAt: new Date().toISOString(), authority: references.kind } }
}

export function recordPayment(sql, scope, orderId, prepared, { now, requestId }) {
  const { data, facts } = prepared
  const order = loadOrderForPayment(sql, scope, orderId)
  const business = { id: order.businessId, tenantId: order.tenantId }
  const kind = data.kind ?? 'PAYMENT'
  if (kind === 'PAYMENT' && order.status === 'CANCELLED') throw failure(409, 'SALES_ORDER_CANCELLED')
  if (data.bankReference && repo.paymentByBankReference(sql, business.tenantId, data.bankReference)) throw failure(409, 'PAYMENT_REFERENCE_TAKEN')
  if (data.slipFileAssetId) {
    const slip = facts.slip
    if (!slip || slip.businessId !== business.id || slip.deletedAt) throw failure(422, 'PAYMENT_SLIP_NOT_FOUND')
  }
  const created = repo.insertPayment(sql, {
    code: nextCommerceCode(sql, 'Payment', business, now), tenantId: business.tenantId, businessId: business.id, orderId: order.id, kind,
    method: data.method, amountSatang: toSatang(data.amount), status: 'PENDING', bankReference: data.bankReference ?? null,
    slipFileAssetId: data.slipFileAssetId ?? null, note: data.note ?? null, paidAt: data.paidAt ? data.paidAt.toISOString() : now, createdByPersonId: scope.actorId, now,
  })
  recordAudit(sql, { entityType: PAYMENT_ENTITY, entityId: created.id, action: 'PAYMENT_RECORDED', actorId: scope.actorId, tenantId: business.tenantId, businessId: business.id, requestId, now, payload: { businessId: business.id, code: created.code, orderCode: order.code, kind, method: created.method, amount: fromSatang(created.amountSatang), bankReference: created.bankReference, slipFileAssetId: created.slipFileAssetId } })
  enqueueOutbox(sql, { topic: 'scm.commerce.payment.recorded', aggregateType: PAYMENT_ENTITY, aggregateId: created.id, aggregateVersion: 1, now, payload: { businessId: business.id, code: created.code, orderId: order.id, kind, status: 'PENDING' } })
  const payment = toDto(repo.paymentById(sql, created.id))
  return { response: { payment, references: { verifiedAt: facts.verifiedAt, authority: facts.authority } }, affected: { paymentId: payment.id, paymentCode: payment.code, paymentVersion: payment.version, status: 'PENDING' } }
}

const ACTIONS = Object.freeze({ VERIFY: 'PAYMENT_VERIFIED', REJECT: 'PAYMENT_REJECTED' })

export function applyPaymentAction(sql, scope, paymentId, input, { now, requestId, faults = {} }) {
  const data = zPaymentActionInput.parse(input)
  const row = loadPaymentInScope(sql, scope, paymentId, 'verify')
  if (row.version !== data.version) throw failure(409, 'PAYMENT_VERSION_CONFLICT')
  const status = nextPaymentStatus(row.status, data.action)
  if (!status) throw failure(409, 'PAYMENT_STATUS_INVALID')
  const change = { status }
  let selfVerified
  if (data.action === 'VERIFY') {
    selfVerified = Boolean(row.createdByPersonId) && row.createdByPersonId === scope.actorId
    // FR-196: two people, not a permission — no owner bypass here, on purpose.
    if (selfVerified && !data.selfVerifyAttested) throw failure(409, 'PAYMENT_SELF_VERIFY_FORBIDDEN')
    if (row.kind === 'REFUND') {
      repo.lockOrderRow(sql, row.orderId)
      if (paymentSummary(repo.verifiedPaymentsOfOrder(sql, row.orderId)).net < row.amountSatang) throw failure(409, 'PAYMENT_REFUND_EXCEEDS_PAID')
    }
    change.verifiedAt = now
    change.verifiedByPersonId = scope.actorId
  } else {
    change.rejectReason = data.reason ?? null
  }
  faults.beforePaymentUpdate?.()
  if (repo.casUpdatePayment(sql, { id: row.id, version: row.version, change, now }) !== 1) throw Object.assign(failure(409, 'PAYMENT_VERSION_CONFLICT'), { retryable: false })
  recordAudit(sql, { entityType: PAYMENT_ENTITY, entityId: row.id, action: ACTIONS[data.action], actorId: scope.actorId, tenantId: row.tenantId, businessId: row.businessId, requestId, now, payload: { businessId: row.businessId, code: row.code, kind: row.kind, amount: fromSatang(row.amountSatang), from: { status: row.status }, to: { status }, reason: change.rejectReason ?? undefined, version: row.version + 1, ...(data.action === 'VERIFY' ? { selfVerified } : {}) } })
  faults.afterAudit?.()
  enqueueOutbox(sql, { topic: `scm.commerce.payment.${data.action.toLowerCase()}`, aggregateType: PAYMENT_ENTITY, aggregateId: row.id, aggregateVersion: row.version + 1, now, payload: { businessId: row.businessId, code: row.code, orderId: row.orderId, kind: row.kind, status } })
  const payment = toDto(repo.paymentById(sql, row.id))
  const order = orderDto(repo.loadOrder(sql, row.orderId))
  return { response: { payment, order }, affected: { paymentId: row.id, paymentVersion: payment.version, status, orderId: row.orderId, orderPaymentState: order.paymentState } }
}

export function getPayment(sql, scope, id) {
  return toDto(loadPaymentInScope(sql, scope, id, 'read'))
}

export function listPayments(sql, scope, orderId) {
  const id = typeof orderId === 'string' ? orderId.trim() : ''
  const order = id ? repo.orderHeader(sql, id) : null
  if (!order || order.tenantId !== scope.tenantId) throw denied()
  commerceAuthority.require(scope, order.businessId)
  const rows = repo.paymentsOfOrder(sql, order.id)
  const summary = paymentSummary(rows)
  return { orderId: order.id, payments: rows.map(toDto), summary: { paid: fromSatang(summary.paid), refunded: fromSatang(summary.refunded), net: fromSatang(summary.net), pending: fromSatang(summary.pending) } }
}
