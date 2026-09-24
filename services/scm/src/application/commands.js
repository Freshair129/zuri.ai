import { assertIdempotencyKey, findReceipt, operationDto, replayOrConflict, requestHash, writeReceipt } from '../infrastructure/evidence.js'
import { denied, inventoryAuthority, procurementAuthority } from '../infrastructure/delegation.js'
import { applyPurchaseOrderAction, createPurchaseOrder, createSupplier, getPurchaseOrder, loadOrderInScope } from '../modules/procurement/application/purchase-orders.js'
import { listMovements, stockSummary } from '../modules/inventory/index.js'
import { postGoodsReceipt } from '../workflows/post-goods-receipt.js'

// SCM business commands — the external API's only mutation entry points. A
// client sends ONE business command (e.g. "post this receipt"); it never opens a
// remote transaction or issues sub-writes. Each command:
//   1. authorizes against the CURRENT delegated scope (also on replay — a key is
//      never a read capability),
//   2. looks up (scope, key): same payload → the stored outcome, different → 409,
//   3. otherwise executes the use case and writes the receipt in the SAME unit
//      of work, so "committed" and "has a receipt" cannot diverge.

const COMMANDS = {
  'procurement.supplier.create': {
    authorize: (sql, scope, { body }) => procurementAuthority.require(scope, body?.businessId, 'po').id,
    execute: (sql, scope, { body }, ctx) => { const supplier = createSupplier(sql, scope, body, ctx); return { response: { supplier }, affected: { supplierId: supplier.id, supplierVersion: supplier.version } } },
  },
  'procurement.purchase-order.create': {
    authorize: (sql, scope, { body }) => procurementAuthority.require(scope, body?.businessId, 'po').id,
    execute: (sql, scope, { body }, ctx) => { const order = createPurchaseOrder(sql, scope, body, ctx); return { response: { order }, affected: { purchaseOrderId: order.id, purchaseOrderVersion: order.version } } },
  },
  'procurement.purchase-order.action': {
    authorize: (sql, scope, { targetId }) => loadOrderInScope(sql, scope, targetId, 'po').businessId,
    execute: (sql, scope, { targetId, body }, ctx) => { const order = applyPurchaseOrderAction(sql, scope, targetId, body, ctx); return { response: { order }, affected: { purchaseOrderId: order.id, purchaseOrderVersion: order.version, status: order.status } } },
  },
  'procurement.goods-receipt.post': {
    authorize: (sql, scope, { targetId }) => loadOrderInScope(sql, scope, targetId, 'receipt').businessId,
    // A replayed receipt discloses on-hand figures: Inventory visibility is re-checked.
    replayGuard: (scope, businessId, stored) => { if (stored.posted?.length && !inventoryAuthority.mayView(scope, businessId)) throw denied() },
    execute: (sql, scope, { targetId, body }, ctx) => postGoodsReceipt(sql, scope, targetId, body, ctx),
  },
}

export const COMMAND_NAMES = Object.freeze(Object.keys(COMMANDS))

export function createCommandBus({ store, clock = () => new Date(), faults = {} }) {
  async function run(scope, action, { idempotencyKey, targetId = null, body }) {
    const command = COMMANDS[action]
    if (!command) throw Object.assign(new Error('unknown command'), { status: 404, code: 'SCM_COMMAND_UNKNOWN' })
    assertIdempotencyKey(idempotencyKey)
    const hash = requestHash({ action, targetId, body: body ?? null })
    return store.transaction(async (sql) => {
      const businessId = command.authorize(sql, scope, { targetId, body })
      const key = { tenantId: scope.tenantId, businessId, action, actorId: scope.actorId, idempotencyKey }
      const existing = findReceipt(sql, key)
      if (existing) {
        const replay = replayOrConflict(existing, hash, targetId)
        command.replayGuard?.(scope, businessId, replay)
        return replay
      }
      const now = clock().toISOString()
      const outcome = command.execute(sql, scope, { targetId, body }, { now, requestId: idempotencyKey, faults: faults[action] ?? {} })
      const operation = writeReceipt(sql, { ...key, hash, targetId, response: outcome.response, affected: outcome.affected, now })
      return { ...outcome.response, replayed: false, operation }
    })
  }

  /** Outcome lookup after a lost response: the exact receipt, or 404 (never re-executes). */
  async function lookup(scope, { action, businessId, idempotencyKey }) {
    const command = COMMANDS[action]
    if (!command) throw Object.assign(new Error('unknown command'), { status: 404, code: 'SCM_COMMAND_UNKNOWN' })
    assertIdempotencyKey(idempotencyKey)
    if (!procurementAuthority.mayView(scope, businessId)) throw denied()
    return store.read((sql) => {
      const row = findReceipt(sql, { tenantId: scope.tenantId, businessId, action, actorId: scope.actorId, idempotencyKey })
      if (!row) throw Object.assign(new Error('no committed operation for this key'), { status: 404, code: 'SCM_OPERATION_NOT_FOUND', retryable: false })
      const response = JSON.parse(row.responseJson)
      command.replayGuard?.(scope, businessId, response)
      return { operation: operationDto(row), response }
    })
  }

  const queries = {
    purchaseOrder: (scope, id) => store.read((sql) => ({ order: getPurchaseOrder(sql, scope, id) })),
    stock: (scope, businessId) => store.read((sql) => stockSummary(sql, scope, { businessId })),
    movements: (scope, q) => store.read((sql) => ({ movements: listMovements(sql, scope, q) })),
  }

  return { run, lookup, queries }
}
