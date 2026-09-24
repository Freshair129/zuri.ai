import crypto from 'node:crypto'
import { SUPPLIER_COST_SHEET_ENTITY, supplierCostBaht, supplierCostSatang, zSupplierCostSheetCommit, zSupplierCostSheetEnvelope } from '../../../kernel/procurement/procurement.js'
import { denied, procurementAuthority } from '../../../infrastructure/delegation.js'
import { enqueueOutbox, recordAudit } from '../../../infrastructure/evidence.js'
import { productCandidates, productFacts, setProductCartonAttributes } from '../../inventory/index.js'
import * as procurementRepo from '../adapters/procurement-repo.js'
import * as repo from '../adapters/cost-sheet-repo.js'

// Supplier cost sheets (TASK-ZAI-053, FR-164 + FR-154) inside SCM — port of
// apps/server supplier-cost-sheet-service with the same hashes, codes, order of
// refusals, error codes and audit actions:
//   preview — stores the normalized source + mapping SUGGESTIONS only (no
//             lines); a source hash is unique per Business: the same payload
//             replays, a changed one is PROCUREMENT_COST_SHEET_SOURCE_HASH_REUSED.
//   commit  — needs the preview hash and a person-confirmed mapping for every
//             SKU; carton facts go through Inventory's own writer (Inventory
//             authority, CAS, audit), lines are written, the supplier's previous
//             CONFIRMED sheet is superseded and this one confirmed by CAS — ONE
//             unit of work, so any refusal leaves nothing behind.
// The buyer capability is procurement.po.write (or OWNER); a buyer without
// Inventory write authority is refused (404) at the carton step, whole.

const failure = (status, code, details) => Object.assign(new Error(code), { status, code, retryable: false }, details === undefined ? {} : { details })

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]))
  return value
}
const sha256 = (value) => crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')

function parsePreview(row) {
  try {
    const value = JSON.parse(row.previewJson || '{}')
    return value && typeof value === 'object' ? value : {}
  } catch {
    throw failure(500, 'PROCUREMENT_COST_SHEET_PREVIEW_CORRUPT')
  }
}

function lineDto(line, sheet) {
  const fxRateLocked = sheet.fxRateLocked
  return {
    id: line.id, sheetId: sheet.id, productId: line.productId, sourceSku: line.sourceSku, minQty: line.minQty,
    unitCostForeign: line.unitCostForeign, currency: sheet.currency, fxRateLocked,
    unitCostSatang: supplierCostSatang(line.unitCostForeign, fxRateLocked), unitCostBaht: supplierCostBaht(line.unitCostForeign, fxRateLocked),
    unitsPerCarton: line.unitsPerCarton, cartonCbm: line.cartonCbm, cartonKg: line.cartonKg, freightGoodsType: line.freightGoodsType, leadTimeDays: line.leadTimeDays,
    mappingConfidence: line.mappingConfidence, mappingConfirmedByPersonId: line.mappingConfirmedByPersonId, mappingConfirmedAt: line.mappingConfirmedAt,
    createdAt: line.createdAt, updatedAt: line.updatedAt,
  }
}

function sheetDto(row) {
  if (!row) return row
  const { previewJson, lines, ...rest } = row
  return {
    ...rest,
    preview: previewJson ? { hash: row.previewHash, lines: (() => { const v = parsePreview(row); return Array.isArray(v.mappings) ? v.mappings : [] })() } : null,
    lines: (lines || []).map((line) => lineDto(line, row)),
  }
}

function candidateForSku(products, sku) {
  const codeMatches = products.filter((product) => product.code === sku)
  const identifierMatches = products.filter((product) => product.identifiers.some((identifier) => identifier.value === sku))
  const matches = [...new Map([...codeMatches, ...identifierMatches].map((product) => [product.id, product])).values()]
  if (!matches.length) return { productId: null, confidence: 'UNMATCHED', candidates: [] }
  if (matches.length > 1) {
    return { productId: null, confidence: 'AMBIGUOUS', candidates: matches.map((product) => ({ productId: product.id, code: product.code, name: product.name, matchedBy: codeMatches.includes(product) ? 'PRODUCT_CODE' : 'IDENTIFIER' })) }
  }
  const product = matches[0]
  return {
    productId: product.id,
    confidence: codeMatches.includes(product) ? 'EXACT_PRODUCT_CODE' : 'EXACT_IDENTIFIER',
    candidates: [{ productId: product.id, code: product.code, name: product.name, matchedBy: codeMatches.includes(product) ? 'PRODUCT_CODE' : 'IDENTIFIER' }],
  }
}

/** Validation + the canonical envelope and preview hash (legacy normalizeEnvelope, byte-for-byte). */
export function normalizeEnvelope(input) {
  const parsed = zSupplierCostSheetEnvelope.parse(input)
  const lines = parsed.lines.map((line) => ({
    sku: line.sku, minQty: line.minQty, unitCostForeign: line.unitCostForeign,
    unitsPerCarton: line.unitsPerCarton ?? null, cartonCbm: line.cartonCbm ?? null, cartonKg: line.cartonKg ?? null,
    freightGoodsType: line.freightGoodsType ?? null, leadTimeDays: line.leadTimeDays ?? null,
  }))
  const sourceSha256 = parsed.sourceSha256 || sha256({ businessId: parsed.businessId, supplierId: parsed.supplierId, currency: parsed.currency, fxRateLocked: parsed.fxRateLocked, lines })
  const envelope = { businessId: parsed.businessId, supplierId: parsed.supplierId, currency: parsed.currency, fxRateLocked: parsed.fxRateLocked, sourceRef: parsed.sourceRef ?? null, sourceSha256, lines }
  return { envelope, previewHash: sha256({ ...envelope, sourceRef: undefined }) }
}

export const costSheetCode = (businessId, sourceSha256) => 'SCS-' + sha256({ businessId, sourceSha256 }).slice(0, 16).toUpperCase()

function supplierFor(sql, business, supplierId) {
  const supplier = procurementRepo.supplierById(sql, supplierId)
  if (!supplier || supplier.businessId !== business.id) throw failure(422, 'SUPPLIER_NOT_FOUND')
  if (supplier.status === 'ARCHIVED') throw failure(409, 'SUPPLIER_ARCHIVED')
  return supplier
}

const outcome = (result) => ({ response: result, affected: { sheetId: result.sheet.id, sheetCode: result.sheet.code, sheetVersion: result.sheet.version, status: result.sheet.status, sourceReplay: result.replayed } })

export function previewSupplierCostSheet(sql, scope, input, { now, requestId }) {
  const { envelope, previewHash } = normalizeEnvelope(input)
  const business = procurementAuthority.require(scope, envelope.businessId, 'costSheet')
  supplierFor(sql, business, envelope.supplierId)
  const existing = repo.loadSheet(sql, { businessId: business.id, sourceSha256: envelope.sourceSha256 })
  if (existing) {
    if (existing.previewHash !== previewHash) throw failure(409, 'PROCUREMENT_COST_SHEET_SOURCE_HASH_REUSED')
    return outcome({ replayed: true, sheet: sheetDto(existing) })
  }
  const products = productCandidates(sql, business.id)
  const mappings = envelope.lines.map((line) => ({
    ...line, fxRateLocked: envelope.fxRateLocked,
    unitCostSatang: supplierCostSatang(line.unitCostForeign, envelope.fxRateLocked),
    unitCostBaht: supplierCostBaht(line.unitCostForeign, envelope.fxRateLocked),
    mapping: candidateForSku(products, line.sku),
  }))
  const id = repo.insertSheet(sql, {
    code: costSheetCode(business.id, envelope.sourceSha256), tenantId: business.tenantId, businessId: business.id, supplierId: envelope.supplierId,
    currency: envelope.currency, fxRateLocked: envelope.fxRateLocked, sourceRef: envelope.sourceRef, sourceSha256: envelope.sourceSha256,
    previewHash, previewJson: JSON.stringify({ envelope, mappings }), lineCount: envelope.lines.length, createdByPersonId: scope.actorId, now,
  })
  recordAudit(sql, { entityType: SUPPLIER_COST_SHEET_ENTITY, entityId: id, action: 'SUPPLIER_COST_SHEET_PREVIEWED', actorId: scope.actorId, tenantId: business.tenantId, businessId: business.id, requestId, now, payload: { businessId: business.id, supplierId: envelope.supplierId, sourceSha256: envelope.sourceSha256, lineCount: envelope.lines.length, previewHash } })
  enqueueOutbox(sql, { topic: 'scm.procurement.cost-sheet.previewed', aggregateType: SUPPLIER_COST_SHEET_ENTITY, aggregateId: id, aggregateVersion: 1, now, payload: { businessId: business.id, supplierId: envelope.supplierId, sourceSha256: envelope.sourceSha256, previewHash } })
  return outcome({ replayed: false, sheet: sheetDto(repo.loadSheet(sql, { id })) })
}

function mappingIndex(mappings = []) {
  const bySku = new Map()
  for (const mapping of mappings) {
    if (bySku.has(mapping.sourceSku)) throw failure(422, 'PROCUREMENT_COST_SHEET_MAPPING_DUPLICATE', [{ sourceSku: mapping.sourceSku }])
    bySku.set(mapping.sourceSku, mapping)
  }
  return bySku
}

function mergeProductAttributes(byProductId, productId, line) {
  const current = byProductId.get(productId) || {}
  for (const key of ['unitsPerCarton', 'cartonCbm', 'cartonKg', 'freightGoodsType', 'leadTimeDays']) {
    const value = line[key]
    if (value === undefined || value === null) continue
    if (current[key] !== undefined && current[key] !== value) throw failure(422, 'PROCUREMENT_COST_SHEET_CARTON_CONFLICT', [{ productId, field: key, first: current[key], next: value }])
    current[key] = value
  }
  byProductId.set(productId, current)
}

/** Authorization target of a commit: the Business named by the body (buyer capability). */
export const commitBusiness = (scope, body) => procurementAuthority.require(scope, zSupplierCostSheetCommit.parse(body).businessId, 'costSheet')

export function commitSupplierCostSheet(sql, scope, input, ctx) {
  const { now, faults = {} } = ctx
  const data = zSupplierCostSheetCommit.parse(input)
  const business = procurementAuthority.require(scope, data.businessId, 'costSheet')
  const row = data.sheetId ? repo.loadSheet(sql, { id: data.sheetId }) : repo.loadSheet(sql, { businessId: business.id, sourceSha256: data.sourceSha256 })
  if (!row || row.businessId !== business.id) throw denied()
  if (row.status === 'CONFIRMED') {
    if (data.previewHash && data.previewHash !== row.previewHash) throw failure(409, 'PROCUREMENT_COST_SHEET_PREVIEW_STALE')
    return outcome({ replayed: true, sheet: sheetDto(row) })
  }
  if (row.status === 'SUPERSEDED') throw failure(409, 'PROCUREMENT_COST_SHEET_SUPERSEDED')
  if (!data.previewHash || data.previewHash !== row.previewHash) throw failure(409, 'PROCUREMENT_COST_SHEET_PREVIEW_STALE')

  const preview = parsePreview(row)
  const lines = Array.isArray(preview.envelope?.lines) ? preview.envelope.lines : []
  const mappings = mappingIndex(data.mappings || [])
  const missing = lines.filter((line) => mappings.get(line.sku)?.confirmed !== true).map((line) => line.sku)
  if (missing.length) throw failure(422, 'PROCUREMENT_COST_SHEET_MAPPING_UNCONFIRMED', [...new Set(missing)].map((sourceSku) => ({ sourceSku })))

  const productIds = [...new Set(lines.map((line) => mappings.get(line.sku).productId))]
  const productsById = new Map(productFacts(sql, productIds).map((product) => [product.id, product]))
  for (const mapping of mappings.values()) {
    const product = productsById.get(mapping.productId)
    if (!product || product.businessId !== business.id) throw failure(422, 'PRODUCT_NOT_FOUND', [{ sourceSku: mapping.sourceSku, productId: mapping.productId }])
    if (product.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED', [{ sourceSku: mapping.sourceSku, productId: product.id }])
  }

  const attributesByProductId = new Map()
  for (const line of lines) mergeProductAttributes(attributesByProductId, mappings.get(line.sku).productId, line)
  for (const [productId, attributes] of attributesByProductId) {
    if (Object.keys(attributes).length) setProductCartonAttributes(sql, scope, productId, { businessId: business.id, ...attributes }, ctx)
  }
  faults.afterCartonAttributes?.()

  const previewMappings = new Map((preview.mappings || []).map((line) => [line.sku, line.mapping]))
  for (const line of lines) {
    const mapping = mappings.get(line.sku)
    repo.insertLine(sql, {
      sheetId: row.id, productId: mapping.productId, sourceSku: line.sku, minQty: line.minQty, unitCostForeign: line.unitCostForeign,
      unitsPerCarton: line.unitsPerCarton, cartonCbm: line.cartonCbm, cartonKg: line.cartonKg, freightGoodsType: line.freightGoodsType, leadTimeDays: line.leadTimeDays,
      mappingConfidence: previewMappings.get(line.sku)?.confidence || 'CONFIRMED', mappingConfirmedByPersonId: scope.actorId, mappingConfirmedAt: now, now,
    })
  }
  faults.afterLines?.()

  repo.supersedeConfirmed(sql, { businessId: business.id, supplierId: row.supplierId, exceptId: row.id, now })
  faults.beforeConfirm?.()
  if (repo.confirmSheet(sql, { id: row.id, version: row.version, actorId: scope.actorId, now }) !== 1) throw failure(409, 'PROCUREMENT_COST_SHEET_VERSION_CONFLICT')
  recordAudit(sql, { entityType: SUPPLIER_COST_SHEET_ENTITY, entityId: row.id, action: 'SUPPLIER_COST_SHEET_COMMITTED', actorId: scope.actorId, tenantId: business.tenantId, businessId: business.id, requestId: ctx.requestId, now, payload: { businessId: business.id, supplierId: row.supplierId, sourceSha256: row.sourceSha256, lineCount: lines.length, productCount: productIds.length } })
  faults.afterAudit?.()
  enqueueOutbox(sql, { topic: 'scm.procurement.cost-sheet.committed', aggregateType: SUPPLIER_COST_SHEET_ENTITY, aggregateId: row.id, aggregateVersion: row.version + 1, now, payload: { businessId: business.id, supplierId: row.supplierId, sourceSha256: row.sourceSha256, lineCount: lines.length, productIds } })
  return outcome({ replayed: false, sheet: sheetDto(repo.loadSheet(sql, { id: row.id })) })
}

/** The product page's Procurement half: price breaks from CONFIRMED sheets (the caller has authorized the product read). */
export function supplierCostPriceBreaks(sql, productId) {
  return repo.confirmedLinesOfProduct(sql, productId).map((line) => ({
    id: line.id, sourceSku: line.sourceSku, minQty: line.minQty, unitCostForeign: line.unitCostForeign, currency: line.currency, fxRateLocked: line.fxRateLocked,
    unitCostSatang: supplierCostSatang(line.unitCostForeign, line.fxRateLocked), unitCostBaht: supplierCostBaht(line.unitCostForeign, line.fxRateLocked),
    unitsPerCarton: line.unitsPerCarton, cartonCbm: line.cartonCbm, cartonKg: line.cartonKg, freightGoodsType: line.freightGoodsType, leadTimeDays: line.leadTimeDays,
    sheet: { id: line.sheetId, code: line.sheetCode, sourceSha256: line.sourceSha256, confirmedAt: line.confirmedAt, supplier: line.supplier },
  }))
}

export function getSupplierCostSheet(sql, scope, id) {
  const sheetId = typeof id === 'string' ? id.trim() : ''
  if (!sheetId) throw denied()
  const row = repo.loadSheet(sql, { id: sheetId })
  if (!row || row.tenantId !== scope.tenantId) throw denied()
  procurementAuthority.require(scope, row.businessId)
  return sheetDto(row)
}

export function listSupplierCostSheets(sql, scope, { businessId, supplierId, status, limit = 20 } = {}) {
  const id = typeof businessId === 'string' ? businessId.trim() : ''
  const business = procurementAuthority.require(scope, id)
  const take = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20))
  const rows = repo.listSheets(sql, { businessId: business.id, supplierId, status, take })
  return { businessId: business.id, sheets: rows.map(sheetDto) }
}
