import {
  FACTORY_ENTITY, INVENTORY_CATEGORY_ENTITY, PRODUCT_BUNDLE_ENTITY, PRODUCT_ENTITY, PRODUCT_FAMILY_ENTITY, PRODUCT_MASTER_ENTITY,
  bundleAvailability, stockOnHand, zCreateBundle, zCreateCategory, zCreateFactory, zCreateFamily, zCreateProduct, zCreateProductMaster, zProductAction,
} from '../../../kernel/inventory/inventory.js'
import { weightedAverageUnitCostSatang } from '../../../kernel/inventory/inventory-costing.js'
import { archiveGuard, lookalikeFingerprint, mergeRule, natureRule, parseVariant, parseVariantAxes, productLifecycleRule, variantKeyFor, variantValues } from '../../../kernel/inventory/inventory-governance.js'
import { denied, inventoryAuthority } from '../../../infrastructure/delegation.js'
import { enqueueOutbox, recordAudit } from '../../../infrastructure/evidence.js'
import { appendMovement } from './stock-ledger.js'
import * as repo from '../adapters/catalog-repo.js'
import * as identityRepo from '../adapters/identity-repo.js'
import * as wipRepo from '../adapters/wip-repo.js'

// The Inventory catalogue writers (FR-154, FR-201, FR-202, FR-205, FR-207) inside
// SCM — port of apps/server inventory-catalog-service with the same codes, the
// same order of refusals and the same audit actions:
//   create  — category (slug unique per Business), family, factory, master (its
//             category/family/factory in the same Business; nature and axes fixed
//             here), SKU (master decides its nature; variant key unique per
//             master; lookalike guard unless `allowLookalike`, which is audited),
//             bundle (same-Business, non-archived SKUs).
//   actions — UPDATE (descriptive + replenishment fields; a corrected
//             description is re-keyed and re-checked), PHASE_OUT, REACTIVATE,
//             ARCHIVE (BR-040: no stock, no ACTIVE reservation) and MERGE (stock
//             moves for plain SKUs; identifiers, pack sizes, bundle items and
//             recipes follow the survivor; blocked by open work orders and BOMs
//             that would change meaning). The reservation count these guards read
//             is SCM's own StockReservation table, written by application/atp.js.
//   reads   — lists by code; the product page with recomputed on-hand and costing.
// Writing needs OWNER or `inventory.catalog.write`; reading needs the inventory
// domain; every refusal of scope is the same 404.

const failure = (status, code, details) => Object.assign(new Error(code), { status, code, retryable: false }, details === undefined ? {} : { details })

function parseSpecs(json) {
  try {
    const value = JSON.parse(json || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}
const masterDto = (row) => ({ ...row, specs: parseSpecs(row.specsJson), specsJson: undefined, variantAxes: parseVariantAxes(row.variantAxesJson), variantAxesJson: undefined })
export const productDto = (row) => (row ? { ...row, variant: parseVariant(row.variantJson), variantJson: undefined } : row)

const writer = (scope, businessId) => inventoryAuthority.require(scope, typeof businessId === 'string' ? businessId.trim() : '', { write: true })
const reader = (scope, businessId) => inventoryAuthority.require(scope, typeof businessId === 'string' ? businessId.trim() : '')

function evidence(sql, scope, { entityType, row, action, payload, ctx }) {
  recordAudit(sql, { entityType, entityId: row.id, action, actorId: scope.actorId, tenantId: row.tenantId, businessId: row.businessId, requestId: ctx.requestId, now: ctx.now, payload })
  enqueueOutbox(sql, { topic: `scm.inventory.${action.toLowerCase().replace(/_/g, '-')}`, aggregateType: entityType, aggregateId: row.id, aggregateVersion: row.version, now: ctx.now, payload: { businessId: row.businessId, code: row.code } })
}

function requireInBusiness(sql, model, id, businessId, code) {
  if (!id) return null
  const row = repo.scopedRef(sql, model, id)
  if (!row || row.businessId !== businessId) throw failure(422, code)
  return row
}

function createScoped(sql, scope, input, ctx, { entityType, action, schema, model, codeTakenMessage, columns, references, payload }) {
  const data = schema.parse(input)
  const business = writer(scope, data.businessId)
  if (repo.codeTaken(sql, model, business.tenantId, data.code)) throw failure(409, codeTakenMessage)
  if (references) references(data, business)
  const created = repo.insertRow(sql, model, { tenantId: business.tenantId, businessId: business.id, ...columns(data), createdAt: ctx.now, updatedAt: ctx.now })
  evidence(sql, scope, { entityType, row: created, action, payload: { businessId: business.id, code: created.code, ...(payload ? payload(created, data) : {}) }, ctx })
  return created
}

/** Create-command body schemas, so authorization runs after the same validation legacy runs first. */
export const CREATE_SCHEMAS = Object.freeze({ category: zCreateCategory, family: zCreateFamily, factory: zCreateFactory, master: zCreateProductMaster, product: zCreateProduct, bundle: zCreateBundle })

const outcome = (key, dto) => ({ response: { [key]: dto }, affected: { [`${key}Id`]: dto.id, code: dto.code, version: dto.version } })

export function createCategory(sql, scope, input, ctx) {
  return outcome('category', createScoped(sql, scope, input, ctx, {
    entityType: INVENTORY_CATEGORY_ENTITY, action: 'INVENTORY_CATEGORY_CREATED', schema: zCreateCategory, model: 'inventoryCategory', codeTakenMessage: 'INVENTORY_CATEGORY_CODE_TAKEN',
    columns: (d) => ({ code: d.code, nameTh: d.nameTh, nameEn: d.nameEn, slug: d.slug ?? null, vibe: d.vibe ?? null, targetRecipient: d.targetRecipient ?? null, guardrail: d.guardrail ?? null }),
    references: (d, business) => { if (d.slug && repo.slugTaken(sql, business.id, d.slug)) throw failure(409, 'INVENTORY_CATEGORY_SLUG_TAKEN') },
  }))
}

export function createFamily(sql, scope, input, ctx) {
  return outcome('family', createScoped(sql, scope, input, ctx, {
    entityType: PRODUCT_FAMILY_ENTITY, action: 'PRODUCT_FAMILY_CREATED', schema: zCreateFamily, model: 'productFamily', codeTakenMessage: 'PRODUCT_FAMILY_CODE_TAKEN',
    columns: (d) => ({ code: d.code, name: d.name, description: d.description ?? null }),
  }))
}

export function createFactory(sql, scope, input, ctx) {
  return outcome('factory', createScoped(sql, scope, input, ctx, {
    entityType: FACTORY_ENTITY, action: 'FACTORY_CREATED', schema: zCreateFactory, model: 'factory', codeTakenMessage: 'FACTORY_CODE_TAKEN',
    columns: (d) => ({ code: d.code, name: d.name, country: d.country ?? null, contact: d.contact ?? null }),
  }))
}

export function createProductMaster(sql, scope, input, ctx) {
  const row = createScoped(sql, scope, input, ctx, {
    entityType: PRODUCT_MASTER_ENTITY, action: 'PRODUCT_MASTER_CREATED', schema: zCreateProductMaster, model: 'productMaster', codeTakenMessage: 'PRODUCT_MASTER_CODE_TAKEN',
    references: (d, business) => {
      requireInBusiness(sql, 'inventoryCategory', d.categoryId, business.id, 'INVENTORY_CATEGORY_NOT_FOUND')
      requireInBusiness(sql, 'productFamily', d.familyId, business.id, 'PRODUCT_FAMILY_NOT_FOUND')
      requireInBusiness(sql, 'factory', d.factoryId, business.id, 'FACTORY_NOT_FOUND')
    },
    columns: (d) => ({
      code: d.code, categoryId: d.categoryId, familyId: d.familyId ?? null, factoryId: d.factoryId ?? null, nameTh: d.nameTh, nameEn: d.nameEn, baseCost: d.baseCost ?? 0, specsJson: JSON.stringify(d.specs ?? {}),
      nature: d.nature ?? 'GOOD',
      defaultStockPolicy: (d.nature ?? 'GOOD') === 'SERVICE' ? 'SERVICE' : (d.defaultStockPolicy ?? 'TRACKED'),
      variantAxesJson: JSON.stringify((d.nature ?? 'GOOD') === 'SERVICE' ? [] : (d.variantAxes ?? [])),
    }),
    payload: (created) => ({ categoryId: created.categoryId, familyId: created.familyId, factoryId: created.factoryId, nature: created.nature, variantAxes: parseVariantAxes(created.variantAxesJson) }),
  })
  return outcome('master', masterDto(row))
}

/** Variant key and lookalike fingerprint of a SKU under its master, with the refusals for incomplete values. */
function variantIdentity(master, fields) {
  const axes = parseVariantAxes(master.variantAxesJson)
  const { values, missing, extra } = variantValues(axes, fields)
  if (missing.length) throw failure(422, 'INVENTORY_VARIANT_AXES_INCOMPLETE', { axes, missing })
  if (extra.length) throw failure(422, 'INVENTORY_VARIANT_AXIS_UNKNOWN', { axes, unknown: extra })
  const variantKey = variantKeyFor(axes, values)
  return { axes, variant: values, variantKey, fingerprint: lookalikeFingerprint({ name: fields.name, color: fields.color, material: fields.material, variantKey }) }
}
const lookalikeOf = (sql, masterId, fingerprint, exceptId = null) => (fingerprint ? repo.liveUnderMaster(sql, masterId, exceptId).find((row) => lookalikeFingerprint(row) === fingerprint) ?? null : null)
const variantExists = (existing, variantKey) => failure(409, 'INVENTORY_PRODUCT_VARIANT_EXISTS', { existingProductId: existing.id, existingCode: existing.code, existingStatus: existing.status, variantKey })

export function createProduct(sql, scope, input, ctx) {
  const d = zCreateProduct.parse(input)
  const business = writer(scope, d.businessId)
  if (repo.codeTaken(sql, 'product', business.tenantId, d.code)) throw failure(409, 'PRODUCT_CODE_TAKEN')
  const master = repo.byId(sql, 'productMaster', d.productMasterId)
  if (!master || master.businessId !== business.id) throw failure(422, 'PRODUCT_MASTER_NOT_FOUND')
  if (master.status === 'ARCHIVED') throw failure(409, 'PRODUCT_MASTER_ARCHIVED')
  const nature = natureRule(master, d.stockPolicy)
  if (!nature.ok) throw failure(422, nature.code, { masterNature: master.nature, stockPolicy: d.stockPolicy })
  const stockPolicy = nature.stockPolicy
  const isService = stockPolicy === 'SERVICE'
  const identity = isService ? { axes: [], variant: {}, variantKey: null, fingerprint: lookalikeFingerprint({ name: d.name, color: d.color, material: d.material, variantKey: null }) } : variantIdentity(master, d)
  const existing = repo.variantHolder(sql, master.id, identity.variantKey)
  if (existing) throw variantExists(existing, identity.variantKey)
  const lookalike = lookalikeOf(sql, master.id, identity.fingerprint)
  if (lookalike && !d.allowLookalike) throw failure(409, 'INVENTORY_PRODUCT_LOOKALIKE', { existingProductId: lookalike.id, existingCode: lookalike.code })
  // Legacy relied on the (tenantId, flowAccountSku) unique index and surfaced a bare
  // database error; SCM refuses with the code setFlowAccountSku already uses (D-19).
  const flowHolder = d.flowAccountSku ? repo.flowAccountSkuHolder(sql, business.tenantId, d.flowAccountSku.trim()) : null
  if (flowHolder) throw failure(409, 'INVENTORY_FLOWACCOUNT_SKU_TAKEN', { flowAccountSku: d.flowAccountSku.trim(), takenBy: flowHolder.code })
  const created = repo.insertRow(sql, 'product', {
    tenantId: business.tenantId, businessId: business.id, code: d.code, productMasterId: master.id, name: d.name ?? null, color: d.color ?? null, material: d.material ?? null,
    unit: d.unit ?? 'EA', stockPolicy, trackingMode: stockPolicy !== 'TRACKED' ? 'NONE' : (d.trackingMode ?? 'NONE'),
    safetyStock: isService ? 0 : (d.safetyStock ?? 10), itemKind: d.itemKind ?? 'RAW_COMPONENT', flowAccountSku: d.flowAccountSku ?? null,
    dedicatedCustomerId: d.dedicatedCustomerId ?? null, dedicatedSalesOrderId: d.dedicatedSalesOrderId ?? null,
    maintenanceIntervalDays: d.maintenanceIntervalDays ?? null, maxStorageDays: d.maxStorageDays ?? null,
    variantJson: JSON.stringify(identity.variant), variantKey: identity.variantKey,
    reorderPoint: isService ? null : (d.reorderPoint ?? null), reorderQty: isService ? null : (d.reorderQty ?? null), leadTimeDays: isService ? null : (d.leadTimeDays ?? null),
    unitsPerCarton: isService ? null : (d.unitsPerCarton ?? null), cartonCbm: isService ? null : (d.cartonCbm ?? null), cartonKg: isService ? null : (d.cartonKg ?? null), freightGoodsType: isService ? null : (d.freightGoodsType ?? null),
    createdAt: ctx.now, updatedAt: ctx.now, version: 1,
  })
  evidence(sql, scope, {
    entityType: PRODUCT_ENTITY, row: created, action: 'PRODUCT_CREATED', ctx,
    payload: {
      businessId: business.id, code: created.code, productMasterId: created.productMasterId, stockPolicy: created.stockPolicy, trackingMode: created.trackingMode, itemKind: created.itemKind,
      dedicatedCustomerId: created.dedicatedCustomerId, dedicatedSalesOrderId: created.dedicatedSalesOrderId,
      masterNature: master.nature, variantKey: created.variantKey, ...(lookalike ? { allowLookalike: true, lookalikeOf: lookalike.id } : {}),
    },
  })
  return outcome('product', productDto(created))
}

export function createBundle(sql, scope, input, ctx) {
  const row = createScoped(sql, scope, input, ctx, {
    entityType: PRODUCT_BUNDLE_ENTITY, action: 'PRODUCT_BUNDLE_CREATED', schema: zCreateBundle, model: 'productBundle', codeTakenMessage: 'PRODUCT_BUNDLE_CODE_TAKEN',
    references: (d, business) => {
      for (const item of d.items) {
        const product = requireInBusiness(sql, 'product', item.productId, business.id, 'PRODUCT_NOT_FOUND')
        if (product.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')
      }
    },
    columns: (d) => ({ code: d.code, name: d.name, description: d.description ?? null, targetRecipients: d.targetRecipients ?? null, totalPrice: d.totalPrice ?? null }),
    payload: (created, d) => ({ items: d.items.map((item) => ({ productId: item.productId, qty: item.qty })) }),
  })
  // Items land in the same unit of work as the bundle and its audit row.
  repo.insertBundleItems(sql, row.id, zCreateBundle.parse(input).items)
  return outcome('bundle', { ...row, items: repo.bundleItemsOf(sql, row.id) })
}

const PRODUCT_ACTIONS = Object.freeze({ UPDATE: 'PRODUCT_UPDATED', ARCHIVE: 'PRODUCT_ARCHIVED', PHASE_OUT: 'PRODUCT_PHASED_OUT', REACTIVATE: 'PRODUCT_REACTIVATED', MERGE: 'PRODUCT_MERGED' })
const FIELDS = ['name', 'color', 'material', 'unit', 'safetyStock', 'reorderPoint', 'reorderQty', 'leadTimeDays', 'unitsPerCarton', 'cartonCbm', 'cartonKg', 'freightGoodsType']
const onHandOf = (sql, product) => (product.stockPolicy === 'TRACKED' ? Number(repo.onHandSum(sql, [product.id]).get(product.id) ?? 0) : null)

/**
 * Everything that would still point at the duplicate after a merge and that a
 * merge cannot re-point on its own (legacy mergeBlockers, same kinds and order).
 */
function mergeBlockers(sql, duplicate, survivor) {
  const blockers = []
  for (const item of repo.bundleItemsHolding(sql, duplicate.id)) {
    if (repo.bundleHolds(sql, item.bundleId, survivor.id)) blockers.push({ kind: 'BUNDLE_HOLDS_BOTH', bundleId: item.bundleId, code: item.bundleCode })
  }
  for (const line of wipRepo.recipeLinesNaming(sql, duplicate.id)) {
    if (line.recipeProductId === survivor.id) { blockers.push({ kind: 'RECIPE_OUTPUT_IS_SURVIVOR', recipeId: line.recipeId, code: line.recipeCode }); continue }
    if (wipRepo.recipeNames(sql, line.recipeId, survivor.id)) blockers.push({ kind: 'RECIPE_HOLDS_BOTH', recipeId: line.recipeId, code: line.recipeCode })
  }
  for (const recipe of wipRepo.recipesProducing(sql, duplicate.id)) {
    if (wipRepo.recipeNames(sql, recipe.id, survivor.id)) { blockers.push({ kind: 'RECIPE_COMPONENT_IS_SURVIVOR', recipeId: recipe.id, code: recipe.code }); continue }
    // Legacy checks only a live pair, but UNIQUE (productId, batchSize) also holds
    // archived rows, so there the re-point died on the constraint (F-15). SCM names
    // every pair the store would refuse, with the same kind (D-22).
    const clash = wipRepo.recipeAtBatch(sql, survivor.id, recipe.batchSize)
    if (clash) {
      const archivedPair = recipe.status === 'ARCHIVED' || clash.status === 'ARCHIVED'
      blockers.push({ kind: 'RECIPE_BATCH_SIZE_EXISTS', recipeId: recipe.id, code: recipe.code, batchSize: recipe.batchSize, ...(archivedPair ? { recipeStatus: recipe.status, survivorRecipeStatus: clash.status } : {}) })
    }
  }
  const customization = wipRepo.openCustomizationOrdersOf(sql, duplicate.id)
  if (customization) blockers.push({ kind: 'OPEN_CUSTOMIZATION_WORK_ORDERS', count: customization })
  const kitting = wipRepo.openKittingOrdersOf(sql, duplicate.id)
  if (kitting) blockers.push({ kind: 'OPEN_KITTING_WORK_ORDERS', count: kitting })
  return blockers
}

function repointReferences(sql, duplicate, survivor, now) {
  const identifiers = identityRepo.repointActiveIdentifiers(sql, duplicate.id, survivor.id, now)
  let conversions = 0
  let conversionsRetired = 0
  for (const conversion of identityRepo.conversionsOf(sql, duplicate.id, false)) {
    if (identityRepo.conversionByUnit(sql, survivor.id, conversion.unit) || conversion.unit === survivor.unit) {
      identityRepo.retireConversion(sql, conversion.id, now)
      conversionsRetired += 1
    } else {
      identityRepo.moveConversion(sql, conversion.id, survivor.id, now)
      conversions += 1
    }
  }
  const bundleItems = repo.repointBundleItems(sql, duplicate.id, survivor.id)
  const recipeLines = wipRepo.repointRecipeLines(sql, duplicate.id, survivor.id)
  const recipes = wipRepo.repointRecipes(sql, duplicate.id, survivor.id, now)
  return { identifiers, conversions, conversionsRetired, bundleItems, recipeLines, recipes }
}

/** The product a command targets, in the caller's Tenant, with Inventory write authority. */
export function loadProductForWrite(sql, scope, id) {
  const productId = typeof id === 'string' ? id.trim() : ''
  const row = productId ? repo.byId(sql, 'product', productId) : null
  if (!row || row.tenantId !== scope.tenantId) throw denied()
  writer(scope, row.businessId)
  return row
}

export function applyProductAction(sql, scope, id, input, ctx) {
  const data = zProductAction.parse(input)
  const row = loadProductForWrite(sql, scope, id)
  if (row.version !== data.version) throw failure(409, 'PRODUCT_VERSION_CONFLICT')
  const lifecycle = productLifecycleRule(row, data.action)
  if (!lifecycle.ok) throw failure(409, lifecycle.code)
  const change = {}
  const payload = { businessId: row.businessId, code: row.code, ...(data.reason ? { reason: data.reason } : {}) }
  let survivor = null
  if (data.action === 'UPDATE') {
    for (const key of FIELDS) if (data.fields[key] !== undefined) change[key] = data.fields[key]
    if (row.stockPolicy === 'SERVICE') {
      for (const key of ['safetyStock', 'reorderPoint', 'reorderQty', 'leadTimeDays', 'variant']) {
        if (data.fields[key] !== undefined && data.fields[key] !== null && data.fields[key] !== 0) throw failure(422, 'INVENTORY_PRODUCT_IS_A_SERVICE', { field: key })
      }
    } else if (data.fields.variant !== undefined || data.fields.name !== undefined || data.fields.color !== undefined || data.fields.material !== undefined) {
      const master = repo.byId(sql, 'productMaster', row.productMasterId)
      const merged = { name: data.fields.name ?? row.name, color: data.fields.color ?? row.color, material: data.fields.material ?? row.material, variant: data.fields.variant ?? parseVariant(row.variantJson) }
      const identity = variantIdentity(master, merged)
      const existing = repo.variantHolder(sql, master.id, identity.variantKey, row.id)
      if (existing) throw variantExists(existing, identity.variantKey)
      const lookalike = lookalikeOf(sql, master.id, identity.fingerprint, row.id)
      if (lookalike) throw failure(409, 'INVENTORY_PRODUCT_LOOKALIKE', { existingProductId: lookalike.id, existingCode: lookalike.code })
      change.variantJson = JSON.stringify(identity.variant)
      change.variantKey = identity.variantKey
      if (data.fields.variant !== undefined) payload.variant = { from: parseVariant(row.variantJson), to: identity.variant }
    }
    payload.fields = Object.keys(change).filter((k) => k !== 'variantJson')
  } else if (data.action === 'ARCHIVE') {
    // BR-040: a counted SKU with stock or a live promise stays.
    const onHand = onHandOf(sql, row)
    const guard = archiveGuard({ onHand, activeReservations: wipRepo.activeReservationCount(sql, row.id) })
    if (!guard.ok) throw failure(409, guard.code, { onHand })
    change.status = 'ARCHIVED'
    change.archivedAt = ctx.now
    Object.assign(payload, { from: { status: row.status }, to: { status: 'ARCHIVED' } })
  } else if (data.action === 'MERGE') {
    // FR-205 — the anti-bloat repair (ADR-083 D5).
    survivor = typeof data.into === 'string' ? repo.byId(sql, 'product', data.into) : null
    const onHand = onHandOf(sql, row)
    const rule = mergeRule(row, survivor, { onHand, activeReservations: wipRepo.activeReservationCount(sql, row.id) })
    if (!rule.ok) throw failure(rule.code === 'INVENTORY_MERGE_TARGET_NOT_FOUND' ? 422 : 409, rule.code, { onHand, into: data.into })
    const blockers = mergeBlockers(sql, row, survivor)
    if (blockers.length) throw failure(409, 'INVENTORY_MERGE_BLOCKED_BY_REFERENCES', blockers)
    let moved = 0
    if (rule.movesStock) {
      const reference = `MERGE:${row.code}`
      appendMovement(sql, scope, { businessId: row.businessId, productId: row.id, kind: 'ISSUE', quantity: onHand, reason: 'SKU_MERGE', reference, occurredAt: ctx.now, requestId: ctx.requestId }, { now: ctx.now })
      appendMovement(sql, scope, { businessId: row.businessId, productId: survivor.id, kind: 'RECEIPT', quantity: onHand, reason: 'SKU_MERGE', reference, occurredAt: ctx.now, requestId: ctx.requestId }, { now: ctx.now })
      moved = onHand
    }
    const repointed = repointReferences(sql, row, survivor, ctx.now)
    change.status = 'ARCHIVED'
    change.archivedAt = ctx.now
    change.mergedIntoProductId = survivor.id
    Object.assign(payload, { into: { productId: survivor.id, code: survivor.code }, movedQty: moved, repointed, from: { status: row.status }, to: { status: 'ARCHIVED' } })
  } else if (data.action === 'PHASE_OUT') {
    change.status = 'PHASE_OUT'
    Object.assign(payload, { from: { status: row.status }, to: { status: 'PHASE_OUT' }, onHand: onHandOf(sql, row) })
  } else if (data.action === 'REACTIVATE') {
    const master = repo.byId(sql, 'productMaster', row.productMasterId)
    if (master?.status === 'ARCHIVED') throw failure(409, 'PRODUCT_MASTER_ARCHIVED')
    change.status = 'ACTIVE'
    change.archivedAt = null
    Object.assign(payload, { from: { status: row.status }, to: { status: 'ACTIVE' } })
  }
  ctx.faults?.beforeProductUpdate?.()
  if (repo.casUpdateProduct(sql, { id: row.id, version: row.version, change, now: ctx.now }) !== 1) throw failure(409, 'PRODUCT_VERSION_CONFLICT')
  const fresh = repo.byId(sql, 'product', row.id)
  evidence(sql, scope, { entityType: PRODUCT_ENTITY, row: fresh, action: PRODUCT_ACTIONS[data.action], payload: { ...payload, version: row.version + 1 }, ctx })
  if (survivor) {
    const version = repo.bumpProductVersion(sql, survivor.id, ctx.now)
    evidence(sql, scope, { entityType: PRODUCT_ENTITY, row: { ...survivor, version }, action: 'PRODUCT_ABSORBED_MERGE', payload: { businessId: row.businessId, code: survivor.code, from: { productId: row.id, code: row.code }, movedQty: payload.movedQty, repointed: payload.repointed, version }, ctx })
  }
  return { response: { product: productDto(fresh) }, affected: { productId: fresh.id, version: fresh.version, status: fresh.status, ...(survivor ? { mergedIntoProductId: survivor.id } : {}) } }
}

// ── Reads ────────────────────────────────────────────────────────────────────
export const listCategories = (sql, scope, { businessId }) => repo.listOf(sql, 'inventoryCategory', reader(scope, businessId).id)
export const listFamilies = (sql, scope, { businessId }) => repo.listOf(sql, 'productFamily', reader(scope, businessId).id)
export const listFactories = (sql, scope, { businessId }) => repo.listOf(sql, 'factory', reader(scope, businessId).id)
export function listProductMasters(sql, scope, { businessId, categoryId, nature }) {
  const business = reader(scope, businessId)
  return repo.listOf(sql, 'productMaster', business.id, { ...(categoryId ? { categoryId } : {}), ...(nature ? { nature } : {}) }).map(masterDto)
}
export function listProducts(sql, scope, { businessId, ...filters }) {
  return repo.productsOf(sql, reader(scope, businessId).id, filters).map(productDto)
}
export function listBundles(sql, scope, { businessId }) {
  const business = reader(scope, businessId)
  const bundles = repo.listOf(sql, 'productBundle', business.id).map((b) => ({ ...b, items: repo.bundleItemsOf(sql, b.id) }))
  const productIds = [...new Set(bundles.flatMap((b) => b.items.map((i) => i.productId)))]
  if (!productIds.length) return bundles.map((b) => ({ ...b, availableSets: null }))
  const sums = repo.onHandSum(sql, productIds)
  const onHandByProductId = Object.fromEntries(productIds.map((id) => { const p = repo.byId(sql, 'product', id); return [id, p?.stockPolicy === 'TRACKED' ? (sums.get(id) ?? 0) : null] }))
  return bundles.map((b) => ({ ...b, availableSets: bundleAvailability(b.items, onHandByProductId) }))
}

/** The product page's Inventory half: the product, recomputed on-hand, receipt costing. */
export function getProduct(sql, scope, id) {
  const productId = typeof id === 'string' ? id.trim() : ''
  const row = productId ? repo.byId(sql, 'product', productId) : null
  if (!row || row.tenantId !== scope.tenantId) throw denied()
  reader(scope, row.businessId)
  const movements = repo.productMovements(sql, row.id)
  const receipts = movements.filter((m) => m.kind === 'RECEIPT')
  const latestWithCost = receipts.find((m) => m.costSatang !== null && m.costSatang !== undefined)
  return {
    ...productDto(row),
    onHand: row.stockPolicy === 'TRACKED' ? stockOnHand(movements) : null,
    costing: {
      weightedAverageLandedCostSatang: weightedAverageUnitCostSatang(receipts),
      lastReceiptCostSatang: latestWithCost ? latestWithCost.costSatang : null,
      costHistory: receipts.map((m) => ({ id: m.id, quantity: m.quantity, costSatang: m.costSatang ?? null, occurredAt: m.occurredAt, reference: m.reference ?? null })),
    },
  }
}
