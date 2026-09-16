import { z } from 'zod'
import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { PRODUCT_LOT_ENTITY, stockOnHand } from '../domain/inventory'
import { auditShelfLife } from '../domain/inventory-wip'
import { loadBusiness, notFound } from './inventory-authority'

// @req FR-179 — the read that tells a warehouse which batches are ageing, and
//   the one write that resets a batch's clock. Recording maintenance is a
//   deliberate, audited act — a lithium cell was actually taken off the rack
//   and charged to storage voltage, an instrument was actually recalibrated —
//   so it is a service call with an audit row and never a side effect of
//   reading the report. Nothing here touches the stock ledger: maintenance
//   changes what a lot is *allowed* to do, not how many of it there are.
// @spec ADR-074 D7; BR-030; SEC-001; FR-072
// @tested tests/integration/fr179-shelf-life-guard.test.js

const failure = (status, message) => Object.assign(new Error(message), { status })
const actor = (viewer) => viewer?.principal?.id ?? null

/**
 * Run in the caller's transaction when there is one, else open our own. The
 * agent's Gate F action gate hands its own `tx` down (ADR-074 D9), and a
 * nested `$transaction` on a second client would deadlock against it.
 */
const inTx = (db, fn) => (typeof db?.$transaction === 'function' ? db.$transaction(fn) : fn(db))

const zId = z.string().trim().min(1).max(200)

export const zRecordMaintenance = z.object({
  businessId: zId,
  lotId: zId,
  note: z.string().trim().max(500).nullable().optional(),
  maintainedAt: z.coerce.date().optional(),
}).strict()

/**
 * Every lot of every product that declares a storage limit, with its standing.
 * `state` is `OK`, `DUE` (surfaced, still issuable) or `EXPIRED` (refused for
 * issue and for kitting until a maintenance is recorded). `onHand` comes from
 * the ledger, so a lot that is old and empty does not appear as a job.
 */
export async function shelfLifeAudit({ businessId, thresholdDays, includeEmpty = false, viewer, db = prisma, now = new Date() } = {}) {
  const business = await loadBusiness(db, viewer, businessId)
  const products = await db.product.findMany({
    where: {
      businessId: business.id,
      status: { not: 'ARCHIVED' },
      OR: [{ maintenanceIntervalDays: { not: null } }, { maxStorageDays: { not: null } }],
    },
    select: { id: true, code: true, name: true, maintenanceIntervalDays: true, maxStorageDays: true },
  })
  if (!products.length) return { businessId: business.id, rows: [], counts: { total: 0, ok: 0, due: 0, expired: 0 } }

  const byProduct = new Map(products.map((p) => [p.id, p]))
  const lots = await db.productLot.findMany({
    where: { businessId: business.id, productId: { in: products.map((p) => p.id) } },
    select: { id: true, code: true, productId: true, manufacturedAt: true, expiresAt: true, lastMaintainedAt: true, status: true, movements: { select: { quantity: true } } },
    orderBy: [{ createdAt: 'asc' }],
  })

  const entries = lots
    .map((lot) => ({ product: byProduct.get(lot.productId), lot, onHand: stockOnHand(lot.movements) }))
    .filter((entry) => includeEmpty || entry.onHand > 0)
  const audit = auditShelfLife(entries, now)

  // `thresholdDays` narrows the report to what is at least that old — the
  // caller's own "show me anything past 180 days", independent of what each
  // product declares.
  const rows = Number.isFinite(Number(thresholdDays))
    ? audit.rows.filter((row) => (row.ageDays ?? -1) >= Number(thresholdDays))
    : audit.rows
  return {
    businessId: business.id,
    thresholdDays: Number.isFinite(Number(thresholdDays)) ? Number(thresholdDays) : null,
    rows,
    counts: {
      total: rows.length,
      ok: rows.filter((r) => r.state === 'OK').length,
      due: rows.filter((r) => r.state === 'DUE').length,
      expired: rows.filter((r) => r.state === 'EXPIRED').length,
    },
  }
}

/** Record that a batch was actually restored, which is what resets its clock. */
export async function recordLotMaintenance(input, { viewer, db = prisma, now = new Date() } = {}) {
  const data = zRecordMaintenance.parse(input)
  return inTx(db, async (tx) => {
    const business = await loadBusiness(tx, viewer, data.businessId, { write: true })
    const lot = await tx.productLot.findUnique({
      where: { id: data.lotId },
      select: { id: true, code: true, businessId: true, productId: true, manufacturedAt: true, lastMaintainedAt: true, status: true, version: true },
    })
    if (!lot || lot.businessId !== business.id) throw notFound()
    if (lot.status === 'CLOSED') throw failure(409, 'PRODUCT_LOT_CLOSED')
    const product = await tx.product.findUnique({ where: { id: lot.productId }, select: { id: true, code: true, maintenanceIntervalDays: true, maxStorageDays: true } })
    if (!product?.maintenanceIntervalDays && !product?.maxStorageDays) throw failure(422, 'INVENTORY_PRODUCT_DOES_NOT_AGE')

    const maintainedAt = data.maintainedAt ?? now
    const updated = await tx.productLot.update({
      where: { id: lot.id },
      data: { lastMaintainedAt: maintainedAt, version: { increment: 1 } },
      select: { id: true, code: true, productId: true, manufacturedAt: true, lastMaintainedAt: true, status: true, version: true },
    })
    await recordAudit(tx, {
      entityType: PRODUCT_LOT_ENTITY, entityId: lot.id, action: 'PRODUCT_LOT_MAINTAINED', actorId: actor(viewer),
      payload: {
        businessId: business.id, lotCode: lot.code, productId: product.id, productCode: product.code,
        previousMaintainedAt: lot.lastMaintainedAt, maintainedAt, note: data.note ?? null, version: lot.version + 1,
      },
    })
    return updated
  })
}
