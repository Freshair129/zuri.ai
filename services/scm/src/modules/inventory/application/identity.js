import { PRODUCT_ENTITY } from '../../../kernel/inventory/inventory.js'
import { FINISHED_SET_SKU_PATTERN, isFinishedSetSku } from '../../../kernel/inventory/inventory-costing.js'
import {
  PRODUCT_IDENTIFIER_ENTITY, PRODUCT_UNIT_CONVERSION_ENTITY, identifierCollision, parseVariant,
  zCreateIdentifier, zCreateUnitConversion, zIdentifierAction, zUnitConversionAction,
} from '../../../kernel/inventory/inventory-governance.js'
import { denied, inventoryAuthority } from '../../../infrastructure/delegation.js'
import { enqueueOutbox, recordAudit } from '../../../infrastructure/evidence.js'
import * as repo from '../adapters/identity-repo.js'
import * as catalogRepo from '../adapters/catalog-repo.js'

// SKU identity (FR-203, FR-204, FR-177) inside SCM — port of apps/server
// inventory-identity-service and inventory-catalog-service.setFlowAccountSku,
// with the same codes, order of refusals and audit actions:
//   identifiers — an attribute of exactly one SKU, unique per Tenant per kind,
//                 the scannable kinds sharing one value space; a pack's barcode
//                 names the base unit or an ACTIVE conversion; RETIRE keeps the
//                 row (and the value stays taken).
//   conversions — an integer factor on the SKU, never the base unit, never on a
//                 serial-tracked product or a service; UPDATE / RETIRE by CAS.
//   resolve     — code, then FlowAccount code, then any ACTIVE identifier; a
//                 merged duplicate is followed to its survivor.
//   FlowAccount — a finished-set SKU pattern, unique per Tenant.

const failure = (status, code, details) => Object.assign(new Error(code), { status, code, retryable: false }, details === undefined ? {} : { details })
const productDto = (row) => (row ? { ...row, variant: parseVariant(row.variantJson), variantJson: undefined } : null)

function evidence(sql, scope, { entityType, entityId, action, business, payload, version, ctx }) {
  recordAudit(sql, { entityType, entityId, action, actorId: scope.actorId, tenantId: business.tenantId, businessId: business.id, requestId: ctx.requestId, now: ctx.now, payload })
  enqueueOutbox(sql, { topic: `scm.inventory.${action.toLowerCase().replace(/_/g, '-')}`, aggregateType: entityType, aggregateId: entityId, aggregateVersion: version, now: ctx.now, payload: { businessId: business.id, productId: payload.productId ?? entityId } })
}

/** Legacy loadProductForWrite: Business write authority, then a non-archived SKU of that Business (422/409). */
function productForWrite(sql, scope, businessId, productId) {
  const business = inventoryAuthority.require(scope, typeof businessId === 'string' ? businessId.trim() : '', { write: true })
  const id = typeof productId === 'string' ? productId.trim() : ''
  const product = id ? catalogRepo.byId(sql, 'product', id) : null
  if (!product || product.businessId !== business.id) throw failure(422, 'INVENTORY_PRODUCT_NOT_FOUND')
  if (product.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')
  return { business, product }
}

function productForRead(sql, scope, productId) {
  const id = typeof productId === 'string' ? productId.trim() : ''
  const product = id ? catalogRepo.byId(sql, 'product', id) : null
  if (!product || product.tenantId !== scope.tenantId) throw denied()
  inventoryAuthority.require(scope, product.businessId)
  return product
}

/** Command authorization: validate first (legacy order), then Inventory write authority on the named Business. */
export const writerOf = (scope, schema, body) => inventoryAuthority.require(scope, schema.parse(body).businessId, { write: true }).id
export const SCHEMAS = Object.freeze({ identifier: zCreateIdentifier, conversion: zCreateUnitConversion })
export function flowAccountWriter(scope, body) {
  if (!isFinishedSetSku(body?.flowAccountSku)) throw failure(422, 'INVENTORY_FINISHED_SET_SKU_INVALID', { flowAccountSku: body?.flowAccountSku, pattern: FINISHED_SET_SKU_PATTERN.source })
  return inventoryAuthority.require(scope, typeof body?.businessId === 'string' ? body.businessId.trim() : '', { write: true }).id
}

// ── FR-203 — identifiers ────────────────────────────────────────────────────
export function addIdentifier(sql, scope, productId, input, ctx) {
  const data = zCreateIdentifier.parse(input)
  const { business, product } = productForWrite(sql, scope, data.businessId, productId)
  if (data.unit && data.unit !== product.unit && !repo.activeConversion(sql, product.id, data.unit)) throw failure(422, 'INVENTORY_UNIT_UNKNOWN', { unit: data.unit, baseUnit: product.unit })
  const hit = identifierCollision(data.kind, data.value, repo.identifiersWithValue(sql, business.tenantId, data.value))
  if (hit) throw failure(409, 'INVENTORY_IDENTIFIER_TAKEN', { kind: hit.kind, value: hit.value, productId: hit.productId, code: hit.product?.code ?? null })
  const created = repo.insertIdentifier(sql, { tenantId: business.tenantId, businessId: business.id, productId: product.id, kind: data.kind, value: data.value, issuer: data.issuer ?? null, unit: data.unit ?? null, now: ctx.now })
  evidence(sql, scope, { entityType: PRODUCT_IDENTIFIER_ENTITY, entityId: created.id, action: 'PRODUCT_IDENTIFIER_ADDED', business, version: 1, ctx, payload: { businessId: business.id, productId: product.id, code: product.code, kind: created.kind, value: created.value, unit: created.unit } })
  return { response: { identifier: created }, affected: { identifierId: created.id, productId: product.id } }
}

export function listIdentifiers(sql, scope, productId, { includeRetired = false } = {}) {
  const product = productForRead(sql, scope, productId)
  return repo.identifiersOf(sql, product.id, includeRetired)
}

/** The identifier a command targets, checked against the path's product (legacy: 404 otherwise). */
export function identifierInScope(sql, scope, productId, identifierId) {
  const row = repo.identifierById(sql, identifierId)
  if (!row || row.productId !== (typeof productId === 'string' ? productId.trim() : '') || row.tenantId !== scope.tenantId) throw denied()
  inventoryAuthority.require(scope, row.businessId, { write: true })
  return row
}

export function applyIdentifierAction(sql, scope, productId, input, ctx) {
  const data = zIdentifierAction.parse(input)
  const row = identifierInScope(sql, scope, productId, data.identifierId)
  const { business, product } = productForWrite(sql, scope, row.businessId, row.productId)
  if (row.version !== data.version) throw failure(409, 'PRODUCT_IDENTIFIER_VERSION_CONFLICT')
  if (row.status === 'RETIRED') throw failure(409, 'PRODUCT_IDENTIFIER_RETIRED')
  if (repo.casIdentifier(sql, { id: row.id, version: row.version, change: { status: 'RETIRED' }, now: ctx.now }) !== 1) throw failure(409, 'PRODUCT_IDENTIFIER_VERSION_CONFLICT')
  evidence(sql, scope, { entityType: PRODUCT_IDENTIFIER_ENTITY, entityId: row.id, action: 'PRODUCT_IDENTIFIER_RETIRED', business, version: row.version + 1, ctx, payload: { businessId: business.id, productId: product.id, code: product.code, kind: row.kind, value: row.value, version: row.version + 1 } })
  const fresh = repo.identifierById(sql, row.id)
  return { response: { identifier: fresh }, affected: { identifierId: row.id, version: fresh.version, status: fresh.status } }
}

// ── FR-204 — unit conversions ───────────────────────────────────────────────
export function addUnitConversion(sql, scope, productId, input, ctx) {
  const data = zCreateUnitConversion.parse(input)
  const { business, product } = productForWrite(sql, scope, data.businessId, productId)
  if (product.stockPolicy === 'SERVICE') throw failure(422, 'INVENTORY_PRODUCT_IS_A_SERVICE')
  if (product.trackingMode === 'SERIAL') throw failure(422, 'INVENTORY_UNIT_NOT_FOR_SERIAL')
  if (data.unit === product.unit) throw failure(422, 'INVENTORY_UNIT_IS_BASE', { unit: data.unit })
  if (repo.conversionByUnit(sql, product.id, data.unit)) throw failure(409, 'INVENTORY_UNIT_TAKEN')
  const created = repo.insertConversion(sql, { tenantId: business.tenantId, businessId: business.id, productId: product.id, unit: data.unit, name: data.name ?? null, factor: data.factor, usage: data.usage ?? 'ANY', now: ctx.now })
  evidence(sql, scope, { entityType: PRODUCT_UNIT_CONVERSION_ENTITY, entityId: created.id, action: 'PRODUCT_UNIT_CONVERSION_ADDED', business, version: 1, ctx, payload: { businessId: business.id, productId: product.id, code: product.code, unit: created.unit, factor: created.factor, usage: created.usage, baseUnit: product.unit } })
  return { response: { conversion: created }, affected: { conversionId: created.id, productId: product.id } }
}

export function listUnitConversions(sql, scope, productId, { includeRetired = false } = {}) {
  const product = productForRead(sql, scope, productId)
  return { baseUnit: product.unit, conversions: repo.conversionsOf(sql, product.id, includeRetired) }
}

export function conversionInScope(sql, scope, productId, conversionId) {
  const row = repo.conversionById(sql, conversionId)
  if (!row || row.productId !== (typeof productId === 'string' ? productId.trim() : '') || row.tenantId !== scope.tenantId) throw denied()
  inventoryAuthority.require(scope, row.businessId, { write: true })
  return row
}

export function applyUnitConversionAction(sql, scope, productId, input, ctx) {
  const data = zUnitConversionAction.parse(input)
  const row = conversionInScope(sql, scope, productId, data.conversionId)
  const { business, product } = productForWrite(sql, scope, row.businessId, row.productId)
  if (row.version !== data.version) throw failure(409, 'PRODUCT_UNIT_CONVERSION_VERSION_CONFLICT')
  if (row.status === 'RETIRED') throw failure(409, 'PRODUCT_UNIT_CONVERSION_RETIRED')
  const change = data.action === 'RETIRE' ? { status: 'RETIRED' } : Object.fromEntries(Object.entries(data.fields).filter(([, v]) => v !== undefined))
  if (repo.casConversion(sql, { id: row.id, version: row.version, change, now: ctx.now }) !== 1) throw failure(409, 'PRODUCT_UNIT_CONVERSION_VERSION_CONFLICT')
  evidence(sql, scope, {
    entityType: PRODUCT_UNIT_CONVERSION_ENTITY, entityId: row.id, action: data.action === 'RETIRE' ? 'PRODUCT_UNIT_CONVERSION_RETIRED' : 'PRODUCT_UNIT_CONVERSION_UPDATED', business, version: row.version + 1, ctx,
    payload: { businessId: business.id, productId: product.id, code: product.code, unit: row.unit, fields: Object.keys(change), from: { factor: row.factor, usage: row.usage }, version: row.version + 1 },
  })
  const fresh = repo.conversionById(sql, row.id)
  return { response: { conversion: fresh }, affected: { conversionId: row.id, version: fresh.version, status: fresh.status } }
}

// ── FR-203 — resolve before create ──────────────────────────────────────────
const MAX_MERGE_HOPS = 10

export function resolveProduct(sql, scope, { businessId, identifier }) {
  const business = inventoryAuthority.require(scope, typeof businessId === 'string' ? businessId.trim() : '')
  const value = typeof identifier === 'string' ? identifier.trim() : ''
  const miss = { businessId: business.id, identifier: value, matchedBy: null, product: null, redirectedFrom: [] }
  if (!value) return miss
  let matchedBy = null
  let match = null
  let matchedIdentifier = null
  const byCode = repo.productByTenantCode(sql, business.tenantId, value)
  if (byCode && byCode.businessId === business.id) { matchedBy = 'CODE'; match = byCode }
  if (!match) {
    const byFlow = catalogRepo.flowAccountSkuHolder(sql, business.tenantId, value)
    const row = byFlow ? catalogRepo.byId(sql, 'product', byFlow.id) : null
    if (row && row.businessId === business.id) { matchedBy = 'FLOWACCOUNT_SKU'; match = row }
  }
  if (!match) {
    const hit = repo.firstActiveIdentifier(sql, business.tenantId, business.id, value)
    const row = hit ? catalogRepo.byId(sql, 'product', hit.productId) : null
    if (row && row.businessId === business.id) {
      matchedBy = 'IDENTIFIER'
      match = row
      const conversions = repo.conversionsOf(sql, row.id, false)
      const factor = hit.unit && hit.unit !== row.unit ? conversions.find((c) => c.unit === hit.unit)?.factor ?? null : 1
      matchedIdentifier = { kind: hit.kind, value: hit.value, unit: hit.unit ?? row.unit, factor }
    }
  }
  if (!match) return miss
  const redirectedFrom = []
  for (let hops = 0; match.mergedIntoProductId && hops < MAX_MERGE_HOPS; hops += 1) {
    const next = catalogRepo.byId(sql, 'product', match.mergedIntoProductId)
    if (!next || next.businessId !== business.id) break
    redirectedFrom.push(match.code)
    match = next
  }
  const unitConversions = repo.conversionsOf(sql, match.id, false).map(({ unit, factor, usage }) => ({ unit, factor, usage }))
  const { tenantId, businessId: bid, id, code, productMasterId, name, color, material, unit, stockPolicy, trackingMode, status, mergedIntoProductId, variantJson, variantKey, flowAccountSku, version } = match
  return { businessId: business.id, identifier: value, matchedBy, product: productDto({ id, code, tenantId, businessId: bid, productMasterId, name, color, material, unit, stockPolicy, trackingMode, status, mergedIntoProductId, variantJson, variantKey, flowAccountSku, version }), unitConversions, matchedIdentifier, redirectedFrom }
}

// ── FR-177 — the FlowAccount SKU of a tradeable set ─────────────────────────
export function setFlowAccountSku(sql, scope, productId, { businessId, flowAccountSku } = {}, ctx) {
  if (!isFinishedSetSku(flowAccountSku)) throw failure(422, 'INVENTORY_FINISHED_SET_SKU_INVALID', { flowAccountSku, pattern: FINISHED_SET_SKU_PATTERN.source })
  const business = inventoryAuthority.require(scope, typeof businessId === 'string' ? businessId.trim() : '', { write: true })
  const product = catalogRepo.byId(sql, 'product', typeof productId === 'string' ? productId.trim() : '')
  if (!product || product.businessId !== business.id) throw failure(422, 'INVENTORY_PRODUCT_NOT_FOUND')
  if (product.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')
  const value = flowAccountSku.trim()
  const taken = catalogRepo.flowAccountSkuHolder(sql, business.tenantId, value)
  if (taken && taken.id !== product.id) throw failure(409, 'INVENTORY_FLOWACCOUNT_SKU_TAKEN', { flowAccountSku: value, takenBy: taken.code })
  repo.setProductFlowAccountSku(sql, product.id, value, ctx.now)
  const fresh = catalogRepo.byId(sql, 'product', product.id)
  evidence(sql, scope, { entityType: PRODUCT_ENTITY, entityId: product.id, action: 'PRODUCT_FLOWACCOUNT_SKU_SET', business, version: fresh.version, ctx, payload: { businessId: business.id, code: product.code, from: product.flowAccountSku, to: value, version: fresh.version } })
  return { response: { product: productDto(fresh) }, affected: { productId: product.id, version: fresh.version } }
}
