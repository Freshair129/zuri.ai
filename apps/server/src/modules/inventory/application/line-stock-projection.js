import { createHash } from 'node:crypto'
import prisma from '@/lib/db'
import { availableToPromise, isReservationLive } from '../domain/inventory-wip'
import { acquireLedgerFence } from './inventory-stock-service'

// @req FR-180, FR-291 — a dedicated customer projection uses the same
// per-Business ledger fence and ATP calculator, without constructing a staff Viewer.
// @tested tests/integration/line-product-facts.test.js

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const invalidInput = () => Object.assign(new Error('LINE stock projection scope is invalid'), { status: 400, code: 'LINE_STOCK_PROJECTION_SCOPE_INVALID' })

/**
 * Read only the sellable status derived from FR-180 ATP. The method exposes no
 * quantity or reservation breakdown and makes no fulfillment promise.
 */
export async function readLineStockProjection({ tenantId, businessId, productId, db = prisma, now } = {}) {
  if (![tenantId, businessId, productId].every(value => typeof value === 'string' && value.trim())) throw invalidInput()
  const read = async tx => {
    const business = await tx.business.findFirst({ where: { id: businessId, tenantId }, select: { id: true, tenantId: true } })
    if (!business) return { state: 'UNAVAILABLE', basis: null, sku: null, displayName: null, baseUnit: null, observedFrom: null, observedTo: null, sourceDigest: digest({ state: 'UNAVAILABLE', reason: 'SCOPE' }) }

    await acquireLedgerFence(tx, { tenantId: business.tenantId, businessId: business.id })
    const observedFrom = new Date()
    const effectiveNowRaw = typeof now === 'function' ? now() : now
    const effectiveNow = effectiveNowRaw == null ? observedFrom : new Date(effectiveNowRaw)
    if (Number.isNaN(effectiveNow.valueOf())) throw invalidInput()
    const product = await tx.product.findFirst({
      where: { id: productId, tenantId: business.tenantId, businessId: business.id },
      select: { id: true, code: true, name: true, unit: true, status: true, stockPolicy: true, trackingMode: true,
        itemKind: true, dedicatedCustomerId: true, dedicatedSalesOrderId: true, productMaster: { select: { nameTh: true } } },
    })
    if (!product) return { state: 'UNAVAILABLE', basis: null, sku: null, displayName: null, baseUnit: null,
      observedFrom: observedFrom.toISOString(), observedTo: new Date().toISOString(), sourceDigest: digest({ state: 'UNAVAILABLE', reason: 'PRODUCT' }) }
    const base = { sku: product.code, displayName: product.name || product.productMaster?.nameTh || product.code, baseUnit: product.unit }
    const observedToFor = () => new Date().toISOString()
    const unavailable = reason => ({ ...base, state: 'UNAVAILABLE', basis: null, observedFrom: observedFrom.toISOString(), observedTo: observedToFor(), sourceDigest: digest({ state: 'UNAVAILABLE', reason }) })
    if (product.status !== 'ACTIVE' || !product.unit || product.unit.length > 128 || product.code.length > 128) return unavailable('PRODUCT_NOT_ACTIVE')
    if (product.stockPolicy === 'UNTRACKED' || product.stockPolicy === 'SERVICE') {
      return { ...base, state: 'NOT_MEASURED', basis: null, observedFrom: observedFrom.toISOString(), observedTo: observedToFor(), sourceDigest: digest({ state: 'NOT_MEASURED' }) }
    }
    if (product.stockPolicy !== 'TRACKED' || product.trackingMode !== 'NONE'
      || product.dedicatedCustomerId || product.dedicatedSalesOrderId) return unavailable('STOCK_SCOPE')

    const [movement, reservations] = await Promise.all([
      tx.stockMovement.aggregate({ where: { tenantId: business.tenantId, businessId: business.id, productId: product.id }, _sum: { quantity: true } }),
      tx.stockReservation.findMany({ where: { tenantId: business.tenantId, businessId: business.id, productId: product.id, status: 'ACTIVE' },
        select: { purpose: true, quantity: true, status: true, expiresAt: true } }),
    ])
    const onHand = movement._sum.quantity ?? 0
    if (!Number.isSafeInteger(onHand) || onHand < 0 || reservations.some(row => !Number.isSafeInteger(row.quantity) || row.quantity < 0)) return unavailable('LEDGER_INVALID')
    const liveReservations = reservations.filter(row => isReservationLive(row, effectiveNow))
    const atp = availableToPromise({ onHand, reservations: liveReservations, now: effectiveNow })
    if (!Number.isSafeInteger(atp.available) || atp.available < 0) return unavailable('ATP_INVALID')
    const state = atp.available > 0 ? 'ATP_POSITIVE' : 'ATP_ZERO'
    return { ...base, state, basis: 'BUSINESS_ATP', observedFrom: observedFrom.toISOString(), observedTo: observedToFor(),
      sourceDigest: digest({ state, basis: 'BUSINESS_ATP' }) }
  }
  return typeof db.$transaction === 'function' ? db.$transaction(read) : read(db)
}
