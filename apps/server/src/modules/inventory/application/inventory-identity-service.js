import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import {
  PRODUCT_IDENTIFIER_ENTITY,
  PRODUCT_UNIT_CONVERSION_ENTITY,
  identifierCollision,
  parseVariant,
  zCreateIdentifier,
  zCreateUnitConversion,
  zIdentifierAction,
  zUnitConversionAction,
} from '../domain/inventory-governance'
import { assertMayView, loadBusiness, notFound } from './inventory-authority'

// @req FR-203 — the only writer of product identifiers (barcode, GTIN,
//   supplier and manufacturer codes, a legacy code): each is an attribute of
//   exactly one SKU, unique per Tenant per kind, the two scannable kinds
//   sharing one value space, never a key (BR-002). RETIRE keeps the row.
//   `resolveProduct` is the intake's first call: it answers "which SKU is
//   this" from the code, the FlowAccount code or any active identifier, and
//   follows a merged duplicate to its survivor, so a second row is never
//   written for a thing the catalogue already knows.
// @req FR-204 — the only writer of unit conversions: a pack size is an
//   integer factor on the SKU (BR-037), never the base unit, never on a
//   serial-tracked product, never on a service.
// @spec ADR-083 D3, D4; BR-002, BR-037; SEC-001; FR-072
// @tested tests/integration/fr201-inventory-sku-governance.test.js

const failure = (status, message) => Object.assign(new Error(message), { status })
const actor = (viewer) => viewer?.principal?.id ?? null

const IDENTIFIER_SELECT = { id: true, tenantId: true, businessId: true, productId: true, kind: true, value: true, issuer: true, unit: true, status: true, createdAt: true, updatedAt: true, version: true }
const CONVERSION_SELECT = { id: true, tenantId: true, businessId: true, productId: true, unit: true, name: true, factor: true, usage: true, status: true, createdAt: true, updatedAt: true, version: true }
const PRODUCT_SELECT = { id: true, code: true, tenantId: true, businessId: true, productMasterId: true, name: true, color: true, material: true, unit: true, stockPolicy: true, trackingMode: true, status: true, mergedIntoProductId: true, variantJson: true, variantKey: true, flowAccountSku: true, version: true }
const RESOLVE_SELECT = { ...PRODUCT_SELECT, unitConversions: { where: { status: 'ACTIVE' }, select: { unit: true, factor: true, usage: true } } }

const productDto = (row) => row ? ({ ...row, variant: parseVariant(row.variantJson), variantJson: undefined }) : null

async function loadProductForWrite(tx, viewer, businessId, productId) {
  const business = await loadBusiness(tx, viewer, businessId, { write: true })
  const id = typeof productId === 'string' ? productId.trim() : ''
  const product = id ? await tx.product.findUnique({ where: { id }, select: PRODUCT_SELECT }) : null
  if (!product || product.businessId !== business.id) throw failure(422, 'INVENTORY_PRODUCT_NOT_FOUND')
  if (product.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')
  return { business, product }
}

async function loadProductForRead(db, viewer, productId) {
  const id = typeof productId === 'string' ? productId.trim() : ''
  if (!id) throw notFound()
  const product = await db.product.findUnique({ where: { id }, select: { id: true, businessId: true, unit: true } })
  if (!product) throw notFound()
  assertMayView(viewer, product.businessId)
  return product
}

// ── FR-203 — identifiers ────────────────────────────────────────────────────

export async function addIdentifier(productId, input, { viewer, db = prisma } = {}) {
  const data = zCreateIdentifier.parse(input)
  return db.$transaction(async (tx) => {
    const { business, product } = await loadProductForWrite(tx, viewer, data.businessId, productId)
    // A pack's barcode names the pack: the unit must be the base unit or a
    // conversion this SKU declares, or the scan would resolve to a quantity
    // nothing can convert.
    if (data.unit && data.unit !== product.unit) {
      const conversion = await tx.productUnitConversion.findFirst({ where: { productId: product.id, unit: data.unit, status: 'ACTIVE' }, select: { id: true } })
      if (!conversion) throw Object.assign(failure(422, 'INVENTORY_UNIT_UNKNOWN'), { details: { unit: data.unit, baseUnit: product.unit } })
    }
    const existing = await tx.productIdentifier.findMany({ where: { tenantId: business.tenantId, value: data.value }, select: { id: true, kind: true, value: true, productId: true, product: { select: { code: true } } } })
    const hit = identifierCollision(data.kind, data.value, existing)
    if (hit) throw Object.assign(failure(409, 'INVENTORY_IDENTIFIER_TAKEN'), { details: { kind: hit.kind, value: hit.value, productId: hit.productId, code: hit.product?.code ?? null } })
    const created = await tx.productIdentifier.create({
      data: { tenantId: business.tenantId, businessId: business.id, productId: product.id, kind: data.kind, value: data.value, issuer: data.issuer ?? null, unit: data.unit ?? null },
      select: IDENTIFIER_SELECT,
    })
    await recordAudit(tx, { entityType: PRODUCT_IDENTIFIER_ENTITY, entityId: created.id, action: 'PRODUCT_IDENTIFIER_ADDED', actorId: actor(viewer), payload: { businessId: business.id, productId: product.id, code: product.code, kind: created.kind, value: created.value, unit: created.unit } })
    return created
  })
}

export async function listIdentifiers(productId, { includeRetired = false, viewer, db = prisma } = {}) {
  const product = await loadProductForRead(db, viewer, productId)
  return db.productIdentifier.findMany({ where: { productId: product.id, ...(includeRetired ? {} : { status: 'ACTIVE' }) }, orderBy: [{ kind: 'asc' }, { value: 'asc' }], select: IDENTIFIER_SELECT })
}

/** RETIRE one identifier; compare-and-swap on (id, version). The row stays: a retired barcode is still a fact about the past. */
export async function applyIdentifierAction(productId, input, { viewer, db = prisma } = {}) {
  const data = zIdentifierAction.parse(input)
  return db.$transaction(async (tx) => {
    const row = await tx.productIdentifier.findUnique({ where: { id: data.identifierId }, select: IDENTIFIER_SELECT })
    if (!row || row.productId !== (typeof productId === 'string' ? productId.trim() : '')) throw notFound()
    const { business, product } = await loadProductForWrite(tx, viewer, row.businessId, row.productId)
    if (row.version !== data.version) throw failure(409, 'PRODUCT_IDENTIFIER_VERSION_CONFLICT')
    if (row.status === 'RETIRED') throw failure(409, 'PRODUCT_IDENTIFIER_RETIRED')
    const result = await tx.productIdentifier.updateMany({ where: { id: row.id, version: row.version }, data: { status: 'RETIRED', version: { increment: 1 } } })
    if (result.count !== 1) throw failure(409, 'PRODUCT_IDENTIFIER_VERSION_CONFLICT')
    await recordAudit(tx, { entityType: PRODUCT_IDENTIFIER_ENTITY, entityId: row.id, action: 'PRODUCT_IDENTIFIER_RETIRED', actorId: actor(viewer), payload: { businessId: business.id, productId: product.id, code: product.code, kind: row.kind, value: row.value, version: row.version + 1 } })
    return tx.productIdentifier.findUnique({ where: { id: row.id }, select: IDENTIFIER_SELECT })
  })
}

// ── FR-204 — unit conversions ───────────────────────────────────────────────

export async function addUnitConversion(productId, input, { viewer, db = prisma } = {}) {
  const data = zCreateUnitConversion.parse(input)
  return db.$transaction(async (tx) => {
    const { business, product } = await loadProductForWrite(tx, viewer, data.businessId, productId)
    if (product.stockPolicy === 'SERVICE') throw failure(422, 'INVENTORY_PRODUCT_IS_A_SERVICE')
    if (product.trackingMode === 'SERIAL') throw failure(422, 'INVENTORY_UNIT_NOT_FOR_SERIAL')
    if (data.unit === product.unit) throw Object.assign(failure(422, 'INVENTORY_UNIT_IS_BASE'), { details: { unit: data.unit } })
    const taken = await tx.productUnitConversion.findUnique({ where: { productId_unit: { productId: product.id, unit: data.unit } }, select: { id: true } })
    if (taken) throw failure(409, 'INVENTORY_UNIT_TAKEN')
    const created = await tx.productUnitConversion.create({
      data: { tenantId: business.tenantId, businessId: business.id, productId: product.id, unit: data.unit, name: data.name ?? null, factor: data.factor, usage: data.usage ?? 'ANY' },
      select: CONVERSION_SELECT,
    })
    await recordAudit(tx, { entityType: PRODUCT_UNIT_CONVERSION_ENTITY, entityId: created.id, action: 'PRODUCT_UNIT_CONVERSION_ADDED', actorId: actor(viewer), payload: { businessId: business.id, productId: product.id, code: product.code, unit: created.unit, factor: created.factor, usage: created.usage, baseUnit: product.unit } })
    return created
  })
}

export async function listUnitConversions(productId, { includeRetired = false, viewer, db = prisma } = {}) {
  const product = await loadProductForRead(db, viewer, productId)
  const rows = await db.productUnitConversion.findMany({ where: { productId: product.id, ...(includeRetired ? {} : { status: 'ACTIVE' }) }, orderBy: [{ factor: 'asc' }], select: CONVERSION_SELECT })
  return { baseUnit: product.unit, conversions: rows }
}

/** UPDATE (name, factor, usage) or RETIRE one conversion; compare-and-swap on (id, version). */
export async function applyUnitConversionAction(productId, input, { viewer, db = prisma } = {}) {
  const data = zUnitConversionAction.parse(input)
  return db.$transaction(async (tx) => {
    const row = await tx.productUnitConversion.findUnique({ where: { id: data.conversionId }, select: CONVERSION_SELECT })
    if (!row || row.productId !== (typeof productId === 'string' ? productId.trim() : '')) throw notFound()
    const { business, product } = await loadProductForWrite(tx, viewer, row.businessId, row.productId)
    if (row.version !== data.version) throw failure(409, 'PRODUCT_UNIT_CONVERSION_VERSION_CONFLICT')
    if (row.status === 'RETIRED') throw failure(409, 'PRODUCT_UNIT_CONVERSION_RETIRED')
    const change = data.action === 'RETIRE' ? { status: 'RETIRED' } : Object.fromEntries(Object.entries(data.fields).filter(([, v]) => v !== undefined))
    const result = await tx.productUnitConversion.updateMany({ where: { id: row.id, version: row.version }, data: { ...change, version: { increment: 1 } } })
    if (result.count !== 1) throw failure(409, 'PRODUCT_UNIT_CONVERSION_VERSION_CONFLICT')
    await recordAudit(tx, {
      entityType: PRODUCT_UNIT_CONVERSION_ENTITY, entityId: row.id, action: data.action === 'RETIRE' ? 'PRODUCT_UNIT_CONVERSION_RETIRED' : 'PRODUCT_UNIT_CONVERSION_UPDATED', actorId: actor(viewer),
      payload: { businessId: business.id, productId: product.id, code: product.code, unit: row.unit, fields: Object.keys(change), from: { factor: row.factor, usage: row.usage }, version: row.version + 1 },
    })
    return tx.productUnitConversion.findUnique({ where: { id: row.id }, select: CONVERSION_SELECT })
  })
}

// ── FR-203 — resolve before create ──────────────────────────────────────────

const MAX_MERGE_HOPS = 10

/**
 * Which SKU an identifier names, inside one visible Business: the `code`, the
 * FlowAccount code, or any ACTIVE identifier, in that order. A merged
 * duplicate is followed to its survivor and the hops are reported. A miss is
 * `{ product: null }` with 200, because "not known yet" is the answer an
 * intake acts on — it is not an authorization refusal.
 */
export async function resolveProduct({ businessId, identifier }, { viewer, db = prisma } = {}) {
  const business = await loadBusiness(db, viewer, businessId)
  const value = typeof identifier === 'string' ? identifier.trim() : ''
  if (!value) return { businessId: business.id, identifier: value, matchedBy: null, product: null, redirectedFrom: [] }

  let matchedBy = null
  let match = null
  let matchedIdentifier = null
  const byCode = await db.product.findUnique({ where: { tenantId_code: { tenantId: business.tenantId, code: value } }, select: RESOLVE_SELECT })
  if (byCode && byCode.businessId === business.id) { matchedBy = 'CODE'; match = byCode }
  if (!match) {
    const byFlow = await db.product.findUnique({ where: { tenantId_flowAccountSku: { tenantId: business.tenantId, flowAccountSku: value } }, select: RESOLVE_SELECT })
    if (byFlow && byFlow.businessId === business.id) { matchedBy = 'FLOWACCOUNT_SKU'; match = byFlow }
  }
  if (!match) {
    const row = await db.productIdentifier.findFirst({
      where: { tenantId: business.tenantId, businessId: business.id, value, status: 'ACTIVE' },
      orderBy: [{ createdAt: 'asc' }],
      select: { kind: true, value: true, unit: true, product: { select: RESOLVE_SELECT } },
    })
    if (row?.product && row.product.businessId === business.id) {
      matchedBy = 'IDENTIFIER'
      match = row.product
      const factor = row.unit && row.unit !== row.product.unit ? row.product.unitConversions.find((c) => c.unit === row.unit)?.factor ?? null : 1
      matchedIdentifier = { kind: row.kind, value: row.value, unit: row.unit ?? row.product.unit, factor }
    }
  }
  if (!match) return { businessId: business.id, identifier: value, matchedBy: null, product: null, redirectedFrom: [] }

  const redirectedFrom = []
  let hops = 0
  while (match.mergedIntoProductId && hops < MAX_MERGE_HOPS) {
    const next = await db.product.findUnique({ where: { id: match.mergedIntoProductId }, select: RESOLVE_SELECT })
    if (!next || next.businessId !== business.id) break
    redirectedFrom.push(match.code)
    match = next
    hops += 1
  }
  const { unitConversions, ...product } = match
  return { businessId: business.id, identifier: value, matchedBy, product: productDto(product), unitConversions, matchedIdentifier, redirectedFrom }
}
