import { z } from 'zod'
import prisma from '@/lib/db'
import { priceLandedInventoryQuote } from '@/modules/commerce'
// @req FR-253 — prices use the active Commerce rules, never local margin defaults.
import { CUSTOMIZATION_TECHNIQUES } from '@/lib/validation/enums'
import {
  assertMayView as assertMayViewInventory,
  availableToPromiseFor,
  createReservation,
  explodeRecipe,
  isFinishedSetSku,
  kittedUnitCostSatang,
  maxBuildableSets,
  openCustomizationWorkOrder,
  openKittingWorkOrder,
  releaseCustomizationWorkOrder,
  releaseKittingWorkOrder,
  productByFlowAccountSku,
  satangToBaht,
  shelfLifeAudit,
} from '@/modules/inventory'
import { createToolRegistry } from '../tools'
import { createWriteToolRegistry, STAFF_WRITE_ROLES } from '../write-tools'

// @req FR-181 — the six supply-chain tools an agent may call, and the only path
//   it has into this lane. Each one is a thin adapter: it takes the viewer the
//   caller already resolved, calls the same exported Inventory service a page
//   or a route would call, and returns its result. No tool queries Prisma for
//   business data, none assembles a scope from its own arguments, and none can
//   reach a Business the caller has not already proven — so a tool cannot hold
//   authority the service does not grant (SDD-091).
//
//   The split across the two registries is by effect. Reads go in the Gate E
//   registry, which refuses anything not `readOnly: true`. Writes go in the
//   Gate F registry, where `create_quote_stock_reservation` is LOW (a hold that
//   expires and can be released) while the two dispatches are HIGH — the action
//   gate then demands step-up, because an agent that reads "500" as "5000"
//   should meet a human before 4,500 tumblers are engraved (ADR-074 D9).
//
//   The Business's own system prompts — tone, Thai phrasing, what to say about
//   free delivery — are its agent configuration, not zuri-ai code. This file
//   ships the tools those prompts call.
// @spec ADR-074 D9; SDD-091; ADR-007 §P6, §P7; BR-027 (a quote never shows a
//   freight line); BR-031; BR-032
// @tested tests/integration/fr181-smartgift-agent-tools.test.js

const failure = (status, message) => Object.assign(new Error(message), { status })

/**
 * Default customization cost per technique, in satang: a one-off setup (a
 * laser jig, a screen, a foil die) and a per-piece run cost. Defaults, again —
 * a real job quotes from the workshop's own rates, and the quote says which
 * numbers it assumed.
 */
const TECHNIQUE_RATES = {
  LASER_ENGRAVING: { setupSatang: 80000, runSatang: 1200 },
  SILK_SCREEN: { setupSatang: 120000, runSatang: 900 },
  UV_DIGITAL_PRINT: { setupSatang: 60000, runSatang: 1800 },
  HOT_STAMP_FOIL: { setupSatang: 150000, runSatang: 1500 },
  EMBOSSING: { setupSatang: 150000, runSatang: 1400 },
}
/** Built from the enum, not beside it: a sixth technique gets a rate or an explicit zero, never silence. */
export const CUSTOMIZATION_DEFAULT_COSTS = Object.freeze({
  ...Object.fromEntries(CUSTOMIZATION_TECHNIQUES.map((technique) => [technique, TECHNIQUE_RATES[technique] ?? { setupSatang: 0, runSatang: 0 }])),
  NONE: { setupSatang: 0, runSatang: 0 },
})

/** The quote tool additionally accepts "no branding at all", which is not a technique. */
const QUOTE_TECHNIQUES = [...CUSTOMIZATION_TECHNIQUES, 'NONE']

/**
 * Destinations the flat single-drop truck does not reach: an island crossing
 * or a second drop is a different service, and ADR-009's own trade-off says it
 * is charged by the Commerce lane as its own line — never by reopening the
 * inventory valuation (BR-027).
 */
const REMOTE_DESTINATION_PATTERN = /(เกาะ|koh |ko samui|samui|phangan|tao|lipe|phi phi|เบตง|แม่ฮ่องสอน)/i

const zSkuCode = z.string().trim().min(1).max(120)

/**
 * The SKU a tool names, resolved inside the Business the caller already proved.
 * A customer says "TMS06-4(P-16)" — FlowAccount's code for the set, which lives
 * on `ExternalRef` (BR-002) — so that is tried first; our own `Product.code` is
 * the fallback, which is what an internal operator will type.
 */
async function resolveSku(db, businessId, skuCode) {
  const code = String(skuCode ?? '').trim()
  const byFlowAccount = isFinishedSetSku(code) ? await productByFlowAccountSku(db, businessId, code) : null
  const product = byFlowAccount ?? await db.product.findFirst({ where: { businessId, code } })
  if (!product) throw Object.assign(failure(404, 'INVENTORY_SKU_NOT_FOUND'), { details: { skuCode: code } })
  return product
}

/** The active recipe for a finished set, largest batch first, or null. */
async function recipeForProduct(db, productId) {
  const recipes = await db.productRecipe.findMany({
    where: { productId, status: { not: 'ARCHIVED' } },
    orderBy: [{ batchSize: 'desc' }],
    select: { id: true, code: true, businessId: true, productId: true, batchSize: true, yieldQty: true, status: true, scrapAllowanceFactor: true, lines: { select: { componentProductId: true, qty: true, unit: true, fixed: true }, orderBy: { id: 'asc' } } },
  })
  return recipes[0] ?? null
}

async function unitCostOf(db, productId) {
  const receipts = await db.stockMovement.findMany({ where: { productId, kind: 'RECEIPT' }, select: { quantity: true, costSatang: true } })
  if (!receipts.length) return null
  let quantity = 0n
  let totalCost = 0n
  for (const row of receipts) {
    if (!Number.isSafeInteger(row.quantity) || row.quantity <= 0 || !Number.isSafeInteger(row.costSatang) || row.costSatang < 0) throw failure(422, 'INVENTORY_COST_UNKNOWN')
    quantity += BigInt(row.quantity)
    totalCost += BigInt(row.quantity) * BigInt(row.costSatang)
  }
  const average = (totalCost + quantity - 1n) / quantity
  if (average > BigInt(Number.MAX_SAFE_INTEGER)) throw failure(422, 'INVENTORY_COST_UNKNOWN')
  return Number(average)
}

// ── The three read tools (Gate E) ───────────────────────────────────────────

export const zCheckInventoryAtp = z.object({
  skuCode: zSkuCode,
  targetQuantity: z.number().int().positive().optional(),
}).strict()

/**
 * What we can actually promise for a SKU right now. For a finished set this is
 * the buildable count from its bill of materials against ATP — never on-hand,
 * so two quotes cannot promise the same components (BR-031).
 */
export async function checkInventoryAtp(input, { viewer, businessId, db = prisma, now = new Date() } = {}) {
  const data = zCheckInventoryAtp.parse(input)
  const product = await resolveSku(db, businessId, data.skuCode)
  const target = data.targetQuantity ?? null
  const recipe = await recipeForProduct(db, product.id)

  const own = await availableToPromiseFor({ businessId, productIds: [product.id], viewer, db, now })
  const stocked = own.products[0] ?? null

  if (!recipe) {
    const available = stocked?.available ?? null
    return {
      skuCode: product.code,
      productId: product.id,
      itemKind: product.itemKind,
      onHand: stocked?.onHand ?? null,
      committed: stocked?.committed ?? 0,
      reservedForQuotes: stocked?.reservedForQuotes ?? 0,
      available,
      maxBuildable: null,
      targetQuantity: target,
      canPromise: target === null ? null : available !== null && available >= target,
      components: [],
    }
  }

  const build = await maxBuildableSets({ businessId, recipeId: recipe.id, quantity: target ?? recipe.batchSize, viewer, db, now })
  const fromStock = stocked?.available ?? 0
  const maxBuildable = build.maxBuildable === null ? null : build.maxBuildable + fromStock
  return {
    skuCode: product.code,
    productId: product.id,
    itemKind: product.itemKind,
    onHand: stocked?.onHand ?? null,
    committed: stocked?.committed ?? 0,
    reservedForQuotes: stocked?.reservedForQuotes ?? 0,
    available: fromStock,
    // Finished sets already on the shelf PLUS sets the free components allow.
    maxBuildable,
    targetQuantity: target,
    canPromise: target === null ? null : (maxBuildable === null || maxBuildable >= target),
    recipeId: recipe.id,
    components: build.lines,
  }
}

export const zCalculateQuote = z.object({
  skuCode: zSkuCode,
  quantity: z.number().int().positive(),
  customization: z.object({
    technique: z.enum(QUOTE_TECHNIQUES).optional(),
    locationsCount: z.number().int().nonnegative().max(20).optional(),
    setupCostSatang: z.number().int().nonnegative().optional(),
    runCostSatang: z.number().int().nonnegative().optional(),
  }).strict().optional(),
  deliveryDestination: z.string().trim().max(200).optional(),
  inboundTruckSatang: z.number().int().nonnegative().optional(),
}).strict()

/**
 * A tiered corporate quote whose freight is ALREADY IN the unit price. The
 * result always carries both `freightSatang: 0` (what the customer is charged)
 * and `freightAbsorbedSatang` (additional order delivery cost only). Original
 * inbound freight is embedded in ledger cost; its separate amount is unknown.
 * No customer freight line is introduced (BR-027).
 */
export async function calculateSmartgiftQuote(input, { viewer, businessId, db = prisma } = {}) {
  const data = zCalculateQuote.parse(input)
  assertMayViewInventory(viewer, businessId)
  const product = await resolveSku(db, businessId, data.skuCode)
  const assumptions = []

  // Cost basis: what the set itself has cost when it has been built before,
  // otherwise the sum of its components' landed costs.
  let baseCostSatang = await unitCostOf(db, product.id)
  const recipe = await recipeForProduct(db, product.id)
  if (baseCostSatang === null && recipe) {
    const explosion = explodeRecipe(recipe, recipe.batchSize)
    const components = []
    for (const line of explosion.lines) {
      components.push({ productId: line.componentProductId, unitCostSatang: await unitCostOf(db, line.componentProductId), qtyPerSet: line.qty / recipe.batchSize })
    }
    const blended = kittedUnitCostSatang({ components, laborCostSatang: 0, batchQty: 1 })
    baseCostSatang = blended.unitCostSatang
    if (!blended.complete) throw failure(422, 'INVENTORY_COST_UNKNOWN')
  }
  if (baseCostSatang === null) {
    throw Object.assign(failure(422, 'INVENTORY_COST_UNKNOWN'), { details: { skuCode: product.code } })
  }

  const priced = await priceLandedInventoryQuote({
    businessId, quantity: data.quantity, productId: product.id, baseCostSatang,
    kind: product.itemKind === 'FINISHED_SET' ? 'set' : 'single',
    customization: data.customization, inboundTruckSatang: data.inboundTruckSatang,
  }, { viewer, db })
  const { unitCostSatang, freightPerUnit } = priced
  const { unitPriceSatang, totalPriceSatang } = priced.result
  const inboundTruckSatang = priced.freightAbsorbedSatang
  assumptions.push(...priced.warnings)
  const remote = Boolean(data.deliveryDestination && REMOTE_DESTINATION_PATTERN.test(data.deliveryDestination))
  if (remote) assumptions.push('REMOTE_DESTINATION: an island or far-province drop is a separate Commerce surcharge line; the flat single-drop truck does not cover it')

  return {
    skuCode: product.code,
    productId: product.id,
    quantity: data.quantity,
    tier: String(data.quantity),
    ruleSetId: priced.ruleSetId,
    ruleVersion: priced.ruleRevision,
    ruleHash: priced.result.ruleHash,
    inputHash: priced.result.inputHash,
    priceDriver: priced.result.priceDriver,
    unitCostSatang,
    unitPriceSatang,
    totalPriceSatang,
    unitPriceThb: satangToBaht(unitPriceSatang),
    totalPriceThb: satangToBaht(totalPriceSatang),
    // BR-027 — customer freight stays zero. Absorbed freight here measures
    // only an explicit additional delivery, never the unknown embedded amount.
    freightSatang: 0,
    freightAbsorbedSatang: inboundTruckSatang,
    freightCostBasis: priced.freightCostBasis,
    embeddedFreightSatang: priced.embeddedFreightSatang,
    freightNote: priced.freightCostBasis === 'ADDITIONAL_DELIVERY'
      ? 'ฟรีค่าจัดส่งแบบจุดเดียวเหมาคัน (รวมค่าจัดส่งเพิ่มเติมที่ระบุในราคาต่อหน่วยแล้ว; ไม่ทราบยอดค่าขนส่งเดิมที่รวมในต้นทุนรับเข้า)'
      : 'ฟรีค่าจัดส่งแบบจุดเดียวเหมาคัน (ใช้ต้นทุนรับเข้าที่รวมค่าขนส่งแล้ว; ไม่ทราบยอดค่าขนส่งแยกและไม่ได้บวกซ้ำ)',
    remoteSurchargeRequired: remote,
    customization: priced.customization,
    breakdown: { base: baseCostSatang, freightPerUnit, customizationPerUnit: priced.customization.perUnitSatang },
    vatIncluded: false,
    assumptions,
  }
}

export const zAuditBatteryLots = z.object({
  thresholdDays: z.number().int().positive().max(3650).optional(),
  includeEmpty: z.boolean().optional(),
}).strict()

/** Lots due for maintenance or past their storage limit (FR-179). */
export async function auditBatteryLots(input, { viewer, businessId, db = prisma, now = new Date() } = {}) {
  const data = zAuditBatteryLots.parse(input ?? {})
  return shelfLifeAudit({ businessId, thresholdDays: data.thresholdDays ?? 180, includeEmpty: data.includeEmpty ?? false, viewer, db, now })
}

// ── The three write actions (Gate F) ────────────────────────────────────────

export const zCreateQuoteReservation = z.object({
  skuCode: zSkuCode,
  quantity: z.number().int().positive(),
  customerName: z.string().trim().max(200).optional(),
  customerCompany: z.string().trim().max(200).optional(),
  contactPhoneOrLine: z.string().trim().max(200).optional(),
  customerId: z.string().trim().max(200).nullable().optional(),
  quoteReference: z.string().trim().max(200).optional(),
  holdDays: z.number().int().positive().max(90).optional(),
  notes: z.string().trim().max(2000).optional(),
}).strict()

/**
 * Hold the components a quote needs for seven days. For a finished set the
 * hold lands on the COMPONENTS the set would be built from, not on the set —
 * the sets do not exist yet, and holding a phantom would be a promise against
 * nothing.
 */
export async function createQuoteStockReservation(input, { viewer, businessId, db = prisma, now = new Date() } = {}) {
  const data = zCreateQuoteReservation.parse(input)
  const product = await resolveSku(db, businessId, data.skuCode)
  const recipe = await recipeForProduct(db, product.id)
  const contact = [data.customerName, data.contactPhoneOrLine].filter(Boolean).join(' / ') || null
  const shared = {
    businessId,
    purpose: 'QUOTE',
    customerId: data.customerId ?? null,
    quoteReference: data.quoteReference ?? null,
    customerCompany: data.customerCompany ?? null,
    contactHandle: contact,
    holdDays: data.holdDays,
    notes: data.notes ?? null,
  }

  if (!recipe) {
    const reservation = await createReservation({ ...shared, productId: product.id, quantity: data.quantity }, { viewer, db, now })
    return { skuCode: product.code, quantity: data.quantity, holdsOn: 'SKU', reservations: [reservation], expiresAt: reservation.expiresAt }
  }

  const explosion = explodeRecipe(recipe, data.quantity)
  const reservations = []
  for (const line of explosion.lines) {
    const qty = Math.ceil(line.required - 1e-9)
    if (qty <= 0) continue
    reservations.push(await createReservation({ ...shared, productId: line.componentProductId, quantity: qty }, { viewer, db, now }))
  }
  return {
    skuCode: product.code,
    quantity: data.quantity,
    holdsOn: 'COMPONENTS',
    recipeId: recipe.id,
    reservations,
    expiresAt: reservations[0]?.expiresAt ?? null,
  }
}

export const zDispatchCustomization = z.object({
  rawComponentSku: zSkuCode,
  technique: z.enum(CUSTOMIZATION_TECHNIQUES),
  netQuantity: z.number().int().positive(),
  salesOrderId: z.string().trim().max(200).nullable().optional(),
  customerId: z.string().trim().max(200).nullable().optional(),
  scrapAllowancePercent: z.number().finite().min(0).max(0.2).optional(),
  logoArtworkUrl: z.string().trim().max(1000).optional(),
  pantoneColors: z.array(z.string().trim().max(40)).max(20).optional(),
  sourceLocationCode: z.string().trim().max(64).optional(),
  wipLocationCode: z.string().trim().max(64).optional(),
  scrapLocationCode: z.string().trim().max(64).optional(),
  setupCostSatang: z.number().int().nonnegative().optional(),
  runCostSatang: z.number().int().nonnegative().optional(),
}).strict()

async function locationIdByCode(db, businessId, code) {
  if (!code) return null
  const row = await db.warehouseLocation.findFirst({ where: { businessId, code: code.trim() }, select: { id: true } })
  if (!row) throw Object.assign(failure(422, 'WAREHOUSE_LOCATION_NOT_FOUND'), { details: { code } })
  return row.id
}

/** Open a customization work order and release it to the workshop. Irreversible from here. */
export async function dispatchCustomizationWorkOrder(input, { viewer, businessId, db = prisma, now = new Date() } = {}) {
  const data = zDispatchCustomization.parse(input)
  const raw = await resolveSku(db, businessId, data.rawComponentSku)
  const defaults = CUSTOMIZATION_DEFAULT_COSTS[data.technique] ?? CUSTOMIZATION_DEFAULT_COSTS.NONE
  const order = await openCustomizationWorkOrder({
    businessId,
    rawProductId: raw.id,
    technique: data.technique,
    netQuantity: data.netQuantity,
    scrapAllowanceFactor: data.scrapAllowancePercent ?? 0.02,
    customerId: data.customerId ?? null,
    salesOrderId: data.salesOrderId ?? null,
    logoArtworkUrl: data.logoArtworkUrl ?? null,
    pantoneColors: data.pantoneColors,
    setupCostSatang: data.setupCostSatang ?? defaults.setupSatang,
    runCostSatang: data.runCostSatang ?? defaults.runSatang,
    sourceLocationId: await locationIdByCode(db, businessId, data.sourceLocationCode),
    wipLocationId: await locationIdByCode(db, businessId, data.wipLocationCode),
    scrapLocationId: await locationIdByCode(db, businessId, data.scrapLocationCode),
  }, { viewer, db, now })
  const released = await releaseCustomizationWorkOrder(order.id, { businessId, version: order.version }, { viewer, db, now })
  return { workOrder: released, rawSkuCode: raw.code, grossIssueQty: released.issuedQty, scrapBufferQty: released.issuedQty - released.plannedQty }
}

export const zDispatchKitting = z.object({
  finishedSkuCode: zSkuCode,
  quantity: z.number().int().positive(),
  salesOrderId: z.string().trim().max(200).nullable().optional(),
  customerId: z.string().trim().max(200).nullable().optional(),
  outputLotCode: z.string().trim().max(64).optional(),
  laborCostSatang: z.number().int().nonnegative().optional(),
  sourceLocationCode: z.string().trim().max(64).optional(),
  wipLocationCode: z.string().trim().max(64).optional(),
  targetLocationCode: z.string().trim().max(64).optional(),
  scrapLocationCode: z.string().trim().max(64).optional(),
}).strict()

/** Explode the BOM and stage the assembly line. */
export async function dispatchKittingWorkOrder(input, { viewer, businessId, db = prisma, now = new Date() } = {}) {
  const data = zDispatchKitting.parse(input)
  const finished = await resolveSku(db, businessId, data.finishedSkuCode)
  const recipe = await recipeForProduct(db, finished.id)
  if (!recipe) throw Object.assign(failure(422, 'PRODUCT_RECIPE_NOT_FOUND'), { details: { skuCode: finished.code } })

  const order = await openKittingWorkOrder({
    businessId,
    recipeId: recipe.id,
    plannedQty: data.quantity,
    customerId: data.customerId ?? null,
    salesOrderId: data.salesOrderId ?? null,
    laborCostSatang: data.laborCostSatang ?? 0,
    outputLotCode: data.outputLotCode ?? null,
    sourceLocationId: await locationIdByCode(db, businessId, data.sourceLocationCode),
    wipLocationId: await locationIdByCode(db, businessId, data.wipLocationCode),
    targetLocationId: await locationIdByCode(db, businessId, data.targetLocationCode),
    scrapLocationId: await locationIdByCode(db, businessId, data.scrapLocationCode),
  }, { viewer, db, now })
  const released = await releaseKittingWorkOrder(order.id, { businessId, version: order.version }, { viewer, db, now })
  return { workOrder: released, finishedSkuCode: finished.code, recipeId: recipe.id, plannedLines: released.plannedLines }
}

// ── Registries ──────────────────────────────────────────────────────────────

/**
 * The Gate E registry for this lane. `viewer` and `businessId` are bound at
 * registration, not taken from tool arguments: a model that could name its own
 * Business would be choosing its own scope.
 */
export function smartgiftReadTools({ viewer, businessId, db = prisma, now = () => new Date() } = {}) {
  const registry = createToolRegistry()
  const ctx = () => ({ viewer, businessId, db, now: now() })

  registry.register({
    name: 'check_inventory_atp',
    readOnly: true,
    description: 'Available-to-Promise for a SKU, and how many complete gift sets its components still allow.',
    parameters: zCheckInventoryAtp,
    handler: (args) => checkInventoryAtp(args, ctx()),
  })
  registry.register({
    name: 'calculate_smartgift_quote',
    readOnly: true,
    description: 'Tiered corporate quote from landed cost, with the flat single-drop truck absorbed into the unit price (delivery shows as 0.00).',
    parameters: zCalculateQuote,
    handler: (args) => calculateSmartgiftQuote(args, ctx()),
  })
  registry.register({
    name: 'audit_battery_lots',
    readOnly: true,
    description: 'Lots due for maintenance or past their storage limit — power banks needing a storage-voltage recharge before dispatch.',
    parameters: zAuditBatteryLots,
    handler: (args) => auditBatteryLots(args ?? {}, ctx()),
  })
  return registry
}

/**
 * The Gate F registry for this lane. `execute` receives the gate's own
 * transaction and passes it straight down as `db`, so the write, the step-up
 * consumption and the AGENT_ACTION audit all commit or roll back together.
 */
export function smartgiftWriteTools({ viewer, businessId, now = () => new Date() } = {}) {
  const registry = createWriteToolRegistry()
  const scopeOf = (target) => target?.businessId ?? businessId

  registry.register({
    name: 'create_quote_stock_reservation',
    effect: 'WRITE',
    sensitivity: 'LOW',
    allowRoles: STAFF_WRITE_ROLES,
    description: 'Hold the components a quoted gift set needs for 7 days, so two quotes cannot promise the same stock.',
    parameters: zCreateQuoteReservation,
    execute: ({ tx, target, payload }) => createQuoteStockReservation(payload, { viewer, businessId: scopeOf(target), db: tx, now: now() }),
  })
  registry.register({
    name: 'dispatch_customization_work_order',
    effect: 'WRITE',
    // HIGH: this issues real stock and dedicates its output to one customer
    // irreversibly (BR-028). Step-up is the point.
    sensitivity: 'HIGH',
    allowRoles: STAFF_WRITE_ROLES,
    description: 'Open and release a laser/screen work order, issuing the net quantity plus its declared scrap buffer.',
    parameters: zDispatchCustomization,
    execute: ({ tx, target, payload }) => dispatchCustomizationWorkOrder(payload, { viewer, businessId: scopeOf(target), db: tx, now: now() }),
  })
  registry.register({
    name: 'dispatch_kitting_work_order',
    effect: 'WRITE',
    sensitivity: 'HIGH',
    allowRoles: STAFF_WRITE_ROLES,
    description: 'Explode a finished gift set\'s bill of materials and stage the assembly line.',
    parameters: zDispatchKitting,
    execute: ({ tx, target, payload }) => dispatchKittingWorkOrder(payload, { viewer, businessId: scopeOf(target), db: tx, now: now() }),
  })
  return registry
}

/**
 * The JSON-schema shape a model is shown, generated from the SAME Zod contracts
 * the services parse — so a tool can never advertise a shape the service would
 * reject (SDD-091). Kept deliberately small: name, description, and the
 * required/optional field names, which is what a tool-calling API needs and
 * all a prompt should have to read.
 */
export function smartgiftToolDefinitions() {
  const describe = (name, description, schema, effect) => {
    const shape = schema._def?.shape?.() ?? {}
    return {
      name,
      description,
      effect,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(Object.keys(shape).map((key) => [key, { description: key }])),
        required: Object.entries(shape).filter(([, value]) => !value.isOptional?.()).map(([key]) => key),
      },
    }
  }
  return [
    describe('check_inventory_atp', 'Available-to-Promise for a SKU and the sets its components allow.', zCheckInventoryAtp, 'READ'),
    describe('calculate_smartgift_quote', 'Tiered corporate quote with absorbed single-drop freight.', zCalculateQuote, 'READ'),
    describe('audit_battery_lots', 'Lots due for maintenance or past their storage limit.', zAuditBatteryLots, 'READ'),
    describe('create_quote_stock_reservation', 'Hold components for a quote for 7 days.', zCreateQuoteReservation, 'WRITE'),
    describe('dispatch_customization_work_order', 'Open and release a customization work order.', zDispatchCustomization, 'WRITE'),
    describe('dispatch_kitting_work_order', 'Explode a BOM and stage assembly.', zDispatchKitting, 'WRITE'),
  ]
}
