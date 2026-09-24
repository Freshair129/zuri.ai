import { z } from 'zod'
import { STOCK_MOVEMENT_ENTITY, explodeRecipe } from '../../../kernel/inventory/inventory.js'
import { weightedAverageUnitCostSatang } from '../../../kernel/inventory/inventory-costing.js'
import { isGenericStockLocation } from '../../../kernel/inventory/warehouse-location.js'
import { inventoryAuthority } from '../../../infrastructure/delegation.js'
import { enqueueOutbox, recordAudit } from '../../../infrastructure/evidence.js'
import { appendMovement } from './stock-ledger.js'
import * as catalogRepo from '../adapters/catalog-repo.js'
import * as repo from '../adapters/inventory-repo.js'
import * as wipRepo from '../adapters/wip-repo.js'

// Controlled disassembly (FR-178) inside SCM — port of apps/server
// de-kitting-service.deKitFinishedSets: the finished sets are issued and their
// surviving components received back, in one unit of work, at a stated location.
// A branded (CUSTOM_COMPONENT) component never returns to a generic-stock
// location (BR-028); lines the caller names as destroyed are written off (never
// received); a LOT-tracked component is refused rather than given an invented lot.
// The input contract is the legacy zDeKit, declared here because it lives in the
// legacy service file, not in a kernel domain file.

const failure = (status, code, details) => Object.assign(new Error(code), { status, code, retryable: false }, details === undefined ? {} : { details })
const iso = (value) => (value instanceof Date ? value.toISOString() : value)
const zId = z.string().trim().min(1).max(200)

export const zDeKit = z.object({
  businessId: zId,
  recipeId: zId,
  quantity: z.number().int().positive(),
  sourceLocationId: zId.nullable().optional(),
  targetLocationId: zId.nullable().optional(),
  scrapLocationId: zId.nullable().optional(),
  destroyedComponentProductIds: z.array(zId).max(200).optional(),
  lotId: zId.nullable().optional(),
  reason: z.string().trim().max(500).nullable().optional(),
  reference: z.string().trim().max(200).nullable().optional(),
  occurredAt: z.coerce.date().optional(),
}).strict()

export const deKitterOf = (scope, body) => inventoryAuthority.require(scope, zDeKit.parse(body).businessId, { write: true }).id

export function deKitFinishedSets(sql, scope, input, ctx) {
  const data = zDeKit.parse(input)
  const business = inventoryAuthority.require(scope, data.businessId, { write: true })
  const recipe = wipRepo.recipeById(sql, data.recipeId)
  if (!recipe || recipe.businessId !== business.id) throw failure(422, 'PRODUCT_RECIPE_NOT_FOUND')
  const finished = catalogRepo.byId(sql, 'product', recipe.productId)
  if (!finished || finished.businessId !== business.id) throw failure(422, 'INVENTORY_PRODUCT_NOT_FOUND')
  if (finished.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')
  if (finished.stockPolicy !== 'TRACKED') throw failure(422, 'INVENTORY_PRODUCT_UNTRACKED')
  if (finished.trackingMode === 'SERIAL') throw failure(422, 'INVENTORY_RECIPE_SERIAL_OUTPUT')

  const target = data.targetLocationId ? repo.locationById(sql, data.targetLocationId) : null
  if (data.targetLocationId && (!target || target.businessId !== business.id)) throw failure(422, 'WAREHOUSE_LOCATION_NOT_FOUND')

  const explosion = explodeRecipe(recipe, data.quantity)
  const byId = new Map()
  const destroyed = new Set(data.destroyedComponentProductIds ?? [])
  for (const line of explosion.lines) {
    const component = catalogRepo.byId(sql, 'product', line.componentProductId)
    if (!component || component.businessId !== business.id) throw failure(422, 'PRODUCT_NOT_FOUND')
    byId.set(component.id, component)
    if (destroyed.has(component.id)) continue
    if (component.trackingMode === 'LOT') throw failure(422, 'INVENTORY_DEKIT_LOT_COMPONENT', { componentProductId: component.id, code: component.code })
    if (component.itemKind === 'CUSTOM_COMPONENT' && isGenericStockLocation(target)) {
      throw failure(409, 'INVENTORY_CUSTOM_COMPONENT_NOT_RETURNABLE', { componentProductId: component.id, code: component.code, targetLocationType: target?.type ?? null })
    }
  }

  const occurredAt = iso(data.occurredAt) ?? ctx.now
  const reference = data.reference ?? `DEKIT:${recipe.code}`
  const reason = data.reason ?? 'DE_KITTING'
  // 1. The sets stop existing.
  const issued = appendMovement(sql, scope, { businessId: business.id, productId: finished.id, kind: 'ISSUE', quantity: explosion.producedQty, reason, reference, occurredAt, sourceLocationId: data.sourceLocationId ?? null, requestId: ctx.requestId, ...(data.lotId ? { lotId: data.lotId } : {}) }, { now: ctx.now })
  // 2. What survived comes back; what did not is never received.
  const returned = []
  const writtenOff = []
  for (const line of explosion.lines) {
    const component = byId.get(line.componentProductId)
    const qty = Math.ceil(line.required - 1e-9)
    if (qty <= 0) continue
    if (component.stockPolicy !== 'TRACKED') continue
    if (destroyed.has(component.id)) {
      writtenOff.push({ componentProductId: component.id, code: component.code, quantity: qty })
      continue
    }
    const result = appendMovement(sql, scope, {
      businessId: business.id, productId: component.id, kind: 'RECEIPT', quantity: qty, reason, reference, occurredAt,
      targetLocationId: data.targetLocationId ?? null, costSatang: weightedAverageUnitCostSatang(wipRepo.receiptsOf(sql, component.id)),
      customerId: component.dedicatedCustomerId ?? null, salesOrderId: component.dedicatedSalesOrderId ?? null, requestId: ctx.requestId,
    }, { now: ctx.now })
    returned.push({ componentProductId: component.id, code: component.code, quantity: qty, onHandAfter: result.onHandAfter })
  }
  const payload = { businessId: business.id, recipeId: recipe.id, recipeCode: recipe.code, finishedProductId: finished.id, finishedCode: finished.code, quantity: explosion.producedQty, returned, writtenOff, targetLocationId: data.targetLocationId ?? null, reference }
  recordAudit(sql, { entityType: STOCK_MOVEMENT_ENTITY, entityId: issued.movements[0].id, action: 'STOCK_DE_KITTED', actorId: scope.actorId, tenantId: business.tenantId, businessId: business.id, requestId: ctx.requestId, now: ctx.now, payload })
  enqueueOutbox(sql, { topic: 'scm.inventory.stock-de-kitted', aggregateType: STOCK_MOVEMENT_ENTITY, aggregateId: issued.movements[0].id, now: ctx.now, payload: { businessId: business.id, recipeId: recipe.id } })
  const outcome = { recipeId: recipe.id, finishedProductId: finished.id, quantity: explosion.producedQty, issued, returned, writtenOff, reference }
  return { response: { deKit: outcome }, affected: { recipeId: recipe.id, quantity: explosion.producedQty } }
}
