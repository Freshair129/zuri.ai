// @req FR-159 — payments against a real database: recorded PENDING by a
//   rep, the bank reference unique per Tenant, the slip a FileAsset of the same
//   Business, verified or rejected by a verifier (or the owner), the order's
//   paid / balance / payment state following verified money only, refunds
//   bounded by what was paid, and the revenue summary by origin and day.
// @spec ADR-065; ADR-054 D4; BR-002; SEC-001; FR-072
// @tested tests/integration/fr159-payment.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { ROLE_PAYMENT_VERIFIER, ROLE_SALES_REP } from '@/modules/identity/rbac'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { applyOrderAction, createOrder, getOrder } from '@/modules/commerce/application/sales-order-service'
import { applyPaymentAction, getPayment, listPayments, recordPayment } from '@/modules/commerce/application/payment-service'
import { getRevenueSummary } from '@/modules/commerce/application/revenue-read-model'

const NOW = new Date('2026-09-06T03:00:00Z')
const DOMAINS = ['projects', 'platform', 'commerce', 'customer']
let tenant, business, otherBusiness, owner, rep, verifier, member, noDomain, slip, foreignSlip, convA

describe('FR-159 Payment', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'Pay Group', code: 'PF-PAY' })
    tenant = await createTenant({ portfolioId: portfolio.id, name: 'Pay Tenant', code: 'TNT-PAY' })
    business = await createBusiness({ tenantId: tenant.id, name: 'ร้านรับชำระ', code: 'BUS-PAY' })
    otherBusiness = await createBusiness({ tenantId: tenant.id, name: 'ร้านอื่น', code: 'BUS-PAY-2' })
    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: DOMAINS, principal: { id: 'per-owner', code: 'PER-OWNER', displayName: 'Owner' } })
    rep = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: DOMAINS, rolesByBusinessId: { [business.id]: [ROLE_SALES_REP] }, principal: { id: 'per-rep', code: 'PER-REP', displayName: 'Rep' } })
    verifier = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: DOMAINS, rolesByBusinessId: { [business.id]: [ROLE_PAYMENT_VERIFIER] }, principal: { id: 'per-ver', code: 'PER-VER', displayName: 'Verifier' } })
    member = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: DOMAINS })
    noDomain = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: ['projects'] })
    slip = await prisma.fileAsset.create({ data: { code: 'FIL-PAY-1', tenantId: tenant.id, businessId: business.id, storageKind: 'MANAGED_BLOB', blobRef: 'blob-pay-1', name: 'slip.jpg', mime: 'image/jpeg', size: 4, sha256: 'sha-pay', status: 'ACTIVE' } })
    foreignSlip = await prisma.fileAsset.create({ data: { code: 'FIL-PAY-2', tenantId: tenant.id, businessId: otherBusiness.id, storageKind: 'MANAGED_BLOB', blobRef: 'blob-pay-2', name: 'other.jpg', mime: 'image/jpeg', size: 4, sha256: 'sha-pay-2', status: 'ACTIVE' } })
    const a = await ingestLineMessage({ tenantId: tenant.id, businessId: business.id, lineUserId: 'U-pay-a', displayName: 'ลูกค้า จ่าย', threadId: 'TH-PAY-A', text: 'โอนแล้ว', externalMessageId: 'MP-1' })
    convA = a.conversationId
  })

  const order = (over = {}) => createOrder({ businessId: business.id, lines: [{ description: 'ชุดของขวัญ', qty: 2, unitPrice: 500 }], ...over }, { viewer: owner, now: NOW })

  it('AC-159.1 — a rep records a PENDING payment with a generated PAY code; the order stays UNPAID until verified', async () => {
    const o = await order()
    const p = await recordPayment(o.id, { method: 'TRANSFER', amount: 400, bankReference: 'KBANK-0001', slipFileAssetId: slip.id, paidAt: '2026-09-06T02:00:00Z' }, { viewer: rep, now: NOW })
    expect(p).toMatchObject({ code: 'PAY-20260906-001', orderId: o.id, kind: 'PAYMENT', method: 'TRANSFER', amount: 400, status: 'PENDING', bankReference: 'KBANK-0001', slipFileAssetId: slip.id, createdByPersonId: 'per-rep', version: 1 })
    expect(await getOrder(o.id, { viewer: member })).toMatchObject({ paid: 0, pending: 400, balanceDue: 1000, paymentState: 'UNPAID' })
    await expect(recordPayment(o.id, { method: 'TRANSFER', amount: 1, bankReference: 'KBANK-0001' }, { viewer: rep })).rejects.toMatchObject({ status: 409, message: 'PAYMENT_REFERENCE_TAKEN' })
    await expect(recordPayment(o.id, { method: 'TRANSFER', amount: 1, slipFileAssetId: foreignSlip.id }, { viewer: rep })).rejects.toMatchObject({ status: 422, message: 'PAYMENT_SLIP_NOT_FOUND' })
    await expect(recordPayment(o.id, { method: 'CASH', amount: 1 }, { viewer: member })).rejects.toMatchObject({ status: 404 })
    await expect(recordPayment('no-such-order', { method: 'CASH', amount: 1 }, { viewer: owner })).rejects.toMatchObject({ status: 404 })
    const audits = await prisma.auditEvent.findMany({ where: { entityType: 'PAYMENT', entityId: p.id } })
    expect(audits.map((a) => a.action)).toEqual(['PAYMENT_RECORDED'])
  })

  it('AC-159.2 — verifying needs the verifier hat (or the owner); verified money moves the order to PARTIAL then PAID; rejected money never counts', async () => {
    const o = await order()
    const p1 = await recordPayment(o.id, { method: 'QR', amount: 300 }, { viewer: rep, now: NOW })
    await expect(applyPaymentAction(p1.id, { action: 'VERIFY', version: 1 }, { viewer: rep })).rejects.toMatchObject({ status: 404 })
    await expect(applyPaymentAction(p1.id, { action: 'VERIFY', version: 1 }, { viewer: noDomain })).rejects.toMatchObject({ status: 404 })
    const v1 = await applyPaymentAction(p1.id, { action: 'VERIFY', version: 1 }, { viewer: verifier, now: NOW })
    expect(v1.payment).toMatchObject({ status: 'VERIFIED', verifiedByPersonId: 'per-ver', version: 2 })
    expect(v1.order).toMatchObject({ paid: 300, balanceDue: 700, paymentState: 'PARTIAL' })
    await expect(applyPaymentAction(p1.id, { action: 'REJECT', version: 2 }, { viewer: verifier })).rejects.toMatchObject({ status: 409, message: 'PAYMENT_STATUS_INVALID' })
    await expect(applyPaymentAction(p1.id, { action: 'VERIFY', version: 1 }, { viewer: verifier })).rejects.toMatchObject({ status: 409, message: 'PAYMENT_VERSION_CONFLICT' })
    const bad = await recordPayment(o.id, { method: 'TRANSFER', amount: 700, note: 'สลิปปลอม' }, { viewer: rep, now: NOW })
    const rejected = await applyPaymentAction(bad.id, { action: 'REJECT', version: 1, reason: 'สลิปไม่ตรง' }, { viewer: owner, now: NOW })
    expect(rejected.payment).toMatchObject({ status: 'REJECTED', rejectReason: 'สลิปไม่ตรง' })
    expect(rejected.order).toMatchObject({ paid: 300, paymentState: 'PARTIAL' })
    const p3 = await recordPayment(o.id, { method: 'CASH', amount: 700 }, { viewer: owner, now: NOW })
    const paid = await applyPaymentAction(p3.id, { action: 'VERIFY', version: 1 }, { viewer: owner, now: NOW })
    expect(paid.order).toMatchObject({ paid: 1000, balanceDue: 0, paymentState: 'PAID' })
    const listed = await listPayments(o.id, { viewer: member })
    expect(listed.payments.map((p) => p.status)).toEqual(['VERIFIED', 'REJECTED', 'VERIFIED'])
    expect(listed.summary).toEqual({ paid: 1000, refunded: 0, net: 1000, pending: 0 })
    expect(await getPayment(p3.id, { viewer: member })).toMatchObject({ id: p3.id, amount: 700 })
  })

  it('AC-159.3 — refunds: bounded by verified money, allowed on a cancelled order; a payment on a cancelled order is not', async () => {
    const o = await order()
    const p = await recordPayment(o.id, { method: 'TRANSFER', amount: 1000, bankReference: 'SCB-9' }, { viewer: rep, now: NOW })
    await applyPaymentAction(p.id, { action: 'VERIFY', version: 1 }, { viewer: owner, now: NOW })
    const tooMuch = await recordPayment(o.id, { kind: 'REFUND', method: 'TRANSFER', amount: 1200 }, { viewer: rep, now: NOW })
    await expect(applyPaymentAction(tooMuch.id, { action: 'VERIFY', version: 1 }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'PAYMENT_REFUND_EXCEEDS_PAID' })
    await applyOrderAction(o.id, { action: 'CANCEL', version: 1, reason: 'คืนสินค้า' }, { viewer: owner, now: NOW })
    await expect(recordPayment(o.id, { method: 'CASH', amount: 1 }, { viewer: rep })).rejects.toMatchObject({ status: 409, message: 'SALES_ORDER_CANCELLED' })
    const refund = await recordPayment(o.id, { kind: 'REFUND', method: 'TRANSFER', amount: 1000 }, { viewer: rep, now: NOW })
    const refunded = await applyPaymentAction(refund.id, { action: 'VERIFY', version: 1 }, { viewer: verifier, now: NOW })
    expect(refunded.order).toMatchObject({ paid: 1000, refunded: 1000, net: 0, paymentState: 'REFUNDED', status: 'CANCELLED' })
  })

  it('AC-159.4 — revenue is verified net by origin and Bangkok day, pending beside it, never rejected money', async () => {
    const fresh = await createBusiness({ tenantId: tenant.id, name: 'ร้านรายได้', code: 'BUS-PAY-REV' })
    const boss = makeViewer({ visibleBusinessIds: [fresh.id], ownedBusinessIds: [fresh.id], visibleDomains: DOMAINS })
    const conv = await ingestLineMessage({ tenantId: tenant.id, businessId: fresh.id, lineUserId: 'U-rev', displayName: 'ลูกค้า แชท', threadId: 'TH-REV', text: 'x', externalMessageId: 'MR-1' })
    const chat = await createOrder({ businessId: fresh.id, conversationId: conv.conversationId, lines: [{ description: 'a', qty: 1, unitPrice: 900 }] }, { viewer: boss, now: NOW })
    const walk = await createOrder({ businessId: fresh.id, lines: [{ description: 'b', qty: 1, unitPrice: 300 }] }, { viewer: boss, now: NOW })
    const c1 = await recordPayment(chat.id, { method: 'TRANSFER', amount: 900, paidAt: '2026-09-05T10:00:00Z' }, { viewer: boss, now: NOW })
    await applyPaymentAction(c1.id, { action: 'VERIFY', version: 1 }, { viewer: boss, now: NOW })
    const w1 = await recordPayment(walk.id, { method: 'CASH', amount: 300, paidAt: '2026-09-06T17:30:00Z' }, { viewer: boss, now: NOW })
    await applyPaymentAction(w1.id, { action: 'VERIFY', version: 1 }, { viewer: boss, now: NOW })
    const w2 = await recordPayment(walk.id, { method: 'QR', amount: 50, paidAt: '2026-09-07T01:00:00Z' }, { viewer: boss, now: NOW })
    const r = await recordPayment(chat.id, { kind: 'REFUND', method: 'TRANSFER', amount: 100, paidAt: '2026-09-07T02:00:00Z' }, { viewer: boss, now: NOW })
    await applyPaymentAction(r.id, { action: 'VERIFY', version: 1 }, { viewer: boss, now: NOW })
    const bad = await recordPayment(walk.id, { method: 'CARD', amount: 999 }, { viewer: boss, now: NOW })
    await applyPaymentAction(bad.id, { action: 'REJECT', version: 1 }, { viewer: boss, now: NOW })

    const all = await getRevenueSummary({ businessId: fresh.id }, { viewer: boss })
    expect(all).toMatchObject({ verifiedNet: 1100, refunded: 100, byOrigin: { CHAT: 800, WALK_IN: 300, ONLINE: 0 }, pending: { count: 1, amount: 50 }, orders: { open: 2, completed: 0 } })
    expect(all.byDay).toEqual([{ day: '2026-09-05', net: 900 }, { day: '2026-09-07', net: 200 }])
    expect((await getRevenueSummary({ businessId: fresh.id, from: '2026-09-07', to: '2026-09-07' }, { viewer: boss })).verifiedNet).toBe(200)
    await expect(getRevenueSummary({ businessId: fresh.id }, { viewer: noDomain })).rejects.toMatchObject({ status: 404 })
    void w2
  })
})
