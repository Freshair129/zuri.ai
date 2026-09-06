import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import {
  PRODUCT_RECIPE_ENTITY,
  explodeRecipe,
  maxBuildableQuantity,
  recipeRequirements,
  stockOnHand,
  zBuildRecipe,
  zCreateRecipe,
  zRecipeAction,
} from '../domain/inventory'
import { assertMayView, loadBusiness, notFound } from './inventory-authority'
import { appendMovement } from './inventory-stock-service'

// @req FR-156 — the only writer of recipes (bills of materials at a batch
//   size). A recipe belongs to one output SKU and one `batchSize`; its lines
//   name component SKUs of the same Business with a quantity per batch. Create
//   refuses a duplicate code per Tenant, a second recipe for the same
//   (product, batchSize), an output or component of another Business, an
//   archived one, and a recipe that contains its own output. `UPDATE` replaces
//   the descriptive fields and, when given, the whole line set; `ARCHIVE`
//   keeps the row; both compare-and-swap on `version`. `getRecipe` explodes to
//   a quantity and compares with on-hand recomputed from the ledger. `build`
//   is the payoff: one transaction that issues every counted component (FEFO
//   through the ledger, FR-155) and receives the output SKU when it is
//   counted, refused as a whole when any component is short, or when a
//   component or the output is SERIAL-tracked (a build cannot choose serials).
// @spec BR-002; SEC-001; FR-072
// @tested tests/integration/fr156-inventory-recipe.test.js

const failure = (status, message) => Object.assign(new Error(message), { status })
const actor = (viewer) => viewer?.principal?.id ?? null

const LINE_SELECT = { id: true, componentProductId: true, qty: true, unit: true, fixed: true, note: true }
const RECIPE_SELECT = { id: true, code: true, tenantId: true, businessId: true, productId: true, name: true, batchSize: true, yieldQty: true, unit: true, notes: true, status: true, archivedAt: true, createdAt: true, updatedAt: true, version: true, lines: { select: LINE_SELECT, orderBy: { id: 'asc' } } }
const PRODUCT_SELECT = { id: true, code: true, businessId: true, status: true, stockPolicy: true, trackingMode: true, unit: true }

async function requireProduct(tx, id, businessId) {
  const product = await tx.product.findUnique({ where: { id }, select: PRODUCT_SELECT })
  if (!product || product.businessId !== businessId) throw failure(422, 'PRODUCT_NOT_FOUND')
  if (product.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')
  return product
}

async function requireLines(tx, lines, businessId, outputProductId) {
  for (const line of lines) {
    if (line.componentProductId === outputProductId) throw failure(422, 'PRODUCT_RECIPE_SELF_REFERENCE')
    await requireProduct(tx, line.componentProductId, businessId)
  }
}

const lineColumns = (line) => ({ componentProductId: line.componentProductId, qty: line.qty, unit: line.unit ?? null, fixed: Boolean(line.fixed), note: line.note ?? null })

async function onHandFor(db, productIds) {
  if (!productIds.length) return {}
  const products = await db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, stockPolicy: true, movements: { select: { quantity: true } } } })
  return Object.fromEntries(products.map((p) => [p.id, p.stockPolicy === 'TRACKED' ? stockOnHand(p.movements) : null]))
}

export async function createRecipe(input, { viewer, db = prisma } = {}) {
  const data = zCreateRecipe.parse(input)
  return db.$transaction(async (tx) => {
    const business = await loadBusiness(tx, viewer, data.businessId, { write: true })
    const output = await requireProduct(tx, data.productId, business.id)
    const codeTaken = await tx.productRecipe.findUnique({ where: { tenantId_code: { tenantId: business.tenantId, code: data.code } }, select: { id: true } })
    if (codeTaken) throw failure(409, 'PRODUCT_RECIPE_CODE_TAKEN')
    const batchTaken = await tx.productRecipe.findUnique({ where: { productId_batchSize: { productId: output.id, batchSize: data.batchSize } }, select: { id: true } })
    if (batchTaken) throw failure(409, 'PRODUCT_RECIPE_BATCH_TAKEN')
    await requireLines(tx, data.lines, business.id, output.id)
    const created = await tx.productRecipe.create({
      data: {
        code: data.code, tenantId: business.tenantId, businessId: business.id, productId: output.id, name: data.name,
        batchSize: data.batchSize, yieldQty: data.yieldQty ?? data.batchSize, unit: data.unit ?? output.unit ?? 'EA', notes: data.notes ?? null,
        lines: { create: data.lines.map(lineColumns) },
      },
      select: RECIPE_SELECT,
    })
    await recordAudit(tx, { entityType: PRODUCT_RECIPE_ENTITY, entityId: created.id, action: 'PRODUCT_RECIPE_CREATED', actorId: actor(viewer), payload: { businessId: business.id, code: created.code, productId: created.productId, batchSize: created.batchSize, yieldQty: created.yieldQty, lines: created.lines.length } })
    return created
  })
}

export async function listRecipes({ businessId, productId, includeArchived = false, viewer, db = prisma } = {}) {
  const business = await loadBusiness(db, viewer, businessId)
  return db.productRecipe.findMany({
    where: { businessId: business.id, ...(productId ? { productId } : {}), ...(includeArchived ? {} : { status: { not: 'ARCHIVED' } }) },
    orderBy: [{ productId: 'asc' }, { batchSize: 'asc' }],
    select: RECIPE_SELECT,
  })
}

/** One recipe, exploded to `quantity` (default: its batch size) against on-hand recomputed from the ledger. */
export async function getRecipe(id, { quantity, viewer, db = prisma } = {}) {
  const recipeId = typeof id === 'string' ? id.trim() : ''
  if (!recipeId) throw notFound()
  const recipe = await db.productRecipe.findUnique({ where: { id: recipeId }, select: RECIPE_SELECT })
  if (!recipe) throw notFound()
  assertMayView(viewer, recipe.businessId)
  const qty = Number.isInteger(Number(quantity)) && Number(quantity) > 0 ? Number(quantity) : recipe.batchSize
  const onHand = await onHandFor(db, recipe.lines.map((l) => l.componentProductId))
  return {
    ...recipe,
    requirements: recipeRequirements(explodeRecipe(recipe, qty), onHand),
    maxBuildableQuantity: maxBuildableQuantity(recipe, onHand),
  }
}

const ACTIONS = Object.freeze({ UPDATE: 'PRODUCT_RECIPE_UPDATED', ARCHIVE: 'PRODUCT_RECIPE_ARCHIVED' })

export async function applyRecipeAction(id, input, { viewer, db = prisma } = {}) {
  const recipeId = typeof id === 'string' ? id.trim() : ''
  if (!recipeId) throw notFound()
  const data = zRecipeAction.parse(input)
  return db.$transaction(async (tx) => {
    const row = await tx.productRecipe.findUnique({ where: { id: recipeId }, select: RECIPE_SELECT })
    if (!row) throw notFound()
    await loadBusiness(tx, viewer, row.businessId, { write: true })
    if (row.version !== data.version) throw failure(409, 'PRODUCT_RECIPE_VERSION_CONFLICT')
    if (row.status === 'ARCHIVED') throw failure(409, 'PRODUCT_RECIPE_ARCHIVED')
    const change = {}
    const payload = { businessId: row.businessId, code: row.code }
    if (data.action === 'UPDATE') {
      const f = data.fields
      for (const key of ['name', 'yieldQty', 'unit', 'notes']) if (f[key] !== undefined) change[key] = f[key]
      if (f.lines) {
        await requireLines(tx, f.lines, row.businessId, row.productId)
        change.lines = { deleteMany: {}, create: f.lines.map(lineColumns) }
      }
      payload.fields = Object.keys(change)
    } else {
      change.status = 'ARCHIVED'
      change.archivedAt = new Date()
      payload.from = { status: row.status }
      payload.to = { status: 'ARCHIVED' }
    }
    const result = await tx.productRecipe.updateMany({ where: { id: row.id, version: row.version }, data: { version: { increment: 1 } } })
    if (result.count !== 1) throw failure(409, 'PRODUCT_RECIPE_VERSION_CONFLICT')
    await tx.productRecipe.update({ where: { id: row.id }, data: change })
    await recordAudit(tx, { entityType: PRODUCT_RECIPE_ENTITY, entityId: row.id, action: ACTIONS[data.action], actorId: actor(viewer), payload: { ...payload, version: row.version + 1 } })
    return tx.productRecipe.findUnique({ where: { id: row.id }, select: RECIPE_SELECT })
  })
}

/**
 * Build `quantity` units: issue every counted component and receive the
 * output, in one transaction, or nothing at all.
 */
export async function buildRecipe(id, input, { viewer, db = prisma } = {}) {
  const recipeId = typeof id === 'string' ? id.trim() : ''
  if (!recipeId) throw notFound()
  const data = zBuildRecipe.parse(input)
  return db.$transaction(async (tx) => {
    const recipe = await tx.productRecipe.findUnique({ where: { id: recipeId }, select: RECIPE_SELECT })
    if (!recipe) throw notFound()
    const business = await loadBusiness(tx, viewer, data.businessId, { write: true })
    if (recipe.businessId !== business.id) throw notFound()
    if (recipe.status === 'ARCHIVED') throw failure(409, 'PRODUCT_RECIPE_ARCHIVED')
    const output = await tx.product.findUnique({ where: { id: recipe.productId }, select: PRODUCT_SELECT })
    if (!output || output.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')
    if (output.stockPolicy === 'TRACKED' && output.trackingMode === 'SERIAL') throw failure(422, 'INVENTORY_RECIPE_SERIAL_OUTPUT')
    if (output.stockPolicy === 'TRACKED' && output.trackingMode === 'LOT' && !data.outputLotCode) throw failure(422, 'INVENTORY_LOT_REQUIRED')

    const components = await tx.product.findMany({ where: { id: { in: recipe.lines.map((l) => l.componentProductId) } }, select: { ...PRODUCT_SELECT, movements: { select: { quantity: true } } } })
    const byId = new Map(components.map((c) => [c.id, c]))
    for (const line of recipe.lines) {
      const c = byId.get(line.componentProductId)
      if (!c || c.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')
      if (c.stockPolicy === 'TRACKED' && c.trackingMode === 'SERIAL') throw failure(422, 'INVENTORY_RECIPE_SERIAL_COMPONENT')
    }
    const onHand = Object.fromEntries(components.map((c) => [c.id, c.stockPolicy === 'TRACKED' ? stockOnHand(c.movements) : null]))
    const requirements = recipeRequirements(explodeRecipe(recipe, data.quantity), onHand)
    if (!requirements.canBuild) {
      const short = requirements.lines.filter((l) => l.shortage > 0).map((l) => ({ componentProductId: l.componentProductId, code: byId.get(l.componentProductId)?.code, required: l.issueQty, onHand: l.onHand, shortage: l.shortage }))
      throw Object.assign(failure(409, 'INVENTORY_RECIPE_SHORTAGE'), { details: short })
    }

    const occurredAt = data.occurredAt ?? new Date()
    const reference = data.reference ?? `RECIPE:${recipe.code}`
    const consumed = []
    for (const line of requirements.lines) {
      if (line.onHand === null || line.issueQty <= 0) continue
      const result = await appendMovement(tx, { businessId: business.id, productId: line.componentProductId, kind: 'ISSUE', quantity: line.issueQty, reason: data.reason ?? 'RECIPE_BUILD', reference, occurredAt }, { viewer })
      consumed.push({ componentProductId: line.componentProductId, quantity: line.issueQty, onHandAfter: result.onHandAfter, allocations: result.allocations })
    }
    let produced = null
    if (output.stockPolicy === 'TRACKED' && requirements.producedQty > 0) {
      const result = await appendMovement(tx, { businessId: business.id, productId: output.id, kind: 'RECEIPT', quantity: requirements.producedQty, reason: data.reason ?? 'RECIPE_BUILD', reference, occurredAt, ...(output.trackingMode === 'LOT' ? { lotCode: data.outputLotCode } : {}) }, { viewer })
      produced = { productId: output.id, quantity: requirements.producedQty, onHandAfter: result.onHandAfter, lotId: result.lotId }
    }
    await recordAudit(tx, { entityType: PRODUCT_RECIPE_ENTITY, entityId: recipe.id, action: 'PRODUCT_RECIPE_BUILT', actorId: actor(viewer), payload: { businessId: business.id, code: recipe.code, quantity: data.quantity, factor: requirements.factor, producedQty: requirements.producedQty, consumed, produced, reference } })
    return { recipeId: recipe.id, productId: output.id, quantity: data.quantity, factor: requirements.factor, producedQty: requirements.producedQty, consumed, produced, reference }
  })
}
