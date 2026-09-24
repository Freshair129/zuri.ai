import { assertIdempotencyKey, findReceipt, operationDto, replayOrConflict, requestHash, writeReceipt } from '../infrastructure/evidence.js'
import { commerceAuthority, denied, inventoryAuthority, procurementAuthority } from '../infrastructure/delegation.js'
import { createUnavailableReferenceAuthority } from '../infrastructure/reference-authority.js'
import { applyPurchaseOrderAction, createPurchaseOrder, createSupplier, getPurchaseOrder, loadOrderInScope } from '../modules/procurement/application/purchase-orders.js'
import { listMovements, stockSummary } from '../modules/inventory/index.js'
import { postGoodsReceipt } from '../workflows/post-goods-receipt.js'
import { commitBusiness, commitSupplierCostSheet, getSupplierCostSheet, listSupplierCostSheets, normalizeEnvelope, previewSupplierCostSheet } from '../modules/procurement/application/supplier-cost-sheets.js'
import { checkoutPosSale, parseCheckout, prepareCheckout } from '../workflows/pos-checkout.js'
import { getOrder } from '../modules/commerce/application/orders.js'
import { applyPaymentAction, getPayment, listPayments, loadOrderForPayment, prepareRecordPayment, recordPayment } from '../modules/commerce/application/payments.js'
import * as commerceRepo from '../modules/commerce/adapters/commerce-repo.js'
import { applyOrderAction, createOrder, listOrders, loadOrderInScope as loadSalesOrderInScope, prepareCreateOrder, prepareOrderAction } from '../modules/commerce/application/sales-orders.js'
import { zCreateOrder } from '../kernel/commerce/commerce.js'
import { getRevenueSummary } from '../modules/commerce/application/revenue.js'
import { authorizeCatalogue, getPosTerminalCatalogue } from '../modules/commerce/application/pos-catalogue.js'
import { applyPricingRuleAction, calculatePricing, calculationRequest, createPricingRuleSet, getActivePricingRuleSet, guardCalculationReplay, listPricingRules, loadRuleInScope, ownerBusiness, previewPricingRules, updatePricingRuleSet, zCalculatePricing, zCreatePricingRule } from '../modules/commerce/application/pricing-rules.js'

// SCM business commands — the external API's only mutation entry points. A
// client sends ONE business command (e.g. "post this receipt"); it never opens a
// remote transaction or issues sub-writes. Each command:
//   1. authorizes against the CURRENT delegated scope (also on replay — a key is
//      never a read capability),
//   2. looks up (scope, key): same payload → the stored outcome, different → 409,
//   3. optionally `prepare`s OUTSIDE the unit of work (remote reference facts —
//      never while holding the writer lock), only when no receipt exists yet,
//   4. otherwise executes the use case and writes the receipt in the SAME unit
//      of work, so "committed" and "has a receipt" cannot diverge.

const PRICING_VIEW = { mayView: (scope, businessId) => commerceAuthority.mayView(scope, businessId) && scope.owns(businessId) }

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
  // Supplier cost sheets (TASK-ZAI-053): buyer capability; the commit also needs
  // Inventory write authority, checked inside the unit of work by Inventory itself.
  // The legacy source-hash replay (same sheet, any key) answers replayed: true.
  'procurement.cost-sheet.preview': {
    authorize: (sql, scope, { body }) => procurementAuthority.require(scope, normalizeEnvelope(body).envelope.businessId, 'costSheet').id,
    execute: (sql, scope, { body }, ctx) => previewSupplierCostSheet(sql, scope, body, ctx),
  },
  'procurement.cost-sheet.commit': {
    authorize: (sql, scope, { body }) => commitBusiness(scope, body).id,
    execute: (sql, scope, { body }, ctx) => commitSupplierCostSheet(sql, scope, body, ctx),
  },
  'commerce.pos.checkout': {
    // Authorization needs the parsed businessId; a malformed body is a 422 before any lookup.
    authorize: (sql, scope, { body }) => commerceAuthority.require(scope, parseCheckout(body).businessId, 'order').id,
    // Replay discloses on-hand figures when stock was issued.
    replayGuard: (scope, businessId, stored) => { if (stored.stockDeductions?.length && !inventoryAuthority.mayView(scope, businessId)) throw denied() },
    prepare: (scope, { body }, deps) => prepareCheckout(scope, body, deps),
    execute: (sql, scope, { prepared }, ctx) => checkoutPosSale(sql, scope, prepared, ctx),
  },
  'commerce.sales-order.create': {
    authorize: (sql, scope, { body }) => commerceAuthority.require(scope, zCreateOrder.parse(body).businessId, 'order').id,
    prepare: (scope, { body }, deps) => prepareCreateOrder(scope, body, deps),
    execute: (sql, scope, { prepared }, ctx) => createOrder(sql, scope, prepared, ctx),
  },
  'commerce.sales-order.action': {
    authorize: (sql, scope, { targetId }) => loadSalesOrderInScope(sql, scope, targetId, 'order').businessId,
    // A replay of a fulfilment discloses on-hand figures.
    replayGuard: (scope, businessId, stored) => { if (stored.issued?.length && !inventoryAuthority.mayView(scope, businessId)) throw denied() },
    prepare: (scope, { targetId, body }, deps) => prepareOrderAction(scope, { orderId: targetId, body }, {
      references: deps.references,
      readOrder: (id) => deps.read((sql) => loadSalesOrderInScope(sql, scope, id, 'order')),
    }),
    execute: (sql, scope, { targetId, prepared }, ctx) => applyOrderAction(sql, scope, targetId, prepared, ctx),
  },
  'commerce.payment.record': {
    authorize: (sql, scope, { targetId }) => loadOrderForPayment(sql, scope, targetId).businessId,
    prepare: (scope, { targetId, body }, deps) => prepareRecordPayment(scope, { orderId: targetId, body }, {
      references: deps.references,
      readOrder: (id) => deps.read((sql) => loadOrderForPayment(sql, scope, id)),
    }),
    execute: (sql, scope, { targetId, prepared }, ctx) => recordPayment(sql, scope, targetId, prepared, ctx),
  },
  'commerce.payment.action': {
    authorize: (sql, scope, { targetId }) => {
      const row = commerceRepo.paymentById(sql, typeof targetId === 'string' ? targetId.trim() : '')
      if (!row || row.tenantId !== scope.tenantId) throw denied()
      return commerceAuthority.require(scope, row.businessId, 'verify').id
    },
    execute: (sql, scope, { targetId, body }, ctx) => applyPaymentAction(sql, scope, targetId, body, ctx),
  },
  // Pricing (FR-253): OWNER only — also for an outcome lookup (lookupView). Rule content is validated by the one kernel evaluator.
  'commerce.pricing-rule.create': {
    lookupView: PRICING_VIEW,
    authorize: (sql, scope, { body }) => ownerBusiness(scope, zCreatePricingRule.parse(body).businessId).id,
    execute: (sql, scope, { body }, ctx) => createPricingRuleSet(sql, scope, body, ctx),
  },
  'commerce.pricing-rule.update': {
    lookupView: PRICING_VIEW,
    authorize: (sql, scope, { targetId, body }) => loadRuleInScope(sql, scope, targetId, body?.businessId).businessId,
    execute: (sql, scope, { targetId, body }, ctx) => updatePricingRuleSet(sql, scope, targetId, body, ctx),
  },
  'commerce.pricing-rule.action': {
    lookupView: PRICING_VIEW,
    authorize: (sql, scope, { targetId, body }) => loadRuleInScope(sql, scope, targetId, body?.businessId).businessId,
    execute: (sql, scope, { targetId, body }, ctx) => applyPricingRuleAction(sql, scope, targetId, body, ctx),
  },
  'commerce.pricing.calculate': {
    lookupView: PRICING_VIEW,
    authorize: (sql, scope, { body }) => ownerBusiness(scope, zCalculatePricing.parse(body).businessId).id,
    // The key is bound to the NORMALIZED request (legacy requestHash), so "12.5"
    // and "12.50" are one request, and a reuse gets the legacy conflict code.
    hashBody: (body) => calculationRequest(body),
    conflictCode: 'PRICING_CALCULATION_IDEMPOTENCY_CONFLICT',
    // A replay must not offer a price whose policy was since withdrawn or superseded.
    replayGuard: (scope, businessId, stored, { sql, now }) => guardCalculationReplay(sql, scope, businessId, stored, now),
    execute: (sql, scope, { body }, ctx) => calculatePricing(sql, scope, body, ctx),
  },
}

const LOOKUP_VIEW = { commerce: commerceAuthority, procurement: procurementAuthority }

export const COMMAND_NAMES = Object.freeze(Object.keys(COMMANDS))

export function createCommandBus({ store, clock = () => new Date(), faults = {}, references = createUnavailableReferenceAuthority() }) {
  async function run(scope, action, { idempotencyKey, targetId = null, body }) {
    const command = COMMANDS[action]
    if (!command) throw Object.assign(new Error('unknown command'), { status: 404, code: 'SCM_COMMAND_UNKNOWN' })
    assertIdempotencyKey(idempotencyKey)
    // Hashed only after authorization, so a caller without the capability learns
    // nothing from a normalization refusal (legacy order: parse, scope, engine).
    let hash
    const hashOf = () => (hash ??= requestHash({ action, targetId, body: command.hashBody ? command.hashBody(body) : body ?? null }))
    const replayIfCommitted = (sql) => {
      const businessId = command.authorize(sql, scope, { targetId, body })
      const key = { tenantId: scope.tenantId, businessId, action, actorId: scope.actorId, idempotencyKey }
      const existing = findReceipt(sql, key)
      if (!existing) return { key, businessId, replay: null }
      const replay = replayOrConflict(existing, hashOf(), targetId, command.conflictCode)
      command.replayGuard?.(scope, businessId, replay, { sql, now: clock().toISOString() })
      return { key, businessId, replay }
    }
    let prepared
    if (command.prepare) {
      const early = await store.read(replayIfCommitted)
      if (early.replay) return early.replay
      prepared = await command.prepare(scope, { targetId, body }, { references, read: (fn) => store.read(fn) })
    }
    return store.transaction(async (sql) => {
      const { key, replay } = replayIfCommitted(sql)
      if (replay) return replay
      const now = clock().toISOString()
      hashOf()
      const outcome = command.execute(sql, scope, { targetId, body, prepared }, { now, requestId: idempotencyKey, faults: faults[action] ?? {} })
      const operation = writeReceipt(sql, { ...key, hash: hashOf(), targetId, response: outcome.response, affected: outcome.affected, now })
      // A use case may itself report a domain replay (e.g. a cost sheet found by its source hash).
      return { replayed: false, ...outcome.response, operation }
    })
  }

  /** Outcome lookup after a lost response: the exact receipt, or 404 (never re-executes). */
  async function lookup(scope, { action, businessId, idempotencyKey }) {
    const command = COMMANDS[action]
    if (!command) throw Object.assign(new Error('unknown command'), { status: 404, code: 'SCM_COMMAND_UNKNOWN' })
    assertIdempotencyKey(idempotencyKey)
    if (!(command.lookupView ?? LOOKUP_VIEW[action.split('.')[0]])?.mayView(scope, businessId)) throw denied()
    return store.read((sql) => {
      const row = findReceipt(sql, { tenantId: scope.tenantId, businessId, action, actorId: scope.actorId, idempotencyKey })
      if (!row) throw Object.assign(new Error('no committed operation for this key'), { status: 404, code: 'SCM_OPERATION_NOT_FOUND', retryable: false })
      const response = JSON.parse(row.responseJson)
      command.replayGuard?.(scope, businessId, response, { sql, now: clock().toISOString() })
      return { operation: operationDto(row), response }
    })
  }

  const queries = {
    purchaseOrder: (scope, id) => store.read((sql) => ({ order: getPurchaseOrder(sql, scope, id) })),
    stock: (scope, businessId) => store.read((sql) => stockSummary(sql, scope, { businessId })),
    movements: (scope, q) => store.read((sql) => ({ movements: listMovements(sql, scope, q) })),
    salesOrder: (scope, id) => store.read((sql) => ({ order: getOrder(sql, scope, id) })),
    payment: (scope, id) => store.read((sql) => ({ payment: getPayment(sql, scope, id) })),
    orders: (scope, query) => store.read((sql) => listOrders(sql, scope, query)),
    revenue: (scope, query) => store.read((sql) => getRevenueSummary(sql, scope, query)),
    orderPayments: (scope, orderId) => store.read((sql) => listPayments(sql, scope, orderId)),
    // Authorize, then read Branch facts from their owner (outside the store), then the store.
    posCatalogue: async (scope, query) => {
      const business = authorizeCatalogue(scope, query)
      const branches = await references.branches(scope, { businessId: business.id })
      return store.read((sql) => getPosTerminalCatalogue(sql, business, branches))
    },
    costSheet: (scope, id) => store.read((sql) => ({ sheet: getSupplierCostSheet(sql, scope, id) })),
    costSheets: (scope, query) => store.read((sql) => listSupplierCostSheets(sql, scope, query)),
    pricingRules: (scope, query) => store.read((sql) => listPricingRules(sql, scope, query, clock().toISOString())),
    activePricingRule: (scope, businessId) => store.read((sql) => getActivePricingRuleSet(sql, scope, businessId, clock().toISOString())),
    // Read-only evaluation (no key, nothing stored): the same evaluator as calculate.
    pricingPreview: (scope, body) => store.read((sql) => previewPricingRules(sql, scope, body)),
  }

  return { run, lookup, queries }
}
