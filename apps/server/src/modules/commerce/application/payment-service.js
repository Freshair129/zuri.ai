import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import {
  PAYMENT_ENTITY,
  dayKey,
  fromSatang,
  nextPaymentStatus,
  paymentCode,
  paymentSummary,
  toSatang,
  zPaymentActionInput,
  zRecordPayment,
} from '../domain/commerce'
import { loadBusiness, notFound } from './commerce-authority'
import { ORDER_SELECT, orderDto } from './sales-order-service'

// @req FR-163 — the only writer of Payment: a rep records a payment or a
//   refund against an order (PENDING, with the method, the amount, an optional
//   bank reference that is an attribute unique per Tenant — the legacy "prevents
//   duplicate" rule kept, the key refused (BR-002) — and an optional slip that
//   must be a FileAsset of the same Business); a verifier confirms it (VERIFIED)
//   or rejects it with a reason. Only VERIFIED money counts: the order's paid,
//   balance and payment state, and the revenue summary, are computed from it
//   on read. A refund may not be verified beyond what was verifiably paid. A
//   payment cannot be recorded on a CANCELLED order; a refund can. Every write
//   is one transaction with one audit row; nothing is deleted.
// @req FR-196 — a transaction rule, not a role rule: `applyPaymentAction`
//   refuses 409 PAYMENT_SELF_VERIFY_FORBIDDEN when the person verifying a
//   payment is the person who recorded it — INCLUDING the Business OWNER, who
//   bypasses every other capability check in this file. This is the one place
//   an OWNER does not bypass, deliberately: it is a rule about needing two
//   people, not about holding a permission (ADR-065 D4's revenue-integrity
//   reasoning, applied at the write instead of only at role assignment).
//   `selfVerifyAttested: true` is the auditable exemption for a genuinely
//   one-person Business — never a silent one, it lands in the audit payload as
//   `selfVerified: true`.
// @spec ADR-065; ADR-054 D4; BR-002; BR-035; SEC-001; SEC-027; FR-072; ADR-079
// @tested tests/integration/fr163-payment.test.js, tests/integration/fr196-segregation-of-duties.test.js

const failure = (status, message) => Object.assign(new Error(message), { status })
const actor = (viewer) => viewer?.principal?.id ?? null

const SELECT = { id: true, code: true, tenantId: true, businessId: true, orderId: true, kind: true, method: true, amountSatang: true, status: true, bankReference: true, slipFileAssetId: true, note: true, paidAt: true, verifiedAt: true, verifiedByPersonId: true, rejectReason: true, createdByPersonId: true, createdAt: true, updatedAt: true, version: true }

const toDto = (row) => ({ ...row, amount: fromSatang(row.amountSatang), amountSatang: undefined })

async function nextCode(tx, business, now) {
  const prefix = `PAY-${dayKey(now).replace(/-/g, '')}-`
  const count = await tx.payment.count({ where: { tenantId: business.tenantId, code: { startsWith: prefix } } })
  for (let seq = count + 1; seq < count + 50; seq += 1) {
    const code = paymentCode(now, seq)
    const taken = await tx.payment.findUnique({ where: { tenantId_code: { tenantId: business.tenantId, code } }, select: { id: true } })
    if (!taken) return code
  }
  throw failure(409, 'PAYMENT_CODE_EXHAUSTED')
}

export async function recordPayment(orderId, input, { viewer, db = prisma, now = new Date() } = {}) {
  const id = typeof orderId === 'string' ? orderId.trim() : ''
  if (!id) throw notFound()
  const data = zRecordPayment.parse(input)
  const row = await db.$transaction(async (tx) => {
    const order = await tx.salesOrder.findUnique({ where: { id }, select: { id: true, code: true, businessId: true, status: true } })
    if (!order) throw notFound()
    const business = await loadBusiness(tx, viewer, order.businessId, { capability: 'order' })
    const kind = data.kind ?? 'PAYMENT'
    if (kind === 'PAYMENT' && order.status === 'CANCELLED') throw failure(409, 'SALES_ORDER_CANCELLED')
    if (data.bankReference) {
      const taken = await tx.payment.findFirst({ where: { tenantId: business.tenantId, bankReference: data.bankReference }, select: { id: true } })
      if (taken) throw failure(409, 'PAYMENT_REFERENCE_TAKEN')
    }
    if (data.slipFileAssetId) {
      const slip = await tx.fileAsset.findUnique({ where: { id: data.slipFileAssetId }, select: { businessId: true, deletedAt: true } })
      if (!slip || slip.businessId !== business.id || slip.deletedAt) throw failure(422, 'PAYMENT_SLIP_NOT_FOUND')
    }
    const code = await nextCode(tx, business, now)
    const created = await tx.payment.create({
      data: {
        code, tenantId: business.tenantId, businessId: business.id, orderId: order.id, kind, method: data.method,
        amountSatang: toSatang(data.amount), bankReference: data.bankReference ?? null, slipFileAssetId: data.slipFileAssetId ?? null,
        note: data.note ?? null, paidAt: data.paidAt ?? now, createdByPersonId: actor(viewer),
      },
      select: SELECT,
    })
    await recordAudit(tx, { entityType: PAYMENT_ENTITY, entityId: created.id, action: 'PAYMENT_RECORDED', actorId: actor(viewer), payload: { businessId: business.id, code: created.code, orderCode: order.code, kind, method: created.method, amount: fromSatang(created.amountSatang), bankReference: created.bankReference, slipFileAssetId: created.slipFileAssetId } })
    return created
  })
  return toDto(row)
}

export async function listPayments(orderId, { viewer, db = prisma } = {}) {
  const id = typeof orderId === 'string' ? orderId.trim() : ''
  if (!id) throw notFound()
  const order = await db.salesOrder.findUnique({ where: { id }, select: { id: true, businessId: true } })
  if (!order) throw notFound()
  await loadBusiness(db, viewer, order.businessId)
  const rows = await db.payment.findMany({ where: { orderId: order.id }, orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }], select: SELECT })
  const summary = paymentSummary(rows)
  return { orderId: order.id, payments: rows.map(toDto), summary: { paid: fromSatang(summary.paid), refunded: fromSatang(summary.refunded), net: fromSatang(summary.net), pending: fromSatang(summary.pending) } }
}

export async function getPayment(id, { viewer, db = prisma } = {}) {
  const paymentId = typeof id === 'string' ? id.trim() : ''
  if (!paymentId) throw notFound()
  const row = await db.payment.findUnique({ where: { id: paymentId }, select: SELECT })
  if (!row) throw notFound()
  await loadBusiness(db, viewer, row.businessId)
  return toDto(row)
}

const ACTIONS = Object.freeze({ VERIFY: 'PAYMENT_VERIFIED', REJECT: 'PAYMENT_REJECTED' })

/** Verify or reject one PENDING payment; compare-and-swap on (id, version). Returns the payment and the order it changed. */
export async function applyPaymentAction(id, input, { viewer, db = prisma, now = new Date() } = {}) {
  const paymentId = typeof id === 'string' ? id.trim() : ''
  if (!paymentId) throw notFound()
  const data = zPaymentActionInput.parse(input)
  const result = await db.$transaction(async (tx) => {
    const row = await tx.payment.findUnique({ where: { id: paymentId }, select: SELECT })
    if (!row) throw notFound()
    const business = await loadBusiness(tx, viewer, row.businessId, { capability: 'verify' })
    if (row.version !== data.version) throw failure(409, 'PAYMENT_VERSION_CONFLICT')
    const status = nextPaymentStatus(row.status, data.action)
    if (!status) throw failure(409, 'PAYMENT_STATUS_INVALID')
    const change = { status }
    let selfVerified
    if (data.action === 'VERIFY') {
      const verifierId = actor(viewer)
      selfVerified = Boolean(row.createdByPersonId) && row.createdByPersonId === verifierId
      // @req FR-196 — needing two people, not a permission. No `ownsBusiness`
      // bypass here on purpose: `loadBusiness` above already let an OWNER
      // through the capability gate, and this is the one refusal that gate
      // does not answer for.
      if (selfVerified && !data.selfVerifyAttested) throw failure(409, 'PAYMENT_SELF_VERIFY_FORBIDDEN')
      if (row.kind === 'REFUND') {
        const others = await tx.payment.findMany({ where: { orderId: row.orderId, status: 'VERIFIED' }, select: { kind: true, amountSatang: true, status: true } })
        if (paymentSummary(others).net < row.amountSatang) throw failure(409, 'PAYMENT_REFUND_EXCEEDS_PAID')
      }
      change.verifiedAt = now
      change.verifiedByPersonId = verifierId
    } else {
      change.rejectReason = data.reason ?? null
    }
    const updated = await tx.payment.updateMany({ where: { id: row.id, version: row.version }, data: { ...change, version: { increment: 1 } } })
    if (updated.count !== 1) throw failure(409, 'PAYMENT_VERSION_CONFLICT')
    await recordAudit(tx, { entityType: PAYMENT_ENTITY, entityId: row.id, action: ACTIONS[data.action], actorId: actor(viewer), payload: { businessId: business.id, code: row.code, kind: row.kind, amount: fromSatang(row.amountSatang), from: { status: row.status }, to: { status }, reason: change.rejectReason ?? undefined, version: row.version + 1, ...(data.action === 'VERIFY' ? { selfVerified } : {}) } })
    const payment = await tx.payment.findUnique({ where: { id: row.id }, select: SELECT })
    const order = await tx.salesOrder.findUnique({ where: { id: row.orderId }, select: ORDER_SELECT })
    return { payment, order }
  })
  return { payment: toDto(result.payment), order: orderDto(result.order) }
}
