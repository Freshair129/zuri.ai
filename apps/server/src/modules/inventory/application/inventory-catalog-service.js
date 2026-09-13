import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import {
  FACTORY_ENTITY,
  INVENTORY_CATEGORY_ENTITY,
  PRODUCT_BUNDLE_ENTITY,
  PRODUCT_ENTITY,
  PRODUCT_FAMILY_ENTITY,
  PRODUCT_MASTER_ENTITY,
  bundleAvailability,
  stockOnHand,
  zCreateBundle,
  zCreateCategory,
  zCreateFactory,
  zCreateFamily,
  zCreateProduct,
  zCreateProductMaster,
  zProductAction,
} from '../domain/inventory'
import { FINISHED_SET_SKU_PATTERN, isFinishedSetSku } from '../domain/inventory-costing'
import {
  archiveGuard,
  lookalikeFingerprint,
  mergeRule,
  natureRule,
  parseVariant,
  parseVariantAxes,
  productLifecycleRule,
  variantKeyFor,
  variantValues,
} from '../domain/inventory-governance'
import { assertMayView, loadBusiness, notFound } from './inventory-authority'
import { appendMovement } from './inventory-stock-service'

// @req FR-154 — the only writer of the Inventory catalogue: category, family,
//   factory, product master, product (SKU) and bundle. Every create derives
//   `tenantId` from the Business the trusted viewer may manage, refuses a
//   duplicate `code` per Tenant by code, checks that every referenced row
//   (category, family, factory, master, bundle item product) belongs to the
//   same Business, runs in one transaction and appends one audit row. A
//   product's `stockPolicy` and `trackingMode` are fixed at creation: the
//   ledger's meaning depends on them, so they are not editable after the
//   first movement could exist. `UPDATE` edits the descriptive fields and the
//   safety stock; `ARCHIVE` keeps the row. Nothing is ever deleted.
// @req FR-201 — a master declares its nature once; a SKU's policy is derived
//   from it and a request that disagrees is refused (`INVENTORY_NATURE_MISMATCH`).
//   A service SKU is stored with no stock fields (BR-038).
// @req FR-202 — a SKU's variant values on the master's axes yield its
//   `variantKey`, unique per master (`INVENTORY_PRODUCT_VARIANT_EXISTS` names
//   the row that already is that variant, archived or not); for masters that
//   declare no axes the exact-match lookalike guard refuses a second SKU that
//   describes the same thing (`INVENTORY_PRODUCT_LOOKALIKE`) unless the caller
//   says `allowLookalike`, which the audit row records (BR-039).
// @req FR-205 — the lifecycle actions: PHASE_OUT, REACTIVATE, the ARCHIVE
//   guard (BR-040: no stock, no live promise), and MERGE — the duplicate's
//   stock moves to the survivor through the ledger, its identifiers, unit
//   conversions, bundle items and recipe lines are re-pointed, and it ends
//   ARCHIVED with `mergedIntoProductId` set. Nothing is deleted.
// @req FR-207 — the replenishment parameters are set at creation or by UPDATE.
// @spec BR-002 (codes are attributes, unique per Tenant, never keys); SEC-001; FR-072;
//   ADR-083 D1, D2, D5, D6; BR-037, BR-038, BR-039, BR-040
// @tested tests/integration/fr154-inventory-catalog.test.js,
//   tests/integration/fr201-inventory-sku-governance.test.js

const failure = (status, message) => Object.assign(new Error(message), { status })

const CATEGORY_SELECT = { id: true, code: true, tenantId: true, businessId: true, nameTh: true, nameEn: true, slug: true, vibe: true, targetRecipient: true, guardrail: true, status: true, createdAt: true, updatedAt: true, version: true }
const FAMILY_SELECT = { id: true, code: true, tenantId: true, businessId: true, name: true, description: true, status: true, createdAt: true, updatedAt: true, version: true }
const FACTORY_SELECT = { id: true, code: true, tenantId: true, businessId: true, name: true, country: true, contact: true, status: true, createdAt: true, updatedAt: true, version: true }
const MASTER_SELECT = { id: true, code: true, tenantId: true, businessId: true, categoryId: true, familyId: true, factoryId: true, nameTh: true, nameEn: true, baseCost: true, specsJson: true, nature: true, defaultStockPolicy: true, variantAxesJson: true, status: true, createdAt: true, updatedAt: true, version: true }
const PRODUCT_SELECT = {
  id: true, code: true, tenantId: true, businessId: true, productMasterId: true, name: true, color: true, material: true, unit: true, stockPolicy: true, trackingMode: true, safetyStock: true, status: true, archivedAt: true, createdAt: true, updatedAt: true, version: true,
  itemKind: true, dedicatedCustomerId: true, dedicatedSalesOrderId: true, maintenanceIntervalDays: true, maxStorageDays: true, flowAccountSku: true,
  variantJson: true, variantKey: true, mergedIntoProductId: true, reorderPoint: true, reorderQty: true, leadTimeDays: true,
}
const BUNDLE_SELECT = { id: true, code: true, tenantId: true, businessId: true, name: true, description: true, targetRecipients: true, totalPrice: true, status: true, createdAt: true, updatedAt: true, version: true, items: { select: { id: true, productId: true, qty: true }, orderBy: { id: 'asc' } } }

function parseSpecs(json) {
  try {
    const value = JSON.parse(json || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

const masterDto = (row) => ({ ...row, specs: parseSpecs(row.specsJson), specsJson: undefined, variantAxes: parseVariantAxes(row.variantAxesJson), variantAxesJson: undefined })
const productDto = (row) => row ? ({ ...row, variant: parseVariant(row.variantJson), variantJson: undefined }) : row
const actor = (viewer) => viewer?.principal?.id ?? null

async function assertCodeFree(tx, model, tenantId, code, message) {
  const taken = await tx[model].findUnique({ where: { tenantId_code: { tenantId, code } }, select: { id: true } })
  if (taken) throw failure(409, message)
}

/** A referenced row must exist in the same Business, or the reference is refused by code. */
async function requireInBusiness(tx, model, id, businessId, message) {
  if (!id) return null
  const row = await tx[model].findUnique({ where: { id }, select: { id: true, businessId: true, status: true } })
  if (!row || row.businessId !== businessId) throw failure(422, message)
  return row
}

async function createScoped(entityType, action, { input, schema, model, select, codeTaken, viewer, db, columns, payload, references }) {
  const data = schema.parse(input)
  const row = await db.$transaction(async (tx) => {
    const business = await loadBusiness(tx, viewer, data.businessId, { write: true })
    await assertCodeFree(tx, model, business.tenantId, data.code, codeTaken)
    if (references) await references(tx, data, business)
    const created = await tx[model].create({ data: { tenantId: business.tenantId, businessId: business.id, ...columns(data) }, select })
    await recordAudit(tx, { entityType, entityId: created.id, action, actorId: actor(viewer), payload: { businessId: business.id, code: created.code, ...(payload ? payload(created, data) : {}) } })
    return created
  })
  return row
}

async function listScoped({ model, select, businessId, viewer, db, where = {}, orderBy = [{ code: 'asc' }] }) {
  const business = await loadBusiness(db, viewer, businessId)
  return db[model].findMany({ where: { businessId: business.id, ...where }, orderBy, select })
}

// ── Category ────────────────────────────────────────────────────────────────

export function createCategory(input, { viewer, db = prisma } = {}) {
  return createScoped(INVENTORY_CATEGORY_ENTITY, 'INVENTORY_CATEGORY_CREATED', {
    input, schema: zCreateCategory, model: 'inventoryCategory', select: CATEGORY_SELECT, codeTaken: 'INVENTORY_CATEGORY_CODE_TAKEN', viewer, db,
    columns: (d) => ({ code: d.code, nameTh: d.nameTh, nameEn: d.nameEn, slug: d.slug ?? null, vibe: d.vibe ?? null, targetRecipient: d.targetRecipient ?? null, guardrail: d.guardrail ?? null }),
    references: async (tx, d, business) => {
      if (!d.slug) return
      const taken = await tx.inventoryCategory.findFirst({ where: { businessId: business.id, slug: d.slug }, select: { id: true } })
      if (taken) throw failure(409, 'INVENTORY_CATEGORY_SLUG_TAKEN')
    },
  })
}

export function listCategories({ businessId, viewer, db = prisma } = {}) {
  return listScoped({ model: 'inventoryCategory', select: CATEGORY_SELECT, businessId, viewer, db })
}

// ── Family ──────────────────────────────────────────────────────────────────

export function createFamily(input, { viewer, db = prisma } = {}) {
  return createScoped(PRODUCT_FAMILY_ENTITY, 'PRODUCT_FAMILY_CREATED', {
    input, schema: zCreateFamily, model: 'productFamily', select: FAMILY_SELECT, codeTaken: 'PRODUCT_FAMILY_CODE_TAKEN', viewer, db,
    columns: (d) => ({ code: d.code, name: d.name, description: d.description ?? null }),
  })
}

export function listFamilies({ businessId, viewer, db = prisma } = {}) {
  return listScoped({ model: 'productFamily', select: FAMILY_SELECT, businessId, viewer, db })
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createFactory(input, { viewer, db = prisma } = {}) {
  return createScoped(FACTORY_ENTITY, 'FACTORY_CREATED', {
    input, schema: zCreateFactory, model: 'factory', select: FACTORY_SELECT, codeTaken: 'FACTORY_CODE_TAKEN', viewer, db,
    columns: (d) => ({ code: d.code, name: d.name, country: d.country ?? null, contact: d.contact ?? null }),
  })
}

export function listFactories({ businessId, viewer, db = prisma } = {}) {
  return listScoped({ model: 'factory', select: FACTORY_SELECT, businessId, viewer, db })
}

// ── Product master ──────────────────────────────────────────────────────────

export async function createProductMaster(input, { viewer, db = prisma } = {}) {
  const row = await createScoped(PRODUCT_MASTER_ENTITY, 'PRODUCT_MASTER_CREATED', {
    input, schema: zCreateProductMaster, model: 'productMaster', select: MASTER_SELECT, codeTaken: 'PRODUCT_MASTER_CODE_TAKEN', viewer, db,
    references: async (tx, d, business) => {
      await requireInBusiness(tx, 'inventoryCategory', d.categoryId, business.id, 'INVENTORY_CATEGORY_NOT_FOUND')
      await requireInBusiness(tx, 'productFamily', d.familyId, business.id, 'PRODUCT_FAMILY_NOT_FOUND')
      await requireInBusiness(tx, 'factory', d.factoryId, business.id, 'FACTORY_NOT_FOUND')
    },
    columns: (d) => ({
      code: d.code, categoryId: d.categoryId, familyId: d.familyId ?? null, factoryId: d.factoryId ?? null, nameTh: d.nameTh, nameEn: d.nameEn, baseCost: d.baseCost ?? 0, specsJson: JSON.stringify(d.specs ?? {}),
      // @req FR-201, FR-202 — the nature and the axes are fixed here; a
      //   SERVICE master defaults nothing and declares no axes.
      nature: d.nature ?? 'GOOD',
      defaultStockPolicy: (d.nature ?? 'GOOD') === 'SERVICE' ? 'SERVICE' : (d.defaultStockPolicy ?? 'TRACKED'),
      variantAxesJson: JSON.stringify((d.nature ?? 'GOOD') === 'SERVICE' ? [] : (d.variantAxes ?? [])),
    }),
    payload: (created) => ({ categoryId: created.categoryId, familyId: created.familyId, factoryId: created.factoryId, nature: created.nature, variantAxes: parseVariantAxes(created.variantAxesJson) }),
  })
  return masterDto(row)
}

export async function listProductMasters({ businessId, categoryId, nature, viewer, db = prisma } = {}) {
  const rows = await listScoped({ model: 'productMaster', select: MASTER_SELECT, businessId, viewer, db, where: { ...(categoryId ? { categoryId } : {}), ...(nature ? { nature } : {}) } })
  return rows.map(masterDto)
}

// ── Product (SKU) ───────────────────────────────────────────────────────────

const MASTER_FOR_SKU_SELECT = { id: true, code: true, businessId: true, status: true, nature: true, defaultStockPolicy: true, variantAxesJson: true }

/**
 * The variant key and lookalike fingerprint of a SKU under its master, with
 * the refusals a caller gets when the values do not cover the axes.
 */
function variantIdentity(master, fields) {
  const axes = parseVariantAxes(master.variantAxesJson)
  const { values, missing, extra } = variantValues(axes, fields)
  if (missing.length) throw Object.assign(failure(422, 'INVENTORY_VARIANT_AXES_INCOMPLETE'), { details: { axes, missing } })
  if (extra.length) throw Object.assign(failure(422, 'INVENTORY_VARIANT_AXIS_UNKNOWN'), { details: { axes, unknown: extra } })
  const variantKey = variantKeyFor(axes, values)
  return { axes, variant: values, variantKey, fingerprint: lookalikeFingerprint({ name: fields.name, color: fields.color, material: fields.material, variantKey }) }
}

/** The one row that already is this variant under the master, archived or not; null when none. */
async function variantTaken(tx, masterId, variantKey, exceptId = null) {
  if (!variantKey) return null
  const row = await tx.product.findFirst({ where: { productMasterId: masterId, variantKey, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true, code: true, status: true } })
  return row
}

/** A live SKU under the master that describes exactly the same thing; null when none or when the fingerprint says nothing. */
async function lookalikeOf(tx, masterId, fingerprint, exceptId = null) {
  if (!fingerprint) return null
  const rows = await tx.product.findMany({ where: { productMasterId: masterId, status: { not: 'ARCHIVED' }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true, code: true, name: true, color: true, material: true, variantKey: true } })
  return rows.find((row) => lookalikeFingerprint(row) === fingerprint) ?? null
}

export async function createProduct(input, { viewer, db = prisma } = {}) {
  const d = zCreateProduct.parse(input)
  const row = await db.$transaction(async (tx) => {
    const business = await loadBusiness(tx, viewer, d.businessId, { write: true })
    await assertCodeFree(tx, 'product', business.tenantId, d.code, 'PRODUCT_CODE_TAKEN')
    const master = await tx.productMaster.findUnique({ where: { id: d.productMasterId }, select: MASTER_FOR_SKU_SELECT })
    if (!master || master.businessId !== business.id) throw failure(422, 'PRODUCT_MASTER_NOT_FOUND')
    if (master.status === 'ARCHIVED') throw failure(409, 'PRODUCT_MASTER_ARCHIVED')

    // @req FR-201 — the master decides what a SKU under it may be (BR-038).
    const nature = natureRule(master, d.stockPolicy)
    if (!nature.ok) throw Object.assign(failure(422, nature.code), { details: { masterNature: master.nature, stockPolicy: d.stockPolicy } })
    const stockPolicy = nature.stockPolicy
    const isService = stockPolicy === 'SERVICE'

    // @req FR-202 — one physical variant, one SKU (BR-039).
    const identity = isService ? { axes: [], variant: {}, variantKey: null, fingerprint: lookalikeFingerprint({ name: d.name, color: d.color, material: d.material, variantKey: null }) } : variantIdentity(master, d)
    const existing = await variantTaken(tx, master.id, identity.variantKey)
    if (existing) throw Object.assign(failure(409, 'INVENTORY_PRODUCT_VARIANT_EXISTS'), { details: { existingProductId: existing.id, existingCode: existing.code, existingStatus: existing.status, variantKey: identity.variantKey } })
    const lookalike = await lookalikeOf(tx, master.id, identity.fingerprint)
    if (lookalike && !d.allowLookalike) throw Object.assign(failure(409, 'INVENTORY_PRODUCT_LOOKALIKE'), { details: { existingProductId: lookalike.id, existingCode: lookalike.code } })

    const created = await tx.product.create({
      data: {
        tenantId: business.tenantId, businessId: business.id,
        code: d.code, productMasterId: master.id, name: d.name ?? null, color: d.color ?? null, material: d.material ?? null,
        unit: d.unit ?? 'EA', stockPolicy,
        // @req FR-168 — anything without a ledger is stored with NONE, so a
        // SERVICE cannot carry a tracking mode any more than an UNTRACKED good
        // can. Written as "not TRACKED" rather than a list, so a fourth nature
        // cannot be added later and silently inherit lot or serial identity.
        trackingMode: stockPolicy !== 'TRACKED' ? 'NONE' : (d.trackingMode ?? 'NONE'),
        // @req FR-201 — a service has no stock to keep safe; the field is 0,
        //   not the counted default, so a report never reads it as a threshold.
        safetyStock: isService ? 0 : (d.safetyStock ?? 10),
        // @req FR-176, FR-179 — the kit role, the customer lock a branded SKU
        //   carries, and the storage thresholds an ageing one declares. Defaults
        //   keep every product created before ADR-074 identical: RAW_COMPONENT,
        //   no lock, no ageing.
        itemKind: d.itemKind ?? 'RAW_COMPONENT',
        flowAccountSku: d.flowAccountSku ?? null,
        dedicatedCustomerId: d.dedicatedCustomerId ?? null,
        dedicatedSalesOrderId: d.dedicatedSalesOrderId ?? null,
        maintenanceIntervalDays: d.maintenanceIntervalDays ?? null,
        maxStorageDays: d.maxStorageDays ?? null,
        // @req FR-202, FR-207
        variantJson: JSON.stringify(identity.variant),
        variantKey: identity.variantKey,
        reorderPoint: isService ? null : (d.reorderPoint ?? null),
        reorderQty: isService ? null : (d.reorderQty ?? null),
        leadTimeDays: isService ? null : (d.leadTimeDays ?? null),
      },
      select: PRODUCT_SELECT,
    })
    await recordAudit(tx, {
      entityType: PRODUCT_ENTITY, entityId: created.id, action: 'PRODUCT_CREATED', actorId: actor(viewer),
      payload: {
        businessId: business.id, code: created.code, productMasterId: created.productMasterId, stockPolicy: created.stockPolicy, trackingMode: created.trackingMode, itemKind: created.itemKind,
        dedicatedCustomerId: created.dedicatedCustomerId, dedicatedSalesOrderId: created.dedicatedSalesOrderId,
        masterNature: master.nature, variantKey: created.variantKey, ...(lookalike ? { allowLookalike: true, lookalikeOf: lookalike.id } : {}),
      },
    })
    return created
  })
  return productDto(row)
}

/**
 * The SKUs of one Business. Archived rows on request only; `stockPolicy`,
 * `status` and the master's `nature` narrow the list, so "the services" and
 * "what is being phased out" are one query each.
 */
export async function listProducts({ businessId, productMasterId, includeArchived = false, stockPolicy, status, nature, viewer, db = prisma } = {}) {
  const rows = await listScoped({
    model: 'product', select: PRODUCT_SELECT, businessId, viewer, db,
    where: {
      ...(productMasterId ? { productMasterId } : {}),
      ...(status ? { status } : (includeArchived ? {} : { status: { not: 'ARCHIVED' } })),
      ...(stockPolicy ? { stockPolicy } : {}),
      ...(nature ? { productMaster: { nature } } : {}),
    },
  })
  return rows.map(productDto)
}

export async function getProduct(id, { viewer, db = prisma } = {}) {
  const productId = typeof id === 'string' ? id.trim() : ''
  if (!productId) throw notFound()
  const row = await db.product.findUnique({ where: { id: productId }, select: { ...PRODUCT_SELECT, movements: { select: { quantity: true } } } })
  if (!row) throw notFound()
  assertMayView(viewer, row.businessId)
  const { movements, ...product } = row
  return { ...productDto(product), onHand: product.stockPolicy === 'TRACKED' ? stockOnHand(movements) : null }
}

const PRODUCT_ACTIONS = Object.freeze({ UPDATE: 'PRODUCT_UPDATED', ARCHIVE: 'PRODUCT_ARCHIVED', PHASE_OUT: 'PRODUCT_PHASED_OUT', REACTIVATE: 'PRODUCT_REACTIVATED', MERGE: 'PRODUCT_MERGED' })
const TERMINAL_WORK_ORDER_STATUSES = ['COMPLETED', 'CANCELLED']

function productFieldColumns(fields = {}) {
  const out = {}
  for (const key of ['name', 'color', 'material', 'unit', 'safetyStock', 'reorderPoint', 'reorderQty', 'leadTimeDays']) {
    if (fields[key] !== undefined) out[key] = fields[key]
  }
  return out
}

async function onHandOf(tx, product) {
  if (product.stockPolicy !== 'TRACKED') return null
  const sum = await tx.stockMovement.aggregate({ where: { productId: product.id }, _sum: { quantity: true } })
  return sum._sum.quantity ?? 0
}

const activeReservationsOf = (tx, productId) => tx.stockReservation.count({ where: { productId, status: 'ACTIVE' } })

/**
 * Everything that would still point at the duplicate after a merge and that a
 * merge cannot re-point on its own: a bundle or recipe already holding the
 * survivor (a quantity sum would change the BOM's meaning), a recipe whose
 * output is the survivor at a batch size the survivor already has, a recipe
 * of the duplicate that names the survivor as a component (or the reverse),
 * and any work order that is not finished.
 */
async function mergeBlockers(tx, duplicate, survivor) {
  const blockers = []
  const bundleItems = await tx.productBundleItem.findMany({ where: { productId: duplicate.id }, select: { id: true, bundleId: true, bundle: { select: { code: true } } } })
  for (const item of bundleItems) {
    const clash = await tx.productBundleItem.findFirst({ where: { bundleId: item.bundleId, productId: survivor.id }, select: { id: true } })
    if (clash) blockers.push({ kind: 'BUNDLE_HOLDS_BOTH', bundleId: item.bundleId, code: item.bundle.code })
  }
  const lines = await tx.productRecipeLine.findMany({ where: { componentProductId: duplicate.id }, select: { id: true, recipeId: true, recipe: { select: { code: true, productId: true } } } })
  for (const line of lines) {
    if (line.recipe.productId === survivor.id) { blockers.push({ kind: 'RECIPE_OUTPUT_IS_SURVIVOR', recipeId: line.recipeId, code: line.recipe.code }); continue }
    const clash = await tx.productRecipeLine.findFirst({ where: { recipeId: line.recipeId, componentProductId: survivor.id }, select: { id: true } })
    if (clash) blockers.push({ kind: 'RECIPE_HOLDS_BOTH', recipeId: line.recipeId, code: line.recipe.code })
  }
  const recipes = await tx.productRecipe.findMany({ where: { productId: duplicate.id }, select: { id: true, code: true, batchSize: true, status: true } })
  for (const recipe of recipes) {
    const names = await tx.productRecipeLine.findFirst({ where: { recipeId: recipe.id, componentProductId: survivor.id }, select: { id: true } })
    if (names) { blockers.push({ kind: 'RECIPE_COMPONENT_IS_SURVIVOR', recipeId: recipe.id, code: recipe.code }); continue }
    if (recipe.status !== 'ARCHIVED') {
      const clash = await tx.productRecipe.findFirst({ where: { productId: survivor.id, batchSize: recipe.batchSize, status: { not: 'ARCHIVED' } }, select: { id: true } })
      if (clash) blockers.push({ kind: 'RECIPE_BATCH_SIZE_EXISTS', recipeId: recipe.id, code: recipe.code, batchSize: recipe.batchSize })
    }
  }
  const openStatus = { notIn: TERMINAL_WORK_ORDER_STATUSES }
  const customization = await tx.customizationWorkOrder.count({ where: { status: openStatus, OR: [{ rawProductId: duplicate.id }, { outputProductId: duplicate.id }] } })
  if (customization) blockers.push({ kind: 'OPEN_CUSTOMIZATION_WORK_ORDERS', count: customization })
  const kitting = await tx.kittingWorkOrder.count({ where: { status: openStatus, finishedProductId: duplicate.id } })
  if (kitting) blockers.push({ kind: 'OPEN_KITTING_WORK_ORDERS', count: kitting })
  return blockers
}

async function repointReferences(tx, duplicate, survivor) {
  const identifiers = await tx.productIdentifier.updateMany({ where: { productId: duplicate.id, status: 'ACTIVE' }, data: { productId: survivor.id } })
  let conversions = 0
  let conversionsRetired = 0
  for (const conversion of await tx.productUnitConversion.findMany({ where: { productId: duplicate.id, status: 'ACTIVE' }, select: { id: true, unit: true } })) {
    const clash = await tx.productUnitConversion.findUnique({ where: { productId_unit: { productId: survivor.id, unit: conversion.unit } }, select: { id: true } })
    if (clash || conversion.unit === survivor.unit) {
      await tx.productUnitConversion.update({ where: { id: conversion.id }, data: { status: 'RETIRED', version: { increment: 1 } } })
      conversionsRetired += 1
    } else {
      await tx.productUnitConversion.update({ where: { id: conversion.id }, data: { productId: survivor.id, version: { increment: 1 } } })
      conversions += 1
    }
  }
  const bundleItems = await tx.productBundleItem.updateMany({ where: { productId: duplicate.id }, data: { productId: survivor.id } })
  const recipeLines = await tx.productRecipeLine.updateMany({ where: { componentProductId: duplicate.id }, data: { componentProductId: survivor.id } })
  const recipes = await tx.productRecipe.updateMany({ where: { productId: duplicate.id }, data: { productId: survivor.id } })
  return { identifiers: identifiers.count, conversions, conversionsRetired, bundleItems: bundleItems.count, recipeLines: recipeLines.count, recipes: recipes.count }
}

/** Apply one versioned action; compare-and-swap on (id, version). */
export async function applyProductAction(id, input, { viewer, db = prisma } = {}) {
  const productId = typeof id === 'string' ? id.trim() : ''
  if (!productId) throw notFound()
  const data = zProductAction.parse(input)
  const updated = await db.$transaction(async (tx) => {
    const row = await tx.product.findUnique({ where: { id: productId }, select: PRODUCT_SELECT })
    if (!row) throw notFound()
    const business = await loadBusiness(tx, viewer, row.businessId, { write: true })
    if (row.version !== data.version) throw failure(409, 'PRODUCT_VERSION_CONFLICT')
    // @req FR-205 — the lifecycle rule first: the status a SKU is in decides
    //   which actions exist for it, before any ledger question is asked.
    const lifecycle = productLifecycleRule(row, data.action)
    if (!lifecycle.ok) throw failure(409, lifecycle.code)

    const change = {}
    const payload = { businessId: business.id, code: row.code, ...(data.reason ? { reason: data.reason } : {}) }
    let survivor = null

    if (data.action === 'UPDATE') {
      Object.assign(change, productFieldColumns(data.fields))
      if (row.stockPolicy === 'SERVICE') {
        for (const key of ['safetyStock', 'reorderPoint', 'reorderQty', 'leadTimeDays', 'variant']) {
          if (data.fields[key] !== undefined && data.fields[key] !== null && data.fields[key] !== 0) throw Object.assign(failure(422, 'INVENTORY_PRODUCT_IS_A_SERVICE'), { details: { field: key } })
        }
      } else if (data.fields.variant !== undefined || data.fields.name !== undefined || data.fields.color !== undefined || data.fields.material !== undefined) {
        // @req FR-202 — a corrected description is re-keyed and re-checked
        //   against the master, exactly as a new SKU is.
        const master = await tx.productMaster.findUnique({ where: { id: row.productMasterId }, select: MASTER_FOR_SKU_SELECT })
        const merged = { name: data.fields.name ?? row.name, color: data.fields.color ?? row.color, material: data.fields.material ?? row.material, variant: data.fields.variant ?? parseVariant(row.variantJson) }
        const identity = variantIdentity(master, merged)
        const existing = await variantTaken(tx, master.id, identity.variantKey, row.id)
        if (existing) throw Object.assign(failure(409, 'INVENTORY_PRODUCT_VARIANT_EXISTS'), { details: { existingProductId: existing.id, existingCode: existing.code, existingStatus: existing.status, variantKey: identity.variantKey } })
        const lookalike = await lookalikeOf(tx, master.id, identity.fingerprint, row.id)
        if (lookalike) throw Object.assign(failure(409, 'INVENTORY_PRODUCT_LOOKALIKE'), { details: { existingProductId: lookalike.id, existingCode: lookalike.code } })
        change.variantJson = JSON.stringify(identity.variant)
        change.variantKey = identity.variantKey
        if (data.fields.variant !== undefined) payload.variant = { from: parseVariant(row.variantJson), to: identity.variant }
      }
      payload.fields = Object.keys(change).filter((k) => k !== 'variantJson')
    } else if (data.action === 'ARCHIVE') {
      // @req FR-205 — BR-040: a counted SKU with stock or a live promise stays.
      const guard = archiveGuard({ onHand: await onHandOf(tx, row), activeReservations: await activeReservationsOf(tx, row.id) })
      if (!guard.ok) throw Object.assign(failure(409, guard.code), { details: { onHand: await onHandOf(tx, row) } })
      change.status = 'ARCHIVED'
      change.archivedAt = new Date()
      payload.from = { status: row.status }
      payload.to = { status: 'ARCHIVED' }
    } else if (data.action === 'PHASE_OUT') {
      change.status = 'PHASE_OUT'
      payload.from = { status: row.status }
      payload.to = { status: 'PHASE_OUT' }
      payload.onHand = await onHandOf(tx, row)
    } else if (data.action === 'REACTIVATE') {
      const master = await tx.productMaster.findUnique({ where: { id: row.productMasterId }, select: { status: true } })
      if (master?.status === 'ARCHIVED') throw failure(409, 'PRODUCT_MASTER_ARCHIVED')
      change.status = 'ACTIVE'
      change.archivedAt = null
      payload.from = { status: row.status }
      payload.to = { status: 'ACTIVE' }
    } else if (data.action === 'MERGE') {
      // @req FR-205 — the anti-bloat repair (ADR-083 D5).
      survivor = await tx.product.findUnique({ where: { id: data.into }, select: PRODUCT_SELECT })
      const onHand = await onHandOf(tx, row)
      const rule = mergeRule(row, survivor, { onHand, activeReservations: await activeReservationsOf(tx, row.id) })
      if (!rule.ok) throw Object.assign(failure(rule.code === 'INVENTORY_MERGE_TARGET_NOT_FOUND' ? 422 : 409, rule.code), { details: { onHand, into: data.into } })
      const blockers = await mergeBlockers(tx, row, survivor)
      if (blockers.length) throw Object.assign(failure(409, 'INVENTORY_MERGE_BLOCKED_BY_REFERENCES'), { details: blockers })
      let moved = 0
      if (rule.movesStock) {
        const reference = `MERGE:${row.code}`
        const occurredAt = new Date()
        await appendMovement(tx, { businessId: business.id, productId: row.id, kind: 'ISSUE', quantity: onHand, reason: 'SKU_MERGE', reference, occurredAt }, { viewer })
        await appendMovement(tx, { businessId: business.id, productId: survivor.id, kind: 'RECEIPT', quantity: onHand, reason: 'SKU_MERGE', reference, occurredAt }, { viewer })
        moved = onHand
      }
      const repointed = await repointReferences(tx, row, survivor)
      change.status = 'ARCHIVED'
      change.archivedAt = new Date()
      change.mergedIntoProductId = survivor.id
      payload.into = { productId: survivor.id, code: survivor.code }
      payload.movedQty = moved
      payload.repointed = repointed
      payload.from = { status: row.status }
      payload.to = { status: 'ARCHIVED' }
    }

    const result = await tx.product.updateMany({ where: { id: row.id, version: row.version }, data: { ...change, version: { increment: 1 } } })
    if (result.count !== 1) throw failure(409, 'PRODUCT_VERSION_CONFLICT')
    await recordAudit(tx, { entityType: PRODUCT_ENTITY, entityId: row.id, action: PRODUCT_ACTIONS[data.action], actorId: actor(viewer), payload: { ...payload, version: row.version + 1 } })
    if (survivor) {
      const absorbed = await tx.product.update({ where: { id: survivor.id }, data: { version: { increment: 1 } }, select: { version: true } })
      await recordAudit(tx, { entityType: PRODUCT_ENTITY, entityId: survivor.id, action: 'PRODUCT_ABSORBED_MERGE', actorId: actor(viewer), payload: { businessId: business.id, code: survivor.code, from: { productId: row.id, code: row.code }, movedQty: payload.movedQty, repointed: payload.repointed, version: absorbed.version } })
    }
    return tx.product.findUnique({ where: { id: row.id }, select: PRODUCT_SELECT })
  })
  return productDto(updated)
}

// ── Bundle ──────────────────────────────────────────────────────────────────

export function createBundle(input, { viewer, db = prisma } = {}) {
  return createScoped(PRODUCT_BUNDLE_ENTITY, 'PRODUCT_BUNDLE_CREATED', {
    input, schema: zCreateBundle, model: 'productBundle', select: BUNDLE_SELECT, codeTaken: 'PRODUCT_BUNDLE_CODE_TAKEN', viewer, db,
    references: async (tx, d, business) => {
      for (const item of d.items) {
        const product = await requireInBusiness(tx, 'product', item.productId, business.id, 'PRODUCT_NOT_FOUND')
        if (product.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')
      }
    },
    columns: (d) => ({
      code: d.code, name: d.name, description: d.description ?? null, targetRecipients: d.targetRecipients ?? null, totalPrice: d.totalPrice ?? null,
      items: { create: d.items.map((item) => ({ productId: item.productId, qty: item.qty })) },
    }),
    payload: (created) => ({ items: created.items.map((item) => ({ productId: item.productId, qty: item.qty })) }),
  })
}

/** Bundles with the number of complete sets the ledger currently allows. */
export async function listBundles({ businessId, viewer, db = prisma } = {}) {
  const bundles = await listScoped({ model: 'productBundle', select: BUNDLE_SELECT, businessId, viewer, db })
  const productIds = [...new Set(bundles.flatMap((b) => b.items.map((i) => i.productId)))]
  if (!productIds.length) return bundles.map((b) => ({ ...b, availableSets: null }))
  const products = await db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, stockPolicy: true, movements: { select: { quantity: true } } } })
  const onHandByProductId = Object.fromEntries(products.map((p) => [p.id, p.stockPolicy === 'TRACKED' ? stockOnHand(p.movements) : null]))
  return bundles.map((b) => ({ ...b, availableSets: bundleAvailability(b.items, onHandByProductId) }))
}

// ── FR-177 — the FlowAccount SKU of a tradeable set (BR-032, BR-002) ─────────
//
// A FlowAccount set code carries parentheses (`TMS06-4(P-16)`), which FR-154's
// own `code` deliberately does not allow — and that is the right answer rather
// than an obstacle: this is an ACCOUNTING SYSTEM'S id for our product, not our
// id for it, and BR-002's rule is that such a thing is an attribute and never a
// key.
//
// It is NOT an `ExternalRef` row, which is where the first attempt put it.
// That table is unique on `(system, value)` across the whole installation and
// carries no `tenantId` at all — it was built for a single installation's plan
// import — so two Tenants could not both sell a set the Chinese factory names
// `TMS06`, which is an entirely normal thing for two Tenants to do. Running the
// suites together is what surfaced it. So: one nullable column on `Product`,
// unique per Tenant, written only here and validated against the pattern, so a
// value FlowAccount would reject can never be stored.

/**
 * Bind a product to its FlowAccount item code. The value must be a finished-set
 * SKU (`[MODEL]-[COUNT]([PACKAGE])`, BR-032) — components and packaging are not
 * synchronised to FlowAccount at all, so a code on one would be a claim about a
 * row that will never exist there.
 */
export async function setFlowAccountSku({ businessId, productId, flowAccountSku }, { viewer, db = prisma } = {}) {
  if (!isFinishedSetSku(flowAccountSku)) {
    throw Object.assign(failure(422, 'INVENTORY_FINISHED_SET_SKU_INVALID'), { details: { flowAccountSku, pattern: FINISHED_SET_SKU_PATTERN.source } })
  }
  const row = await db.$transaction(async (tx) => {
    const business = await loadBusiness(tx, viewer, businessId, { write: true })
    const product = await tx.product.findUnique({ where: { id: productId }, select: PRODUCT_SELECT })
    if (!product || product.businessId !== business.id) throw failure(422, 'INVENTORY_PRODUCT_NOT_FOUND')
    if (product.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')

    const value = flowAccountSku.trim()
    const taken = await tx.product.findUnique({ where: { tenantId_flowAccountSku: { tenantId: business.tenantId, flowAccountSku: value } }, select: { id: true, code: true } })
    if (taken && taken.id !== product.id) throw Object.assign(failure(409, 'INVENTORY_FLOWACCOUNT_SKU_TAKEN'), { details: { flowAccountSku: value, takenBy: taken.code } })

    const updated = await tx.product.update({ where: { id: product.id }, data: { flowAccountSku: value, version: { increment: 1 } }, select: PRODUCT_SELECT })
    await recordAudit(tx, {
      entityType: PRODUCT_ENTITY, entityId: product.id, action: 'PRODUCT_FLOWACCOUNT_SKU_SET', actorId: actor(viewer),
      payload: { businessId: business.id, code: product.code, from: product.flowAccountSku, to: value, version: updated.version },
    })
    return updated
  })
  return productDto(row)
}

/** The FlowAccount item code carried by a product, or null when it has none. */
export async function flowAccountSkuOf(db, productId) {
  const product = await db.product.findUnique({ where: { id: productId }, select: { flowAccountSku: true } })
  return product?.flowAccountSku ?? null
}

/** The product a FlowAccount item code names, inside one Business. */
export async function productByFlowAccountSku(db, businessId, flowAccountSku) {
  const value = String(flowAccountSku ?? '').trim()
  if (!value) return null
  return db.product.findFirst({ where: { businessId, flowAccountSku: value } })
}
