import { z } from 'zod'
import { PRODUCT_LOT_ENTITY } from '../../../kernel/inventory/inventory.js'
import { auditShelfLife } from '../../../kernel/inventory/inventory-wip.js'
import { denied, inventoryAuthority } from '../../../infrastructure/delegation.js'
import { enqueueOutbox, recordAudit } from '../../../infrastructure/evidence.js'
import * as repo from '../adapters/inventory-repo.js'
import * as reports from '../adapters/report-repo.js'

// Shelf-life (FR-179) inside SCM — port of apps/server inventory-shelf-life-service
// with the same codes, order of refusals and audit:
//   audit    — every lot of every live SKU that declares a storage limit, with its
//              standing (OK / DUE / EXPIRED) from the one kernel rule; on-hand comes
//              from the ledger, so an old empty lot is not a job unless asked for.
//   maintain — records that a batch was actually restored, which resets its clock.
//              An audited act, never a side effect of reading; no ledger movement.
// Every refusal of scope (and an unknown lot) is the legacy 404. SCM takes a
// lock-only touch on the lot before reading its standing, so two concurrent
// records serialize and each audits the value it replaced (D-27).

const failure = (status, code, details) => Object.assign(new Error(code), { status, code, retryable: false }, details === undefined ? {} : { details })
const zId = z.string().trim().min(1).max(200)

export const zRecordMaintenance = z.object({
  businessId: zId,
  lotId: zId,
  note: z.string().trim().max(500).nullable().optional(),
  maintainedAt: z.coerce.date().optional(),
}).strict()

const businessOf = (scope, businessId, write = false) => inventoryAuthority.require(scope, typeof businessId === 'string' ? businessId.trim() : '', write ? { write: true } : undefined)
export const maintainerOf = (scope, body) => businessOf(scope, zRecordMaintenance.parse(body).businessId, true).id

export function shelfLifeAudit(sql, scope, { businessId, thresholdDays, includeEmpty = false, now }) {
  const business = businessOf(scope, businessId)
  const products = reports.ageingProducts(sql, business.id)
  if (!products.length) return { businessId: business.id, rows: [], counts: { total: 0, ok: 0, due: 0, expired: 0 } }
  const byProduct = new Map(products.map((p) => [p.id, p]))
  const entries = reports.lotsWithBalance(sql, business.id, products.map((p) => p.id))
    .map(({ onHand, ...lot }) => ({ product: byProduct.get(lot.productId), lot, onHand }))
    .filter((entry) => includeEmpty || entry.onHand > 0)
  const audit = auditShelfLife(entries, new Date(now))
  // `thresholdDays` narrows the report to what is at least that old, independent of
  // what each product declares.
  const threshold = thresholdDays === undefined || thresholdDays === null || thresholdDays === '' ? NaN : Number(thresholdDays)
  const rows = Number.isFinite(threshold) ? audit.rows.filter((row) => (row.ageDays ?? -1) >= threshold) : audit.rows
  return {
    businessId: business.id,
    thresholdDays: Number.isFinite(threshold) ? threshold : null,
    rows,
    counts: {
      total: rows.length,
      ok: rows.filter((r) => r.state === 'OK').length,
      due: rows.filter((r) => r.state === 'DUE').length,
      expired: rows.filter((r) => r.state === 'EXPIRED').length,
    },
  }
}

const lotDto = ({ id, code, productId, manufacturedAt, lastMaintainedAt, status, version }) => ({ id, code, productId, manufacturedAt, lastMaintainedAt, status, version })

export function recordLotMaintenance(sql, scope, input, ctx) {
  const data = zRecordMaintenance.parse(input)
  const business = businessOf(scope, data.businessId, true)
  if (repo.lotById(sql, data.lotId)?.businessId !== business.id) throw denied()
  repo.lockLot(sql, data.lotId)
  const lot = repo.lotById(sql, data.lotId)
  if (lot.status === 'CLOSED') throw failure(409, 'PRODUCT_LOT_CLOSED')
  const product = repo.productById(sql, lot.productId)
  if (!product?.maintenanceIntervalDays && !product?.maxStorageDays) throw failure(422, 'INVENTORY_PRODUCT_DOES_NOT_AGE')

  const maintainedAt = (data.maintainedAt ?? new Date(ctx.now)).toISOString()
  const updated = repo.maintainLot(sql, lot.id, maintainedAt, ctx.now)
  recordAudit(sql, {
    entityType: PRODUCT_LOT_ENTITY, entityId: lot.id, action: 'PRODUCT_LOT_MAINTAINED', actorId: scope.actorId, tenantId: business.tenantId, businessId: business.id, requestId: ctx.requestId, now: ctx.now,
    payload: {
      businessId: business.id, lotCode: lot.code, productId: product.id, productCode: product.code,
      previousMaintainedAt: lot.lastMaintainedAt, maintainedAt, note: data.note ?? null, version: Number(lot.version) + 1,
    },
  })
  enqueueOutbox(sql, { topic: 'scm.inventory.product-lot-maintained', aggregateType: PRODUCT_LOT_ENTITY, aggregateId: lot.id, aggregateVersion: Number(updated.version), now: ctx.now, payload: { businessId: business.id, lotId: lot.id } })
  return { response: { lot: lotDto(updated) }, affected: { lotId: lot.id, version: Number(updated.version) } }
}
