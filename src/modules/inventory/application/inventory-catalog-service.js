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
import { assertMayView, loadBusiness, notFound } from './inventory-authority'

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
// @spec BR-002 (codes are attributes, unique per Tenant, never keys); SEC-001; FR-072
// @tested tests/integration/fr154-inventory-catalog.test.js

const failure = (status, message) => Object.assign(new Error(message), { status })

const CATEGORY_SELECT = { id: true, code: true, tenantId: true, businessId: true, nameTh: true, nameEn: true, slug: true, vibe: true, targetRecipient: true, guardrail: true, status: true, createdAt: true, updatedAt: true, version: true }
const FAMILY_SELECT = { id: true, code: true, tenantId: true, businessId: true, name: true, description: true, status: true, createdAt: true, updatedAt: true, version: true }
const FACTORY_SELECT = { id: true, code: true, tenantId: true, businessId: true, name: true, country: true, contact: true, status: true, createdAt: true, updatedAt: true, version: true }
const MASTER_SELECT = { id: true, code: true, tenantId: true, businessId: true, categoryId: true, familyId: true, factoryId: true, nameTh: true, nameEn: true, baseCost: true, specsJson: true, status: true, createdAt: true, updatedAt: true, version: true }
const PRODUCT_SELECT = { id: true, code: true, tenantId: true, businessId: true, productMasterId: true, name: true, color: true, material: true, unit: true, stockPolicy: true, trackingMode: true, safetyStock: true, status: true, archivedAt: true, createdAt: true, updatedAt: true, version: true }
const BUNDLE_SELECT = { id: true, code: true, tenantId: true, businessId: true, name: true, description: true, targetRecipients: true, totalPrice: true, status: true, createdAt: true, updatedAt: true, version: true, items: { select: { id: true, productId: true, qty: true }, orderBy: { id: 'asc' } } }

function parseSpecs(json) {
  try {
    const value = JSON.parse(json || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

const masterDto = (row) => ({ ...row, specs: parseSpecs(row.specsJson), specsJson: undefined })
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
    columns: (d) => ({ code: d.code, categoryId: d.categoryId, familyId: d.familyId ?? null, factoryId: d.factoryId ?? null, nameTh: d.nameTh, nameEn: d.nameEn, baseCost: d.baseCost ?? 0, specsJson: JSON.stringify(d.specs ?? {}) }),
    payload: (created) => ({ categoryId: created.categoryId, familyId: created.familyId, factoryId: created.factoryId }),
  })
  return masterDto(row)
}

export async function listProductMasters({ businessId, categoryId, viewer, db = prisma } = {}) {
  const rows = await listScoped({ model: 'productMaster', select: MASTER_SELECT, businessId, viewer, db, where: categoryId ? { categoryId } : {} })
  return rows.map(masterDto)
}

// ── Product (SKU) ───────────────────────────────────────────────────────────

export function createProduct(input, { viewer, db = prisma } = {}) {
  return createScoped(PRODUCT_ENTITY, 'PRODUCT_CREATED', {
    input, schema: zCreateProduct, model: 'product', select: PRODUCT_SELECT, codeTaken: 'PRODUCT_CODE_TAKEN', viewer, db,
    references: async (tx, d, business) => {
      const master = await requireInBusiness(tx, 'productMaster', d.productMasterId, business.id, 'PRODUCT_MASTER_NOT_FOUND')
      if (master.status === 'ARCHIVED') throw failure(409, 'PRODUCT_MASTER_ARCHIVED')
    },
    columns: (d) => ({
      code: d.code, productMasterId: d.productMasterId, name: d.name ?? null, color: d.color ?? null, material: d.material ?? null,
      unit: d.unit ?? 'EA', stockPolicy: d.stockPolicy ?? 'TRACKED',
      trackingMode: (d.stockPolicy ?? 'TRACKED') === 'UNTRACKED' ? 'NONE' : (d.trackingMode ?? 'NONE'),
      safetyStock: d.safetyStock ?? 10,
    }),
    payload: (created) => ({ productMasterId: created.productMasterId, stockPolicy: created.stockPolicy, trackingMode: created.trackingMode }),
  })
}

export function listProducts({ businessId, productMasterId, includeArchived = false, viewer, db = prisma } = {}) {
  return listScoped({
    model: 'product', select: PRODUCT_SELECT, businessId, viewer, db,
    where: { ...(productMasterId ? { productMasterId } : {}), ...(includeArchived ? {} : { status: { not: 'ARCHIVED' } }) },
  })
}

export async function getProduct(id, { viewer, db = prisma } = {}) {
  const productId = typeof id === 'string' ? id.trim() : ''
  if (!productId) throw notFound()
  const row = await db.product.findUnique({ where: { id: productId }, select: { ...PRODUCT_SELECT, movements: { select: { quantity: true } } } })
  if (!row) throw notFound()
  assertMayView(viewer, row.businessId)
  const { movements, ...product } = row
  return { ...product, onHand: product.stockPolicy === 'TRACKED' ? stockOnHand(movements) : null }
}

const PRODUCT_ACTIONS = Object.freeze({ UPDATE: 'PRODUCT_UPDATED', ARCHIVE: 'PRODUCT_ARCHIVED' })

function productFieldColumns(fields = {}) {
  const out = {}
  for (const key of ['name', 'color', 'material', 'unit', 'safetyStock']) {
    if (fields[key] !== undefined) out[key] = fields[key]
  }
  return out
}

/** Apply one versioned action; compare-and-swap on (id, version). */
export async function applyProductAction(id, input, { viewer, db = prisma } = {}) {
  const productId = typeof id === 'string' ? id.trim() : ''
  if (!productId) throw notFound()
  const data = zProductAction.parse(input)
  const updated = await db.$transaction(async (tx) => {
    const row = await tx.product.findUnique({ where: { id: productId }, select: PRODUCT_SELECT })
    if (!row) throw notFound()
    await loadBusiness(tx, viewer, row.businessId, { write: true })
    if (row.version !== data.version) throw failure(409, 'PRODUCT_VERSION_CONFLICT')
    if (row.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')
    const change = {}
    const payload = { businessId: row.businessId, code: row.code }
    if (data.action === 'UPDATE') {
      Object.assign(change, productFieldColumns(data.fields))
      payload.fields = Object.keys(change)
    } else {
      change.status = 'ARCHIVED'
      change.archivedAt = new Date()
      payload.from = { status: row.status }
      payload.to = { status: 'ARCHIVED' }
    }
    const result = await tx.product.updateMany({ where: { id: row.id, version: row.version }, data: { ...change, version: { increment: 1 } } })
    if (result.count !== 1) throw failure(409, 'PRODUCT_VERSION_CONFLICT')
    await recordAudit(tx, { entityType: PRODUCT_ENTITY, entityId: row.id, action: PRODUCT_ACTIONS[data.action], actorId: actor(viewer), payload: { ...payload, version: row.version + 1 } })
    return tx.product.findUnique({ where: { id: row.id }, select: PRODUCT_SELECT })
  })
  return updated
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
