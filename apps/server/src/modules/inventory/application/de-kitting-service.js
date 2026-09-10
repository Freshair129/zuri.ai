import { z } from 'zod'
import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { STOCK_MOVEMENT_ENTITY, explodeRecipe } from '../domain/inventory'
import { weightedAverageUnitCostSatang } from '../domain/inventory-costing'
import { isGenericStockLocation } from '../domain/warehouse-location'
import { loadBusiness, notFound } from './inventory-authority'
import { LOCATION_SELECT } from './warehouse-location-service'
import { appendMovement } from './inventory-stock-service'

// @req FR-178 — controlled disassembly: a finished set is issued and its
//   components are received back, in one transaction, at a stated location.
//
//   Two things it will not do. It will not return a branded component to a
//   generic-stock location (BR-028): a `CUSTOM_COMPONENT` comes back to a
//   dedicated or WIP location, or it goes to quarantine, but it never rejoins
//   the free pool. And it will not optimistically return packaging that the
//   disassembly destroyed — the caller names the destroyed lines, because only
//   the person holding the torn box knows which they are, and a service that
//   guessed would put a ruined foam insert back on the shelf as stock.
// @spec ADR-074 D6; BR-028; SEC-001; FR-072; FR-155; FR-156
// @tested tests/integration/fr178-de-kitting.test.js

const failure = (status, message) => Object.assign(new Error(message), { status })
const actor = (viewer) => viewer?.principal?.id ?? null

/**
 * Run in the caller's transaction when there is one, else open our own. The
 * agent's Gate F action gate hands its own `tx` down (ADR-074 D9), and a
 * nested `$transaction` on a second client would deadlock against it.
 */
const inTx = (db, fn) => (typeof db?.$transaction === 'function' ? db.$transaction(fn) : fn(db))

const zId = z.string().trim().min(1).max(200)

export const zDeKit = z.object({
  businessId: zId,
  recipeId: zId,
  quantity: z.number().int().positive(),
  sourceLocationId: zId.nullable().optional(),
  targetLocationId: zId.nullable().optional(),
  scrapLocationId: zId.nullable().optional(),
  /** Components the disassembly destroyed: they are written off, not returned. */
  destroyedComponentProductIds: z.array(zId).max(200).optional(),
  lotId: zId.nullable().optional(),
  reason: z.string().trim().max(500).nullable().optional(),
  reference: z.string().trim().max(200).nullable().optional(),
  occurredAt: z.coerce.date().optional(),
}).strict()

const RECIPE_SELECT = {
  id: true, code: true, businessId: true, productId: true, batchSize: true, yieldQty: true, status: true,
  lines: { select: { componentProductId: true, qty: true, unit: true, fixed: true }, orderBy: { id: 'asc' } },
}
const PRODUCT_SELECT = {
  id: true, code: true, businessId: true, status: true, stockPolicy: true, trackingMode: true,
  itemKind: true, dedicatedCustomerId: true, dedicatedSalesOrderId: true,
}

async function unitCostOf(tx, productId) {
  const receipts = await tx.stockMovement.findMany({ where: { productId, kind: 'RECEIPT' }, select: { quantity: true, costSatang: true } })
  return weightedAverageUnitCostSatang(receipts)
}

export async function deKitFinishedSets(input, { viewer, db = prisma, now = new Date() } = {}) {
  const data = zDeKit.parse(input)
  return inTx(db, async (tx) => {
    const business = await loadBusiness(tx, viewer, data.businessId, { write: true })
    const recipe = await tx.productRecipe.findUnique({ where: { id: data.recipeId }, select: RECIPE_SELECT })
    if (!recipe || recipe.businessId !== business.id) throw failure(422, 'PRODUCT_RECIPE_NOT_FOUND')

    const finished = await tx.product.findUnique({ where: { id: recipe.productId }, select: PRODUCT_SELECT })
    if (!finished || finished.businessId !== business.id) throw failure(422, 'INVENTORY_PRODUCT_NOT_FOUND')
    if (finished.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')
    if (finished.stockPolicy !== 'TRACKED') throw failure(422, 'INVENTORY_PRODUCT_UNTRACKED')
    if (finished.trackingMode === 'SERIAL') throw failure(422, 'INVENTORY_RECIPE_SERIAL_OUTPUT')

    const target = data.targetLocationId
      ? await tx.warehouseLocation.findUnique({ where: { id: data.targetLocationId }, select: LOCATION_SELECT })
      : null
    if (data.targetLocationId && (!target || target.businessId !== business.id)) throw failure(422, 'WAREHOUSE_LOCATION_NOT_FOUND')

    const explosion = explodeRecipe(recipe, data.quantity)
    const components = await tx.product.findMany({ where: { id: { in: explosion.lines.map((l) => l.componentProductId) } }, select: PRODUCT_SELECT })
    const byId = new Map(components.map((c) => [c.id, c]))
    const destroyed = new Set(data.destroyedComponentProductIds ?? [])

    for (const line of explosion.lines) {
      const component = byId.get(line.componentProductId)
      if (!component || component.businessId !== business.id) throw failure(422, 'PRODUCT_NOT_FOUND')
      if (destroyed.has(component.id)) continue
      if (component.trackingMode === 'LOT') {
        // A returned batch has no lot identity any more — the set was built
        // from lots that are not recorded per unit. Rather than invent one, the
        // caller must write these back explicitly as an adjustment.
        throw Object.assign(failure(422, 'INVENTORY_DEKIT_LOT_COMPONENT'), { details: { componentProductId: component.id, code: component.code } })
      }
      // BR-028 — the move this whole requirement exists to stop.
      if (component.itemKind === 'CUSTOM_COMPONENT' && isGenericStockLocation(target)) {
        throw Object.assign(failure(409, 'INVENTORY_CUSTOM_COMPONENT_NOT_RETURNABLE'), { details: { componentProductId: component.id, code: component.code, targetLocationType: target?.type ?? null } })
      }
    }

    const occurredAt = data.occurredAt ?? now
    const reference = data.reference ?? `DEKIT:${recipe.code}`
    const reason = data.reason ?? 'DE_KITTING'

    // 1. The sets stop existing.
    const issued = await appendMovement(tx, {
      businessId: business.id, productId: finished.id, kind: 'ISSUE', quantity: explosion.producedQty,
      reason, reference, occurredAt,
      sourceLocationId: data.sourceLocationId ?? null,
      ...(data.lotId ? { lotId: data.lotId } : {}),
    }, { viewer })

    // 2. What survived comes back; what did not is simply never received.
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
      const result = await appendMovement(tx, {
        businessId: business.id, productId: component.id, kind: 'RECEIPT', quantity: qty,
        reason, reference, occurredAt,
        targetLocationId: data.targetLocationId ?? null,
        costSatang: await unitCostOf(tx, component.id),
        customerId: component.dedicatedCustomerId ?? null,
        salesOrderId: component.dedicatedSalesOrderId ?? null,
      }, { viewer })
      returned.push({ componentProductId: component.id, code: component.code, quantity: qty, onHandAfter: result.onHandAfter })
    }

    await recordAudit(tx, {
      entityType: STOCK_MOVEMENT_ENTITY, entityId: issued.movements[0].id, action: 'STOCK_DE_KITTED', actorId: actor(viewer),
      payload: {
        businessId: business.id, recipeId: recipe.id, recipeCode: recipe.code,
        finishedProductId: finished.id, finishedCode: finished.code, quantity: explosion.producedQty,
        returned, writtenOff, targetLocationId: data.targetLocationId ?? null, reference,
      },
    })
    return { recipeId: recipe.id, finishedProductId: finished.id, quantity: explosion.producedQty, issued, returned, writtenOff, reference }
  })
}
