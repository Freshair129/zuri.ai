import {
  PRODUCT_RECIPE_ENTITY, explodeRecipe, maxBuildableQuantity, recipeRequirements, zBuildRecipe, zCreateRecipe, zRecipeAction,
} from '../../../kernel/inventory/inventory.js'
import { denied, inventoryAuthority } from '../../../infrastructure/delegation.js'
import { enqueueOutbox, recordAudit } from '../../../infrastructure/evidence.js'
import { appendMovement } from './stock-ledger.js'
import * as repo from '../adapters/inventory-repo.js'
import * as wipRepo from '../adapters/wip-repo.js'

// Recipes (FR-156) inside SCM — port of apps/server inventory-recipe-service with
// the same codes, order of refusals and audit actions:
//   create — one output SKU at one batch size, same-Business components that are
//            not the output itself; code unique per Tenant, (product, batchSize) unique.
//   action — UPDATE (descriptive fields and, when given, the whole line set) and
//            ARCHIVE (the row stays), both by compare-and-swap on version.
//   get    — exploded to a quantity against on-hand recomputed from the ledger.
//   build  — one unit of work that issues every counted component (FEFO through
//            the ledger) and receives the output when it is counted; refused whole
//            on any shortage or a SERIAL component / output.

const failure = (status, code, details) => Object.assign(new Error(code), { status, code, retryable: false }, details === undefined ? {} : { details })
const iso = (value) => (value instanceof Date ? value.toISOString() : value)
const ACTIONS = Object.freeze({ UPDATE: 'PRODUCT_RECIPE_UPDATED', ARCHIVE: 'PRODUCT_RECIPE_ARCHIVED' })

function evidence(sql, scope, { entityId, action, business, payload, version, ctx }) {
  recordAudit(sql, { entityType: PRODUCT_RECIPE_ENTITY, entityId, action, actorId: scope.actorId, tenantId: business.tenantId, businessId: business.id, requestId: ctx.requestId, now: ctx.now, payload })
  enqueueOutbox(sql, { topic: `scm.inventory.${action.toLowerCase().replace(/_/g, '-')}`, aggregateType: PRODUCT_RECIPE_ENTITY, aggregateId: entityId, aggregateVersion: version, now: ctx.now, payload: { businessId: business.id, recipeId: entityId } })
}

/** Legacy requireProduct: a SKU of this Business (422 PRODUCT_NOT_FOUND), not archived (409). */
function requireProduct(sql, id, businessId) {
  const product = repo.productById(sql, id)
  if (!product || product.businessId !== businessId) throw failure(422, 'PRODUCT_NOT_FOUND')
  if (product.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')
  return product
}

function requireLines(sql, lines, businessId, outputProductId) {
  for (const line of lines) {
    if (line.componentProductId === outputProductId) throw failure(422, 'PRODUCT_RECIPE_SELF_REFERENCE')
    requireProduct(sql, line.componentProductId, businessId)
  }
}

/** On-hand per SKU id from the ledger; an uncounted SKU reports null, never 0. */
export function onHandFor(sql, productIds) {
  const out = {}
  for (const id of productIds) {
    const product = repo.productById(sql, id)
    if (product) out[id] = product.stockPolicy === 'TRACKED' ? repo.onHandOf(sql, id) : null
  }
  return out
}

const recipeId = (id) => (typeof id === 'string' ? id.trim() : '')

/** Command authorization for create: validate first (legacy order), then Inventory write on the named Business. */
export const creatorOf = (scope, body) => inventoryAuthority.require(scope, zCreateRecipe.parse(body).businessId, { write: true }).id
/** The recipe an action targets, with Inventory write authority on its Business; 404 otherwise. */
export function recipeForWrite(sql, scope, id) {
  const row = recipeId(id) ? wipRepo.recipeById(sql, recipeId(id)) : null
  if (!row || row.tenantId !== scope.tenantId) throw denied()
  inventoryAuthority.require(scope, row.businessId, { write: true })
  return row
}
/** Build authorization: the body's Business (write), then a recipe of that Business; 404 otherwise. */
export function builderOf(sql, scope, id, body) {
  const data = zBuildRecipe.parse(body)
  const business = inventoryAuthority.require(scope, data.businessId, { write: true })
  const row = recipeId(id) ? wipRepo.recipeById(sql, recipeId(id)) : null
  if (!row || row.businessId !== business.id) throw denied()
  return business.id
}

export function createRecipe(sql, scope, input, ctx) {
  const data = zCreateRecipe.parse(input)
  const business = inventoryAuthority.require(scope, data.businessId, { write: true })
  const output = requireProduct(sql, data.productId, business.id)
  if (wipRepo.recipeCodeTaken(sql, business.tenantId, data.code)) throw failure(409, 'PRODUCT_RECIPE_CODE_TAKEN')
  if (wipRepo.recipeBatchTaken(sql, output.id, data.batchSize)) throw failure(409, 'PRODUCT_RECIPE_BATCH_TAKEN')
  requireLines(sql, data.lines, business.id, output.id)
  const created = wipRepo.insertRecipe(sql, {
    code: data.code, tenantId: business.tenantId, businessId: business.id, productId: output.id, name: data.name,
    batchSize: data.batchSize, yieldQty: data.yieldQty ?? data.batchSize, unit: data.unit ?? output.unit ?? 'EA', notes: data.notes ?? null,
    scrapAllowanceFactor: data.scrapAllowanceFactor ?? 0, lines: data.lines, now: ctx.now,
  })
  evidence(sql, scope, { entityId: created.id, action: 'PRODUCT_RECIPE_CREATED', business, version: 1, ctx, payload: { businessId: business.id, code: created.code, productId: created.productId, batchSize: created.batchSize, yieldQty: created.yieldQty, lines: created.lines.length } })
  return { response: { recipe: created }, affected: { recipeId: created.id, version: created.version } }
}

export function listRecipes(sql, scope, { businessId, productId, includeArchived = false } = {}) {
  const business = inventoryAuthority.require(scope, typeof businessId === 'string' ? businessId.trim() : '')
  return wipRepo.recipesOf(sql, business.id, { productId: productId || undefined, includeArchived })
}

/** One recipe, exploded to `quantity` (default: its batch size) against on-hand from the ledger. */
export function getRecipe(sql, scope, id, { quantity } = {}) {
  const recipe = recipeId(id) ? wipRepo.recipeById(sql, recipeId(id)) : null
  if (!recipe || recipe.tenantId !== scope.tenantId) throw denied()
  inventoryAuthority.require(scope, recipe.businessId)
  const qty = Number.isInteger(Number(quantity)) && Number(quantity) > 0 ? Number(quantity) : recipe.batchSize
  const onHand = onHandFor(sql, recipe.lines.map((l) => l.componentProductId))
  return { ...recipe, requirements: recipeRequirements(explodeRecipe(recipe, qty), onHand), maxBuildableQuantity: maxBuildableQuantity(recipe, onHand) }
}

export function applyRecipeAction(sql, scope, id, input, ctx) {
  const data = zRecipeAction.parse(input)
  const row = recipeForWrite(sql, scope, id)
  const business = inventoryAuthority.require(scope, row.businessId, { write: true })
  if (row.version !== data.version) throw failure(409, 'PRODUCT_RECIPE_VERSION_CONFLICT')
  if (row.status === 'ARCHIVED') throw failure(409, 'PRODUCT_RECIPE_ARCHIVED')
  const change = {}
  let lines = null
  const payload = { businessId: row.businessId, code: row.code }
  if (data.action === 'UPDATE') {
    const f = data.fields
    for (const key of ['name', 'yieldQty', 'unit', 'notes', 'scrapAllowanceFactor']) if (f[key] !== undefined) change[key] = f[key]
    if (f.lines) {
      requireLines(sql, f.lines, row.businessId, row.productId)
      lines = f.lines
    }
    payload.fields = [...Object.keys(change), ...(lines ? ['lines'] : [])]
  } else {
    change.status = 'ARCHIVED'
    change.archivedAt = ctx.now
    payload.from = { status: row.status }
    payload.to = { status: 'ARCHIVED' }
  }
  if (wipRepo.casRecipeVersion(sql, row.id, row.version, ctx.now) !== 1) throw failure(409, 'PRODUCT_RECIPE_VERSION_CONFLICT')
  wipRepo.updateRecipe(sql, row.id, change, lines, ctx.now)
  evidence(sql, scope, { entityId: row.id, action: ACTIONS[data.action], business, version: row.version + 1, ctx, payload: { ...payload, version: row.version + 1 } })
  const fresh = wipRepo.recipeById(sql, row.id)
  return { response: { recipe: fresh }, affected: { recipeId: row.id, version: fresh.version, status: fresh.status } }
}

/** Build `quantity` units: issue every counted component and receive the output, in one unit of work, or nothing. */
export function buildRecipe(sql, scope, id, input, ctx) {
  const data = zBuildRecipe.parse(input)
  const business = inventoryAuthority.require(scope, data.businessId, { write: true })
  const recipe = recipeId(id) ? wipRepo.recipeById(sql, recipeId(id)) : null
  if (!recipe || recipe.businessId !== business.id) throw denied()
  if (recipe.status === 'ARCHIVED') throw failure(409, 'PRODUCT_RECIPE_ARCHIVED')
  const output = repo.productById(sql, recipe.productId)
  if (!output || output.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')
  if (output.stockPolicy === 'TRACKED' && output.trackingMode === 'SERIAL') throw failure(422, 'INVENTORY_RECIPE_SERIAL_OUTPUT')
  if (output.stockPolicy === 'TRACKED' && output.trackingMode === 'LOT' && !data.outputLotCode) throw failure(422, 'INVENTORY_LOT_REQUIRED')

  const byId = new Map()
  for (const line of recipe.lines) {
    const c = repo.productById(sql, line.componentProductId)
    if (!c || c.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')
    if (c.stockPolicy === 'TRACKED' && c.trackingMode === 'SERIAL') throw failure(422, 'INVENTORY_RECIPE_SERIAL_COMPONENT')
    byId.set(c.id, c)
  }
  const onHand = Object.fromEntries([...byId.values()].map((c) => [c.id, c.stockPolicy === 'TRACKED' ? repo.onHandOf(sql, c.id) : null]))
  const requirements = recipeRequirements(explodeRecipe(recipe, data.quantity), onHand)
  if (!requirements.canBuild) {
    const short = requirements.lines.filter((l) => l.shortage > 0).map((l) => ({ componentProductId: l.componentProductId, code: byId.get(l.componentProductId)?.code, required: l.issueQty, onHand: l.onHand, shortage: l.shortage }))
    throw failure(409, 'INVENTORY_RECIPE_SHORTAGE', short)
  }

  const occurredAt = iso(data.occurredAt) ?? ctx.now
  const reference = data.reference ?? `RECIPE:${recipe.code}`
  const reason = data.reason ?? 'RECIPE_BUILD'
  const consumed = []
  for (const line of requirements.lines) {
    if (line.onHand === null || line.issueQty <= 0) continue
    const result = appendMovement(sql, scope, { businessId: business.id, productId: line.componentProductId, kind: 'ISSUE', quantity: line.issueQty, reason, reference, occurredAt, requestId: ctx.requestId }, { now: ctx.now })
    consumed.push({ componentProductId: line.componentProductId, quantity: line.issueQty, onHandAfter: result.onHandAfter, allocations: result.allocations })
  }
  let produced = null
  if (output.stockPolicy === 'TRACKED' && requirements.producedQty > 0) {
    const result = appendMovement(sql, scope, { businessId: business.id, productId: output.id, kind: 'RECEIPT', quantity: requirements.producedQty, reason, reference, occurredAt, requestId: ctx.requestId, ...(output.trackingMode === 'LOT' ? { lotCode: data.outputLotCode } : {}) }, { now: ctx.now })
    produced = { productId: output.id, quantity: requirements.producedQty, onHandAfter: result.onHandAfter, lotId: result.lotId }
  }
  const outcome = { recipeId: recipe.id, productId: output.id, quantity: data.quantity, factor: requirements.factor, producedQty: requirements.producedQty, consumed, produced, reference }
  evidence(sql, scope, { entityId: recipe.id, action: 'PRODUCT_RECIPE_BUILT', business, version: recipe.version, ctx, payload: { businessId: business.id, code: recipe.code, quantity: data.quantity, factor: requirements.factor, producedQty: requirements.producedQty, consumed, produced, reference } })
  return { response: { build: outcome }, affected: { recipeId: recipe.id, producedQty: requirements.producedQty } }
}
