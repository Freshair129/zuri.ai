import crypto from 'node:crypto'
import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { setProductCartonAttributes } from '@/modules/inventory'
import {
  SUPPLIER_COST_SHEET_ENTITY,
  supplierCostBaht,
  supplierCostSatang,
  zSupplierCostSheetCommit,
  zSupplierCostSheetEnvelope,
} from '../domain/procurement'
import { loadBusiness, notFound } from './procurement-authority'

// @req FR-164, FR-154 — TASK-ZAI-053 is the Procurement intake boundary and
//   calls Inventory only through its explicit Product carton writer.
// @spec ZAI:PROPOSAL-SMARTGIFT-COST-QUOTE-ENGINE-20260913; TASK-ZAI-053 —
//   preview stores the normalized source and suggestions only; commit requires
//   an explicit person-confirmed product mapping before it creates any line.
//   A source hash is unique per Business, and the confirmed write plus Product
//   carton update share one transaction.
// @tested tests/integration/task-zai-053-supplier-cost-sheet.test.js

const failure = (status, message, details) => Object.assign(new Error(message), { status }, details === undefined ? {} : { details })
const inTx = (db, fn) => (typeof db?.$transaction === 'function' ? db.$transaction(fn) : fn(db))
const actor = (viewer) => viewer?.principal?.id ?? null

const SHEET_SELECT = {
  id: true,
  code: true,
  tenantId: true,
  businessId: true,
  supplierId: true,
  currency: true,
  fxRateLocked: true,
  sourceRef: true,
  sourceSha256: true,
  previewHash: true,
  previewJson: true,
  status: true,
  lineCount: true,
  createdByPersonId: true,
  confirmedByPersonId: true,
  confirmedAt: true,
  supersededAt: true,
  createdAt: true,
  updatedAt: true,
  version: true,
  supplier: { select: { id: true, code: true, name: true } },
  lines: {
    select: {
      id: true,
      sheetId: true,
      productId: true,
      sourceSku: true,
      minQty: true,
      unitCostForeign: true,
      unitsPerCarton: true,
      cartonCbm: true,
      cartonKg: true,
      freightGoodsType: true,
      leadTimeDays: true,
      mappingConfidence: true,
      mappingConfirmedByPersonId: true,
      mappingConfirmedAt: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [{ minQty: 'asc' }, { sourceSku: 'asc' }],
  },
}

const SHEET_SUMMARY_SELECT = { ...SHEET_SELECT, previewJson: false, lines: false }
const PRODUCT_CANDIDATE_SELECT = {
  id: true,
  code: true,
  name: true,
  status: true,
  identifiers: { where: { status: 'ACTIVE' }, select: { kind: true, value: true } },
}

const actorId = (viewer) => actor(viewer)

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]))
  return value
}

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')
}

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
    id: line.id,
    sheetId: sheet.id,
    productId: line.productId,
    sourceSku: line.sourceSku,
    minQty: line.minQty,
    unitCostForeign: line.unitCostForeign,
    currency: sheet.currency,
    fxRateLocked,
    unitCostSatang: supplierCostSatang(line.unitCostForeign, fxRateLocked),
    unitCostBaht: supplierCostBaht(line.unitCostForeign, fxRateLocked),
    unitsPerCarton: line.unitsPerCarton,
    cartonCbm: line.cartonCbm,
    cartonKg: line.cartonKg,
    freightGoodsType: line.freightGoodsType,
    leadTimeDays: line.leadTimeDays,
    mappingConfidence: line.mappingConfidence,
    mappingConfirmedByPersonId: line.mappingConfirmedByPersonId,
    mappingConfirmedAt: line.mappingConfirmedAt,
    createdAt: line.createdAt,
    updatedAt: line.updatedAt,
  }
}

function candidateForSku(products, sku) {
  const codeMatches = products.filter((product) => product.code === sku)
  const identifierMatches = products.filter((product) => product.identifiers.some((identifier) => identifier.value === sku))
  const matches = [...new Map([...codeMatches, ...identifierMatches].map((product) => [product.id, product])).values()]
  if (!matches.length) return { productId: null, confidence: 'UNMATCHED', candidates: [] }
  if (matches.length > 1) {
    return {
      productId: null,
      confidence: 'AMBIGUOUS',
      candidates: matches.map((product) => ({ productId: product.id, code: product.code, name: product.name, matchedBy: codeMatches.includes(product) ? 'PRODUCT_CODE' : 'IDENTIFIER' })),
    }
  }
  const product = matches[0]
  return {
    productId: product.id,
    confidence: codeMatches.includes(product) ? 'EXACT_PRODUCT_CODE' : 'EXACT_IDENTIFIER',
    candidates: [{ productId: product.id, code: product.code, name: product.name, matchedBy: codeMatches.includes(product) ? 'PRODUCT_CODE' : 'IDENTIFIER' }],
  }
}

async function resolvePreviewLines(tx, businessId, lines) {
  const products = await tx.product.findMany({ where: { businessId, status: { not: 'ARCHIVED' } }, select: PRODUCT_CANDIDATE_SELECT })
  return lines.map((line) => {
    const mapping = candidateForSku(products, line.sku)
    return {
      ...line,
      unitCostSatang: supplierCostSatang(line.unitCostForeign, line.fxRateLocked),
      unitCostBaht: supplierCostBaht(line.unitCostForeign, line.fxRateLocked),
      mapping,
    }
  })
}

function normalizeEnvelope(input) {
  const parsed = zSupplierCostSheetEnvelope.parse(input)
  const lines = parsed.lines.map((line) => ({
    sku: line.sku,
    minQty: line.minQty,
    unitCostForeign: line.unitCostForeign,
    unitsPerCarton: line.unitsPerCarton ?? null,
    cartonCbm: line.cartonCbm ?? null,
    cartonKg: line.cartonKg ?? null,
    freightGoodsType: line.freightGoodsType ?? null,
    leadTimeDays: line.leadTimeDays ?? null,
  }))
  const sourceSha256 = parsed.sourceSha256 || sha256({
    businessId: parsed.businessId,
    supplierId: parsed.supplierId,
    currency: parsed.currency,
    fxRateLocked: parsed.fxRateLocked,
    lines,
  })
  const envelope = {
    businessId: parsed.businessId,
    supplierId: parsed.supplierId,
    currency: parsed.currency,
    fxRateLocked: parsed.fxRateLocked,
    sourceRef: parsed.sourceRef ?? null,
    sourceSha256,
    lines,
  }
  return { envelope, previewHash: sha256({ ...envelope, sourceRef: undefined }) }
}

function previewFromRow(row) {
  const value = parsePreview(row)
  return {
    hash: row.previewHash,
    lines: Array.isArray(value.mappings) ? value.mappings : [],
  }
}

function sheetDto(row) {
  if (!row) return row
  const { previewJson, lines, ...rest } = row
  return {
    ...rest,
    preview: previewJson ? previewFromRow({ ...row, previewJson }) : null,
    lines: (lines || []).map((line) => lineDto(line, row)),
  }
}

function codeFor(businessId, sourceSha256) {
  return 'SCS-' + sha256({ businessId, sourceSha256 }).slice(0, 16).toUpperCase()
}

async function supplierFor(tx, businessId, supplierId) {
  const supplier = await tx.supplier.findUnique({ where: { id: supplierId }, select: { id: true, businessId: true, status: true } })
  if (!supplier || supplier.businessId !== businessId) throw failure(422, 'SUPPLIER_NOT_FOUND')
  if (supplier.status === 'ARCHIVED') throw failure(409, 'SUPPLIER_ARCHIVED')
  return supplier
}

export async function previewSupplierCostSheet(input, { viewer, db = prisma } = {}) {
  const { envelope, previewHash } = normalizeEnvelope(input)
  return inTx(db, async (tx) => {
    const business = await loadBusiness(tx, viewer, envelope.businessId, { capability: 'costSheet' })
    await supplierFor(tx, business.id, envelope.supplierId)
    const existing = await tx.supplierCostSheet.findUnique({
      where: { businessId_sourceSha256: { businessId: business.id, sourceSha256: envelope.sourceSha256 } },
      select: SHEET_SELECT,
    })
    if (existing) {
      if (existing.previewHash !== previewHash) throw failure(409, 'PROCUREMENT_COST_SHEET_SOURCE_HASH_REUSED')
      return { replayed: true, sheet: sheetDto(existing) }
    }

    const mappings = await resolvePreviewLines(tx, business.id, envelope.lines.map((line) => ({ ...line, fxRateLocked: envelope.fxRateLocked })))
    const row = await tx.supplierCostSheet.create({
      data: {
        code: codeFor(business.id, envelope.sourceSha256),
        tenantId: business.tenantId,
        businessId: business.id,
        supplierId: envelope.supplierId,
        currency: envelope.currency,
        fxRateLocked: envelope.fxRateLocked,
        sourceRef: envelope.sourceRef,
        sourceSha256: envelope.sourceSha256,
        previewHash,
        previewJson: JSON.stringify({ envelope, mappings }),
        status: 'DRAFT',
        lineCount: envelope.lines.length,
        createdByPersonId: actorId(viewer),
      },
      select: SHEET_SELECT,
    })
    await recordAudit(tx, {
      entityType: SUPPLIER_COST_SHEET_ENTITY,
      entityId: row.id,
      action: 'SUPPLIER_COST_SHEET_PREVIEWED',
      actorId: actorId(viewer),
      tenantId: business.tenantId,
      businessId: business.id,
      payload: { businessId: business.id, supplierId: envelope.supplierId, sourceSha256: envelope.sourceSha256, lineCount: envelope.lines.length, previewHash },
    })
    return { replayed: false, sheet: sheetDto(row) }
  })
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
  const keys = ['unitsPerCarton', 'cartonCbm', 'cartonKg', 'freightGoodsType', 'leadTimeDays']
  const current = byProductId.get(productId) || {}
  for (const key of keys) {
    const value = line[key]
    if (value === undefined || value === null) continue
    if (current[key] !== undefined && current[key] !== value) {
      throw failure(422, 'PROCUREMENT_COST_SHEET_CARTON_CONFLICT', [{ productId, field: key, first: current[key], next: value }])
    }
    current[key] = value
  }
  byProductId.set(productId, current)
}

export async function commitSupplierCostSheet(input, { viewer, db = prisma, now = new Date() } = {}) {
  const data = zSupplierCostSheetCommit.parse(input)
  return inTx(db, async (tx) => {
    const business = await loadBusiness(tx, viewer, data.businessId, { capability: 'costSheet' })
    const row = data.sheetId
      ? await tx.supplierCostSheet.findFirst({ where: { id: data.sheetId, businessId: business.id }, select: SHEET_SELECT })
      : await tx.supplierCostSheet.findUnique({ where: { businessId_sourceSha256: { businessId: business.id, sourceSha256: data.sourceSha256 } }, select: SHEET_SELECT })
    if (!row) throw notFound()
    if (row.status === 'CONFIRMED') {
      if (data.previewHash && data.previewHash !== row.previewHash) throw failure(409, 'PROCUREMENT_COST_SHEET_PREVIEW_STALE')
      return { replayed: true, sheet: sheetDto(row) }
    }
    if (row.status === 'SUPERSEDED') throw failure(409, 'PROCUREMENT_COST_SHEET_SUPERSEDED')
    if (!data.previewHash || data.previewHash !== row.previewHash) throw failure(409, 'PROCUREMENT_COST_SHEET_PREVIEW_STALE')
    // @req FR-164 — one CONFIRMED sheet per supplier: commits of that supplier's
    // sheets take the supplier row lock first, so the supersession below sees
    // any sheet a concurrent commit confirmed. Without it, PostgreSQL READ
    // COMMITTED let two commits each supersede before the other confirmed and
    // leave two CONFIRMED sheets (SCM-HANDOFF F-12,
    // tests/integration/scm-legacy-races.postgres.test.js). Lock-only: no value changes.
    // (`inTx` also accepts a transaction-less db double; it has no concurrency to guard.)
    if (typeof tx.$executeRaw === 'function') await tx.$executeRaw`UPDATE "Supplier" SET "updatedAt" = "updatedAt" WHERE "id" = ${row.supplierId}`

    const preview = parsePreview(row)
    const envelope = preview.envelope
    const lines = Array.isArray(envelope?.lines) ? envelope.lines : []
    const mappings = mappingIndex(data.mappings || [])
    const missing = lines.filter((line) => mappings.get(line.sku)?.confirmed !== true).map((line) => line.sku)
    if (missing.length) throw failure(422, 'PROCUREMENT_COST_SHEET_MAPPING_UNCONFIRMED', [...new Set(missing)].map((sourceSku) => ({ sourceSku })))

    const productIds = [...new Set(lines.map((line) => mappings.get(line.sku).productId))]
    const products = await tx.product.findMany({ where: { id: { in: productIds } }, select: { id: true, code: true, businessId: true, status: true } })
    const productsById = new Map(products.map((product) => [product.id, product]))
    for (const mapping of mappings.values()) {
      const product = productsById.get(mapping.productId)
      if (!product || product.businessId !== business.id) throw failure(422, 'PRODUCT_NOT_FOUND', [{ sourceSku: mapping.sourceSku, productId: mapping.productId }])
      if (product.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED', [{ sourceSku: mapping.sourceSku, productId: product.id }])
    }

    const attributesByProductId = new Map()
    for (const line of lines) mergeProductAttributes(attributesByProductId, mappings.get(line.sku).productId, line)
    for (const [productId, attributes] of attributesByProductId) {
      if (Object.keys(attributes).length) {
        await setProductCartonAttributes(productId, { businessId: business.id, ...attributes }, { viewer, db: tx })
      }
    }

    const previewMappings = new Map((preview.mappings || []).map((line) => [line.sku, line.mapping]))
    for (const line of lines) {
      const mapping = mappings.get(line.sku)
      await tx.supplierCostLine.create({
        data: {
          sheetId: row.id,
          productId: mapping.productId,
          sourceSku: line.sku,
          minQty: line.minQty,
          unitCostForeign: line.unitCostForeign,
          unitsPerCarton: line.unitsPerCarton ?? null,
          cartonCbm: line.cartonCbm ?? null,
          cartonKg: line.cartonKg ?? null,
          freightGoodsType: line.freightGoodsType ?? null,
          leadTimeDays: line.leadTimeDays ?? null,
          mappingConfidence: previewMappings.get(line.sku)?.confidence || 'CONFIRMED',
          mappingConfirmedByPersonId: actorId(viewer),
          mappingConfirmedAt: now,
        },
      })
    }

    await tx.supplierCostSheet.updateMany({
      where: { businessId: business.id, supplierId: row.supplierId, status: 'CONFIRMED', id: { not: row.id } },
      data: { status: 'SUPERSEDED', supersededAt: now, version: { increment: 1 } },
    })
    const updated = await tx.supplierCostSheet.updateMany({
      where: { id: row.id, version: row.version, status: 'DRAFT' },
      data: { status: 'CONFIRMED', confirmedByPersonId: actorId(viewer), confirmedAt: now, version: { increment: 1 } },
    })
    if (updated.count !== 1) throw failure(409, 'PROCUREMENT_COST_SHEET_VERSION_CONFLICT')
    await recordAudit(tx, {
      entityType: SUPPLIER_COST_SHEET_ENTITY,
      entityId: row.id,
      action: 'SUPPLIER_COST_SHEET_COMMITTED',
      actorId: actorId(viewer),
      tenantId: business.tenantId,
      businessId: business.id,
      payload: { businessId: business.id, supplierId: row.supplierId, sourceSha256: row.sourceSha256, lineCount: lines.length, productCount: productIds.length },
    })
    const fresh = await tx.supplierCostSheet.findUnique({ where: { id: row.id }, select: SHEET_SELECT })
    return { replayed: false, sheet: sheetDto(fresh) }
  })
}

export async function getSupplierCostSheet(id, { viewer, db = prisma } = {}) {
  const sheetId = typeof id === 'string' ? id.trim() : ''
  if (!sheetId) throw notFound()
  const row = await db.supplierCostSheet.findUnique({ where: { id: sheetId }, select: SHEET_SELECT })
  if (!row) throw notFound()
  await loadBusiness(db, viewer, row.businessId)
  return sheetDto(row)
}

export async function listSupplierCostSheets({ businessId, supplierId, status, limit = 20, viewer, db = prisma } = {}) {
  const business = await loadBusiness(db, viewer, businessId)
  const take = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20))
  const rows = await db.supplierCostSheet.findMany({
    where: { businessId: business.id, ...(supplierId ? { supplierId } : {}), ...(status ? { status } : {}) },
    orderBy: [{ createdAt: 'desc' }],
    take,
    select: SHEET_SUMMARY_SELECT,
  })
  return { businessId: business.id, sheets: rows.map(sheetDto) }
}
