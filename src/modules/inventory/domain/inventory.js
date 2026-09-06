import { z } from 'zod'
import {
  INVENTORY_LOT_STATUSES,
  INVENTORY_MOVEMENT_KINDS,
  INVENTORY_PRODUCT_ACTIONS,
  INVENTORY_RECIPE_ACTIONS,
  INVENTORY_SERIAL_STATUSES,
  INVENTORY_STOCK_POLICIES,
  INVENTORY_TRACKING_MODES,
} from '@/lib/validation/enums'

// @req FR-154 — the pure vocabulary of the Inventory catalogue (คลังสินค้า):
//   the input contracts for category, family, factory, product master, product
//   (SKU) and bundle, the human `code` shape, and the one rule a SKU carries
//   about itself — whether it is counted (TRACKED) or not (UNTRACKED), and how
//   its units are identified (NONE / LOT / SERIAL).
// @req FR-155 — the pure calculators of the stock ledger: the signed delta a
//   movement contributes, on-hand as the sum of a product's movements, the
//   safety-stock comparison, bundle availability from on-hand, and the
//   refusal rules that keep an uncounted product out of the ledger and a
//   counted one consistent with its tracking mode. No I/O here on purpose:
//   every number a page shows is recomputed from these.
// @spec BR-002 (codes, serials and lot numbers are attributes, never keys)
// @tested tests/unit/inventory-domain.test.js

export const INVENTORY_DOMAIN_KEY = 'inventory'

export const INVENTORY_CATEGORY_ENTITY = 'INVENTORY_CATEGORY'
export const PRODUCT_FAMILY_ENTITY = 'PRODUCT_FAMILY'
export const FACTORY_ENTITY = 'FACTORY'
export const PRODUCT_MASTER_ENTITY = 'PRODUCT_MASTER'
export const PRODUCT_ENTITY = 'PRODUCT'
export const PRODUCT_BUNDLE_ENTITY = 'PRODUCT_BUNDLE'
export const PRODUCT_LOT_ENTITY = 'PRODUCT_LOT'
export const SERIAL_UNIT_ENTITY = 'SERIAL_UNIT'
export const STOCK_MOVEMENT_ENTITY = 'STOCK_MOVEMENT'

/** Catalogue row statuses; two words, so they live here rather than in the registry. */
export const INVENTORY_RECORD_STATUSES = Object.freeze(['ACTIVE', 'ARCHIVED'])

// A human code: letters, digits, dot, dash, underscore; 1–64 characters. It
// is the user-facing identity (BR-002) and unique per Tenant — never the key.
export const INVENTORY_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
export const zInventoryCode = z.string().trim().regex(INVENTORY_CODE_PATTERN, 'code must be 1–64 letters, digits, ".", "-" or "_"')
const zSlug = z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be kebab-case').max(64)
const zBusinessId = z.string().trim().min(1).max(200)
const zId = z.string().trim().min(1).max(200)
const zText = (max) => z.string().trim().min(1).max(max)
const zOptionalText = (max) => z.string().trim().max(max).nullable().optional()
const zMoney = z.number().finite().nonnegative()

export const zCreateCategory = z.object({
  businessId: zBusinessId,
  code: zInventoryCode,
  nameTh: zText(200),
  nameEn: zText(200),
  slug: zSlug.nullable().optional(),
  vibe: zOptionalText(500),
  targetRecipient: zOptionalText(500),
  guardrail: zOptionalText(1000),
}).strict()

export const zCreateFamily = z.object({
  businessId: zBusinessId,
  code: zInventoryCode,
  name: zText(200),
  description: zOptionalText(1000),
}).strict()

export const zCreateFactory = z.object({
  businessId: zBusinessId,
  code: zInventoryCode,
  name: zText(200),
  country: zOptionalText(100),
  contact: zOptionalText(500),
}).strict()

export const zCreateProductMaster = z.object({
  businessId: zBusinessId,
  code: zInventoryCode,
  categoryId: zId,
  familyId: zId.nullable().optional(),
  factoryId: zId.nullable().optional(),
  nameTh: zText(200),
  nameEn: zText(200),
  baseCost: zMoney.optional(),
  specs: z.record(z.string(), z.unknown()).optional(),
}).strict()

export const zProductFields = z.object({
  name: zOptionalText(200),
  color: zOptionalText(100),
  material: zOptionalText(100),
  unit: zText(20).optional(),
  safetyStock: z.number().int().nonnegative().optional(),
}).strict()

export const zCreateProduct = zProductFields.extend({
  businessId: zBusinessId,
  code: zInventoryCode,
  productMasterId: zId,
  stockPolicy: z.enum(INVENTORY_STOCK_POLICIES).optional(),
  trackingMode: z.enum(INVENTORY_TRACKING_MODES).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.stockPolicy === 'UNTRACKED' && value.trackingMode && value.trackingMode !== 'NONE') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['trackingMode'], message: 'an UNTRACKED product has no tracking mode' })
  }
})

export const zProductAction = z.object({
  action: z.enum(INVENTORY_PRODUCT_ACTIONS),
  version: z.number().int().positive(),
  fields: zProductFields.partial().strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.action === 'UPDATE' && (!value.fields || Object.keys(value.fields).length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fields'], message: 'fields is required for UPDATE' })
  }
})

export const zBundleItem = z.object({ productId: zId, qty: z.number().int().positive() }).strict()

export const zCreateBundle = z.object({
  businessId: zBusinessId,
  code: zInventoryCode,
  name: zText(200),
  description: zOptionalText(1000),
  targetRecipients: z.number().int().positive().nullable().optional(),
  totalPrice: zMoney.nullable().optional(),
  items: z.array(zBundleItem).min(1).max(200)
    .refine((items) => new Set(items.map((i) => i.productId)).size === items.length, 'a product appears once per bundle'),
}).strict()

const zDate = z.coerce.date()

export const zCreateLot = z.object({
  businessId: zBusinessId,
  productId: zId,
  code: zInventoryCode,
  factoryId: zId.nullable().optional(),
  manufacturedAt: zDate.nullable().optional(),
  expiresAt: zDate.nullable().optional(),
  status: z.enum(INVENTORY_LOT_STATUSES).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.manufacturedAt && value.expiresAt && value.expiresAt <= value.manufacturedAt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: 'expiresAt must be after manufacturedAt' })
  }
})

export const zRecordMovement = z.object({
  businessId: zBusinessId,
  productId: zId,
  kind: z.enum(INVENTORY_MOVEMENT_KINDS),
  quantity: z.number().int(),
  lotId: zId.nullable().optional(),
  lotCode: zInventoryCode.nullable().optional(),
  serialNos: z.array(zText(100)).max(500).optional(),
  serialUnitId: zId.nullable().optional(),
  reason: zOptionalText(500),
  reference: zOptionalText(200),
  occurredAt: zDate.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.kind !== 'ADJUSTMENT' && value.quantity <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['quantity'], message: 'RECEIPT and ISSUE take a positive quantity' })
  }
  if (value.kind === 'ADJUSTMENT' && value.quantity === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['quantity'], message: 'an ADJUSTMENT of zero changes nothing' })
  }
  if (value.lotId && value.lotCode) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['lotCode'], message: 'give lotId or lotCode, not both' })
  }
})

/**
 * The signed quantity a movement contributes to on-hand. RECEIPT adds,
 * ISSUE removes, ADJUSTMENT carries its own sign (a stocktake correction
 * either way). Anything else contributes nothing rather than guessing.
 */
export function movementDelta(kind, quantity) {
  const qty = Number.isFinite(quantity) ? Math.trunc(quantity) : 0
  if (kind === 'RECEIPT') return Math.abs(qty)
  if (kind === 'ISSUE') return -Math.abs(qty)
  if (kind === 'ADJUSTMENT') return qty
  return 0
}

/** On-hand is the sum of the ledger — never a stored number. */
export function stockOnHand(movements = []) {
  return movements.reduce((sum, m) => sum + (typeof m.quantity === 'number' ? m.quantity : movementDelta(m.kind, m.quantity)), 0)
}

/** Only a counted product can be below its safety stock; an uncounted one has no stock to compare. */
export function isBelowSafetyStock(product, onHand) {
  if (!product || product.stockPolicy !== 'TRACKED') return false
  return onHand < (product.safetyStock ?? 0)
}

/**
 * One summary row per product: on-hand, safety stock and the flag a
 * dashboard shows. `onHand` is null for an uncounted product so a page
 * cannot print a zero that reads as "measured and empty".
 */
export function stockSummaryRow(product, movements = []) {
  const tracked = product.stockPolicy === 'TRACKED'
  const onHand = tracked ? stockOnHand(movements) : null
  return {
    productId: product.id,
    code: product.code,
    name: product.name ?? null,
    stockPolicy: product.stockPolicy,
    trackingMode: product.trackingMode,
    unit: product.unit,
    safetyStock: product.safetyStock,
    onHand,
    belowSafetyStock: tracked ? isBelowSafetyStock(product, onHand) : false,
  }
}

/**
 * How many complete bundles the on-hand of its counted items allows. An
 * uncounted item never limits (its supply is not measured here); a bundle of
 * only uncounted items reports `null`, not infinity.
 */
export function bundleAvailability(items = [], onHandByProductId = {}) {
  let limit = null
  for (const item of items) {
    const onHand = onHandByProductId[item.productId]
    if (onHand === null || onHand === undefined) continue
    const sets = Math.max(0, Math.floor(onHand / Math.max(1, item.qty)))
    limit = limit === null ? sets : Math.min(limit, sets)
  }
  return limit
}

/**
 * Whether a movement is allowed against this product, answered by code so the
 * service refuses rather than records something the ledger cannot explain.
 */
export function movementRule(product, movement) {
  if (!product) return { ok: false, code: 'INVENTORY_PRODUCT_NOT_FOUND' }
  if (product.status === 'ARCHIVED') return { ok: false, code: 'INVENTORY_PRODUCT_ARCHIVED' }
  if (product.stockPolicy !== 'TRACKED') return { ok: false, code: 'INVENTORY_PRODUCT_UNTRACKED' }
  const serials = movement.serialNos ?? []
  if (product.trackingMode === 'SERIAL') {
    if (movement.kind === 'ADJUSTMENT') return { ok: false, code: 'INVENTORY_SERIAL_ADJUSTMENT_NOT_ALLOWED' }
    if (movement.kind === 'RECEIPT' && serials.length !== movement.quantity) return { ok: false, code: 'INVENTORY_SERIAL_COUNT_MISMATCH' }
    if (movement.kind === 'ISSUE' && serials.length !== movement.quantity) return { ok: false, code: 'INVENTORY_SERIAL_COUNT_MISMATCH' }
    if (new Set(serials).size !== serials.length) return { ok: false, code: 'INVENTORY_SERIAL_DUPLICATE' }
  } else if (serials.length) {
    return { ok: false, code: 'INVENTORY_SERIAL_NOT_TRACKED' }
  }
  if (product.trackingMode === 'LOT') {
    if (movement.kind === 'RECEIPT' && !movement.lotId && !movement.lotCode) return { ok: false, code: 'INVENTORY_LOT_REQUIRED' }
  } else if (product.trackingMode === 'NONE' && (movement.lotId || movement.lotCode)) {
    return { ok: false, code: 'INVENTORY_LOT_NOT_TRACKED' }
  }
  return { ok: true, code: null }
}

/** The serial-unit status a movement leaves behind, or null when it does not touch one. */
export function serialStatusAfter(kind) {
  if (kind === 'RECEIPT') return 'IN_STOCK'
  if (kind === 'ISSUE') return 'ISSUED'
  return null
}

export const INVENTORY_SERIAL_STATUS_SET = new Set(INVENTORY_SERIAL_STATUSES)

// ── FR-156 — recipe / bill of materials at a batch size ─────────────────────
// @req FR-156 — a recipe is the BOM of one output SKU at one `batchSize`:
//   "the recipe for 10 seats" and "for 20 seats" are two rows on one product,
//   exactly as a gift box has a BOM at 10 / 50 / 100 / 500 sets. Lines name
//   component SKUs with a quantity per batch; a `fixed` line (tooling, one
//   crate per batch) does not scale. The calculators here pick the recipe for
//   a quantity, explode it, compare the requirements with on-hand, and say how
//   many can be built — all pure, so a page and a build agree.
// @tested tests/unit/inventory-domain.test.js

export const PRODUCT_RECIPE_ENTITY = 'PRODUCT_RECIPE'

export const zRecipeLine = z.object({
  componentProductId: zId,
  qty: z.number().finite().positive(),
  unit: zOptionalText(20),
  fixed: z.boolean().optional(),
  note: zOptionalText(300),
}).strict()

export const zRecipeLines = z.array(zRecipeLine).min(1).max(200)
  .refine((lines) => new Set(lines.map((l) => l.componentProductId)).size === lines.length, 'a component appears once per recipe')

export const zCreateRecipe = z.object({
  businessId: zBusinessId,
  code: zInventoryCode,
  productId: zId,
  name: zText(200),
  batchSize: z.number().int().positive(),
  yieldQty: z.number().int().positive().optional(),
  unit: zText(20).optional(),
  notes: zOptionalText(2000),
  lines: zRecipeLines,
}).strict()

export const zRecipeFields = z.object({
  name: zText(200),
  yieldQty: z.number().int().positive(),
  unit: zText(20),
  notes: zOptionalText(2000),
  lines: zRecipeLines,
}).strict()

export const zRecipeAction = z.object({
  action: z.enum(INVENTORY_RECIPE_ACTIONS),
  version: z.number().int().positive(),
  fields: zRecipeFields.partial().strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.action === 'UPDATE' && (!value.fields || Object.keys(value.fields).length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fields'], message: 'fields is required for UPDATE' })
  }
})

export const zBuildRecipe = z.object({
  businessId: zBusinessId,
  quantity: z.number().int().positive(),
  outputLotCode: zInventoryCode.nullable().optional(),
  reason: zOptionalText(500),
  reference: zOptionalText(200),
  occurredAt: zDate.optional(),
}).strict()

const round4 = (n) => Math.round(n * 10000) / 10000

/**
 * The recipe to use for a quantity: the largest batch size that does not
 * exceed it (a 60-set order uses the 50-set BOM, scaled), else the smallest
 * one there is. Archived recipes never qualify. Null when none exist.
 */
export function pickRecipeForQuantity(recipes = [], quantity) {
  const active = recipes.filter((r) => r && r.status !== 'ARCHIVED' && Number.isFinite(r.batchSize) && r.batchSize > 0)
  if (!active.length) return null
  const fitting = active.filter((r) => r.batchSize <= quantity).sort((a, b) => b.batchSize - a.batchSize)
  if (fitting.length) return fitting[0]
  return active.slice().sort((a, b) => a.batchSize - b.batchSize)[0]
}

/** Explode a recipe to the quantity to build: scaled lines multiply, fixed lines do not. */
export function explodeRecipe(recipe, quantity) {
  const factor = quantity / recipe.batchSize
  return {
    recipeId: recipe.id,
    productId: recipe.productId,
    batchSize: recipe.batchSize,
    quantity,
    factor: round4(factor),
    producedQty: Math.round((quantity * (recipe.yieldQty ?? recipe.batchSize)) / recipe.batchSize),
    lines: (recipe.lines || []).map((line) => ({
      componentProductId: line.componentProductId,
      qty: line.qty,
      unit: line.unit ?? null,
      fixed: Boolean(line.fixed),
      required: line.fixed ? line.qty : round4(line.qty * factor),
    })),
  }
}

/**
 * The explosion compared with on-hand. A counted component reports its
 * shortage; an uncounted one (on-hand null) reports none and never blocks.
 * The ledger counts whole units, so a fractional requirement is issued as the
 * next whole one (`issueQty`).
 */
export function recipeRequirements(explosion, onHandByProductId = {}) {
  const lines = explosion.lines.map((line) => {
    const onHand = onHandByProductId[line.componentProductId]
    const counted = onHand !== null && onHand !== undefined
    const issueQty = Math.ceil(line.required - 1e-9)
    const shortage = counted ? Math.max(0, issueQty - onHand) : 0
    return { ...line, issueQty, onHand: counted ? onHand : null, shortage }
  })
  return { ...explosion, lines, canBuild: lines.every((l) => l.shortage === 0) }
}

/**
 * How many units the current on-hand allows this recipe to build: the
 * tightest scaled counted line limits proportionally, a fixed counted line
 * allows the batch or nothing, and an uncounted line never limits. Null when
 * no line is counted.
 */
export function maxBuildableQuantity(recipe, onHandByProductId = {}) {
  let limit = null
  for (const line of recipe.lines || []) {
    const onHand = onHandByProductId[line.componentProductId]
    if (onHand === null || onHand === undefined) continue
    const allows = line.fixed
      ? (onHand >= line.qty ? Number.POSITIVE_INFINITY : 0)
      : Math.floor((onHand / line.qty) * recipe.batchSize)
    limit = limit === null ? allows : Math.min(limit, allows)
  }
  if (limit === Number.POSITIVE_INFINITY) return null
  return limit
}

/**
 * FEFO — first expired, first out. Open lots ordered by expiry (unknown
 * expiry last), then by age, and the quantity taken from each until covered.
 * `remainder` is what no open lot could cover.
 */
export function allocateFefo(lots = [], quantity) {
  const ordered = lots
    .filter((lot) => lot && lot.status === 'OPEN' && lot.onHand > 0)
    .sort((a, b) => {
      const ea = a.expiresAt ? new Date(a.expiresAt).getTime() : Number.POSITIVE_INFINITY
      const eb = b.expiresAt ? new Date(b.expiresAt).getTime() : Number.POSITIVE_INFINITY
      if (ea !== eb) return ea - eb
      return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
    })
  const allocations = []
  let remainder = quantity
  for (const lot of ordered) {
    if (remainder <= 0) break
    const take = Math.min(lot.onHand, remainder)
    allocations.push({ lotId: lot.id, qty: take })
    remainder -= take
  }
  return { allocations, remainder }
}
