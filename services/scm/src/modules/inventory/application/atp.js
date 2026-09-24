import { availableToPromise, isReservationLive } from '../../../kernel/inventory/inventory-wip.js'
import { inventoryAuthority } from '../../../infrastructure/delegation.js'
import * as catalogRepo from '../adapters/catalog-repo.js'
import * as repo from '../adapters/inventory-repo.js'
import * as wipRepo from '../adapters/wip-repo.js'

// Available-to-Promise (FR-180) READ inside SCM — port of apps/server
// inventory-atp-service.availableToPromiseFor: on-hand from the ledger less the
// live reservations (liveness decided against the clock by the kernel, BR-031).
// An uncounted SKU reports `available: null`, never 0.
//
// Transitional scope (SHARED_TRANSITION): the reservation WRITERS (create,
// release / convert, expiry stamping) and the public ATP / max-buildable reads
// move with the ATP group. Until then this read sees only reservations written
// in the SCM store, so the kitting open that uses it must not be cut over before
// the reservation writers are (gate recorded in SCM-HANDOFF).

export function availableToPromiseFor(sql, scope, { businessId, productIds, now }) {
  const business = inventoryAuthority.require(scope, typeof businessId === 'string' ? businessId.trim() : '')
  const all = catalogRepo.productsOf(sql, business.id, {}).filter((p) => p.status !== 'ARCHIVED')
  const wanted = productIds?.length ? new Set(productIds) : null
  const products = (wanted ? all.filter((p) => wanted.has(p.id)) : all).sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
  const ids = products.map((p) => p.id)
  const live = {}
  for (const row of wipRepo.activeReservationsOf(sql, business.id, ids)) {
    if (!isReservationLive(row, now)) continue
    ;(live[row.productId] ??= []).push(row)
  }
  const rows = products.map((product) => {
    if (product.stockPolicy !== 'TRACKED') {
      return { productId: product.id, code: product.code, unit: product.unit, itemKind: product.itemKind, stockPolicy: product.stockPolicy, onHand: null, committed: 0, reservedForQuotes: 0, available: null, overCommitted: 0 }
    }
    const atp = availableToPromise({ onHand: repo.onHandOf(sql, product.id), reservations: live[product.id] ?? [], now })
    return { productId: product.id, code: product.code, unit: product.unit, itemKind: product.itemKind, stockPolicy: product.stockPolicy, ...atp }
  })
  return { businessId: business.id, products: rows, byProductId: Object.fromEntries(rows.map((r) => [r.productId, r.available])) }
}
