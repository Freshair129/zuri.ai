import crypto from 'node:crypto'
import { z } from 'zod'
import {
  INVENTORY_CATALOG_INTAKE_CHANNELS,
  INVENTORY_CATALOG_INTAKE_DECISIONS,
  INVENTORY_IDENTIFIER_KINDS,
  INVENTORY_STOCK_POLICIES,
  INVENTORY_TRACKING_MODES,
  INVENTORY_UNIT_USAGES,
} from '@/lib/validation/enums'
import { zInventoryCode } from './inventory'
import {
  INVENTORY_SCANNABLE_IDENTIFIER_KINDS,
  UNIT_CODE_PATTERN,
  isValidGtin,
  lookalikeFingerprint,
  natureRule,
  normalizeToken,
  variantKeyFor,
  variantValues,
  zDefaultStockPolicy,
  zProductNature,
  zVariant,
  zVariantAxes,
} from './inventory-governance'

// @req FR-208 — the catalogue intake envelope and its planner (ADR-084). Every
//   surface (JSON, Excel, LINE) converts into this one envelope; items are
//   validated one by one so a bad row is an INVALID item, not a rejected file;
//   and for every valid item the planner RESOLVES before it considers creating:
//   active identifiers first, then the SKU code (a merged duplicate followed to
//   its survivor). Two different SKUs → CONFLICT. One SKU → MATCH, which only
//   adds the identifiers and conversions it lacks and warns about everything
//   else, never overwriting. Nothing → CREATE, which still passes every
//   ADR-083 guard against the catalogue AND against the other rows of the batch.
//   Pure: the service gathers a snapshot, this decides, so a preview and a
//   commit decide identically and a test can prove it without a database.
// @spec ADR-084 D1, D2; ADR-083; BR-002, BR-009, BR-037, BR-038, BR-039, BR-041; SDD-009
// @tested tests/unit/inventory-catalog-intake.test.js

export const CATALOG_INTAKE_ENTITY = 'INVENTORY_CATALOG_INTAKE'
export const CATALOG_INTAKE_SCHEMA_VERSION = '1.0'
export const CATALOG_INTAKE_MAX_ITEMS = 500
export const CATALOG_INTAKE_PREVIEW_TTL_MS = Object.freeze({ LINE_OA: 30 * 60 * 1000, DEFAULT: 24 * 60 * 60 * 1000 })
const MAX_MERGE_HOPS = 10

const zText = (max) => z.string().trim().min(1).max(max)
const zOptionalText = (max) => z.string().trim().max(max).nullable().optional()

// ── Contract ────────────────────────────────────────────────────────────────

export const zCatalogIntakeIdentifier = z.object({
  kind: z.enum(INVENTORY_IDENTIFIER_KINDS),
  value: z.string().trim().min(1).max(100).regex(/^\S+$/, 'an identifier carries no whitespace'),
  issuer: zOptionalText(100),
  unit: z.string().trim().regex(UNIT_CODE_PATTERN).nullable().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.kind === 'GTIN' && !isValidGtin(value.value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'a GTIN is 8, 12, 13 or 14 digits with a valid check digit' })
  }
})

export const zCatalogIntakeConversion = z.object({
  unit: z.string().trim().regex(UNIT_CODE_PATTERN, 'a unit is 1–20 letters, digits, ".", "-" or "_"'),
  factor: z.number().int().positive().max(1_000_000),
  usage: z.enum(INVENTORY_UNIT_USAGES).optional(),
  name: zOptionalText(100),
}).strict()

export const zCatalogIntakeItem = z.object({
  ref: z.string().trim().min(1).max(60).optional(),
  sku: z.object({
    code: zInventoryCode,
    name: zOptionalText(200),
    color: zOptionalText(100),
    material: zOptionalText(100),
    unit: z.string().trim().regex(UNIT_CODE_PATTERN).optional(),
    variant: zVariant.optional(),
    stockPolicy: z.enum(INVENTORY_STOCK_POLICIES).optional(),
    trackingMode: z.enum(INVENTORY_TRACKING_MODES).optional(),
    safetyStock: z.number().int().nonnegative().optional(),
    reorderPoint: z.number().int().nonnegative().nullable().optional(),
    reorderQty: z.number().int().positive().nullable().optional(),
    leadTimeDays: z.number().int().nonnegative().max(3650).nullable().optional(),
    allowLookalike: z.boolean().optional(),
  }).strict(),
  master: z.object({
    code: zInventoryCode,
    categoryCode: zInventoryCode.optional(),
    nameTh: zText(200).optional(),
    nameEn: zText(200).optional(),
    nature: zProductNature.optional(),
    defaultStockPolicy: zDefaultStockPolicy.optional(),
    variantAxes: zVariantAxes.optional(),
  }).strict(),
  identifiers: z.array(zCatalogIntakeIdentifier).max(10).optional(),
  unitConversions: z.array(zCatalogIntakeConversion).max(10)
    .refine((rows) => new Set(rows.map((r) => r.unit)).size === rows.length, 'a unit appears once per item').optional(),
}).strict()

/** The envelope header is strict; items stay unknown here so each is judged on its own. */
export const zCatalogIntakeEnvelope = z.object({
  schemaVersion: z.literal(CATALOG_INTAKE_SCHEMA_VERSION),
  businessId: z.string().trim().min(1).max(200),
  source: z.object({
    channel: z.enum(INVENTORY_CATALOG_INTAKE_CHANNELS),
    correlationId: z.string().trim().min(1).max(200),
  }).strict(),
  items: z.array(z.unknown()).min(1).max(CATALOG_INTAKE_MAX_ITEMS),
}).strict()

export const zCommitCatalogIntake = z.object({
  businessId: z.string().trim().min(1).max(200),
  intakeId: z.string().trim().min(1).max(200),
  planHash: z.string().trim().regex(/^[a-f0-9]{64}$/, 'planHash is the 64-character hex hash the preview returned'),
}).strict()

export const zCatalogIntakeAction = z.object({
  action: z.literal('CANCEL'),
  version: z.number().int().positive(),
}).strict()

// ── Hashing ─────────────────────────────────────────────────────────────────

/** Deep key-sorted JSON: the same data always serialises to the same bytes. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return `{${Object.keys(value).filter((k) => value[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value instanceof Date ? value.toISOString() : value ?? null)
}

export const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex')

/** The payload hash an idempotent preview compares: the envelope minus nothing. */
export function catalogIntakePayloadHash(envelope) {
  return sha256(canonicalJson(envelope))
}

/** A short human code for a preview, stable for one (Business, channel, correlation). */
export function catalogIntakeCode({ businessId, channel, correlationId }) {
  return `CIT-${sha256(`${businessId}|${channel}|${correlationId}`).slice(0, 8).toUpperCase()}`
}

/** What a commit must match: every decision and every action, never a warning. */
export function catalogIntakePlanHash(plan) {
  return sha256(canonicalJson(plan.items.map((item) => ({ ref: item.ref, decision: item.decision, productId: item.product?.id ?? null, actions: item.actions }))))
}

// ── Planner ─────────────────────────────────────────────────────────────────

const collisionKey = (kind, value) => (INVENTORY_SCANNABLE_IDENTIFIER_KINDS.includes(kind) ? `SCAN:${value}` : `${kind}:${value}`)

function zodIssues(error) {
  return error.issues.map((issue) => ({ level: 'INVALID', code: 'INTAKE_ITEM_INVALID', path: issue.path.join('.'), message: issue.message }))
}

/**
 * Resolve a product id to the SKU that survives it: a merged duplicate points
 * at its survivor, and the chain is walked the way `resolveProduct` walks it.
 */
function survivorOf(productsById, id) {
  let current = productsById.get(id) ?? null
  const redirectedFrom = []
  let hops = 0
  while (current?.mergedIntoProductId && hops < MAX_MERGE_HOPS) {
    const next = productsById.get(current.mergedIntoProductId)
    if (!next) break
    redirectedFrom.push(current.code)
    current = next
    hops += 1
  }
  return { product: current, redirectedFrom }
}

const differs = (given, existing) => given !== undefined && given !== null && normalizeToken(given) !== normalizeToken(existing)

/**
 * Plan one envelope against a catalogue snapshot. The snapshot is plain data:
 *   businessId, categoriesByCode, mastersByCode, mastersById, productsByCode,
 *   productsById, identifierRows [{kind,value,status,productId}],
 *   conversionsByProductId, productsByMasterId.
 * Returns `{ items, counts, committable }`; `catalogIntakePlanHash` hashes it.
 */
export function planCatalogIntake(envelope, snapshot) {
  const {
    businessId,
    categoriesByCode = new Map(),
    mastersByCode = new Map(),
    mastersById = new Map(),
    productsByCode = new Map(),
    productsById = new Map(),
    identifierRows = [],
    conversionsByProductId = new Map(),
    productsByMasterId = new Map(),
  } = snapshot
  const batch = { codes: new Map(), identifiers: new Map(), variantKeys: new Map(), fingerprints: new Map(), newMasters: new Map() }
  const items = []

  envelope.items.forEach((raw, index) => {
    const ref = (raw && typeof raw === 'object' && typeof raw.ref === 'string' && raw.ref.trim()) ? raw.ref.trim() : String(index + 1)
    const out = { index, ref, code: raw?.sku?.code ?? null, decision: null, matchedBy: null, product: null, master: null, actions: [], issues: [], warnings: [] }
    const issue = (level, code, path, message, extra = {}) => out.issues.push({ level, code, path, message, ...extra })
    const warn = (code, message, extra = {}) => out.warnings.push({ code, message, ...extra })
    const settle = () => {
      out.decision = out.issues.some((i) => i.level === 'INVALID') ? 'INVALID'
        : out.issues.some((i) => i.level === 'CONFLICT') ? 'CONFLICT'
          : out.actions.length ? (out.actions.some((a) => a.type === 'CREATE_PRODUCT') ? 'CREATE' : 'MATCH') : 'UNCHANGED'
      items.push(out)
    }

    const parsed = zCatalogIntakeItem.safeParse(raw)
    if (!parsed.success) { out.issues.push(...zodIssues(parsed.error)); return settle() }
    const item = parsed.data
    out.code = item.sku.code
    const identifiers = item.identifiers ?? []
    const conversions = item.unitConversions ?? []

    // ── Within the batch: a code, an identifier, a variant or a description appears once.
    const firstWithCode = batch.codes.get(item.sku.code)
    if (firstWithCode) issue('CONFLICT', 'INTAKE_DUPLICATE_IN_BATCH', 'sku.code', `รหัส ${item.sku.code} ซ้ำกับรายการ ${firstWithCode}`, { firstRef: firstWithCode })
    else batch.codes.set(item.sku.code, ref)
    const seenInItem = new Set()
    identifiers.forEach((identifier, i) => {
      const key = collisionKey(identifier.kind, identifier.value)
      if (seenInItem.has(key)) return issue('INVALID', 'INTAKE_IDENTIFIER_REPEATED', `identifiers.${i}.value`, `รหัส ${identifier.value} ซ้ำในรายการเดียวกัน`)
      seenInItem.add(key)
      const first = batch.identifiers.get(key)
      if (first && first !== ref) issue('CONFLICT', 'INTAKE_DUPLICATE_IN_BATCH', `identifiers.${i}.value`, `รหัส ${identifier.value} ซ้ำกับรายการ ${first}`, { firstRef: first })
      else batch.identifiers.set(key, ref)
    })
    if (out.issues.length) return settle()

    // ── Resolve before create (BR-041): active identifiers first, then the code.
    const holders = []
    identifiers.forEach((identifier) => {
      for (const row of identifierRows) {
        if (row.value !== identifier.value) continue
        if (collisionKey(row.kind, row.value) !== collisionKey(identifier.kind, identifier.value)) continue
        if (row.status !== 'ACTIVE') continue
        const { product, redirectedFrom } = survivorOf(productsById, row.productId)
        if (product) holders.push({ by: 'IDENTIFIER', product, redirectedFrom, value: identifier.value })
      }
    })
    const codeHolder = productsByCode.get(item.sku.code)
    if (codeHolder) {
      const { product, redirectedFrom } = survivorOf(productsById, codeHolder.id)
      if (product) holders.push({ by: 'CODE', product, redirectedFrom, value: item.sku.code })
    }
    const distinct = [...new Map(holders.map((h) => [h.product.id, h.product])).values()]

    if (distinct.length > 1) {
      issue('CONFLICT', 'INTAKE_MATCHES_DIFFERENT_SKUS', 'identifiers', `รหัสในรายการนี้ชี้ไปที่ SKU ต่างกัน: ${distinct.map((p) => p.businessId === businessId ? p.code : '(Business อื่น)').join(', ')}`,
        { productIds: distinct.filter((p) => p.businessId === businessId).map((p) => p.id) })
      return settle()
    }

    if (distinct.length === 1) {
      const product = distinct[0]
      // A code is unique per Tenant; the holder in another Business cannot be matched and must not be described.
      if (product.businessId !== businessId) {
        issue('CONFLICT', 'INTAKE_CODE_TAKEN_IN_TENANT', 'sku.code', 'รหัสหรือบาร์โค้ดนี้ถูกใช้แล้วใน Tenant นี้ — ใช้รหัสอื่น')
        return settle()
      }
      out.product = { id: product.id, code: product.code }
      out.matchedBy = holders.some((h) => h.by === 'IDENTIFIER') ? 'IDENTIFIER' : 'CODE'
      const redirected = holders.flatMap((h) => h.redirectedFrom)
      if (redirected.length) warn('INTAKE_REDIRECTED_FROM_MERGED', `${[...new Set(redirected)].join(', ')} ถูกรวมเข้ากับ ${product.code} แล้ว`)
      if (product.status === 'ARCHIVED') {
        issue('CONFLICT', 'INTAKE_MATCHED_SKU_ARCHIVED', 'sku.code', `SKU ${product.code} ถูกเก็บถาวร — REACTIVATE ก่อนแล้วนำเข้าใหม่`)
        return settle()
      }
      if (product.code !== item.sku.code) warn('INTAKE_CODE_DIFFERS', `ในไฟล์ใช้รหัส ${item.sku.code} แต่บาร์โค้ดตรงกับ SKU ${product.code}`)
      const productMaster = mastersById.get(product.productMasterId)
      if (productMaster && productMaster.code !== item.master.code) warn('INTAKE_MASTER_DIFFERS', `SKU ${product.code} อยู่ใต้สินค้าหลัก ${productMaster.code} ไม่ใช่ ${item.master.code} — ไม่ย้าย`)
      const changed = ['name', 'color', 'material', 'unit'].filter((field) => differs(item.sku[field], product[field]))
      if (changed.length) warn('INTAKE_FIELDS_NOT_UPDATED', `ข้อมูล ${changed.join(', ')} ต่างจาก SKU เดิม — การนำเข้าไม่แก้ข้อมูลของ SKU ที่มีอยู่`, { fields: changed })

      const existingConversions = conversionsByProductId.get(product.id) ?? []
      const unitsAvailable = new Set([product.unit, ...existingConversions.filter((c) => c.status === 'ACTIVE').map((c) => c.unit)])
      if (conversions.length && (product.stockPolicy === 'SERVICE' || product.trackingMode === 'SERIAL')) {
        issue('INVALID', product.stockPolicy === 'SERVICE' ? 'INVENTORY_PRODUCT_IS_A_SERVICE' : 'INVENTORY_UNIT_NOT_FOR_SERIAL', 'unitConversions', 'SKU นี้รับหน่วยแปลงไม่ได้')
      } else {
        conversions.forEach((conversion, i) => {
          if (conversion.unit === product.unit) return issue('INVALID', 'INVENTORY_UNIT_IS_BASE', `unitConversions.${i}.unit`, `${conversion.unit} คือหน่วยฐานของ SKU อยู่แล้ว`)
          const existing = existingConversions.find((c) => c.unit === conversion.unit)
          if (existing && existing.status !== 'ACTIVE') return issue('CONFLICT', 'INTAKE_UNIT_RETIRED', `unitConversions.${i}.unit`, `หน่วย ${conversion.unit} ของ SKU นี้ถูกยกเลิกไปแล้ว`)
          if (existing && existing.factor !== conversion.factor) return issue('CONFLICT', 'INTAKE_UNIT_FACTOR_DIFFERS', `unitConversions.${i}.factor`, `SKU นี้มี ${conversion.unit} = ${existing.factor} อยู่แล้ว ไม่ใช่ ${conversion.factor}`)
          if (existing) return undefined
          unitsAvailable.add(conversion.unit)
          out.actions.push({ type: 'ADD_UNIT_CONVERSION', productId: product.id, productCode: null, payload: { unit: conversion.unit, factor: conversion.factor, usage: conversion.usage ?? 'ANY', name: conversion.name ?? null } })
          return undefined
        })
      }
      identifiers.forEach((identifier, i) => {
        const rows = identifierRows.filter((row) => collisionKey(row.kind, row.value) === collisionKey(identifier.kind, identifier.value))
        const onThis = rows.find((row) => survivorOf(productsById, row.productId).product?.id === product.id && row.status === 'ACTIVE')
        if (onThis) return undefined
        const retiredHere = rows.find((row) => row.productId === product.id)
        if (retiredHere) return issue('CONFLICT', 'INTAKE_IDENTIFIER_RETIRED', `identifiers.${i}.value`, `รหัส ${identifier.value} ของ SKU นี้ถูกยกเลิกไปแล้ว ใช้ซ้ำไม่ได้`)
        if (rows.length) return issue('CONFLICT', 'INTAKE_IDENTIFIER_TAKEN', `identifiers.${i}.value`, `รหัส ${identifier.value} ถูกใช้แล้ว (อาจเป็นรหัสที่ยกเลิกไปแล้ว) ใช้ซ้ำไม่ได้`)
        if (identifier.unit && !unitsAvailable.has(identifier.unit)) return issue('INVALID', 'INVENTORY_UNIT_UNKNOWN', `identifiers.${i}.unit`, `หน่วย ${identifier.unit} ยังไม่มีใน SKU นี้`)
        out.actions.push({ type: 'ADD_IDENTIFIER', productId: product.id, productCode: null, payload: { kind: identifier.kind, value: identifier.value, issuer: identifier.issuer ?? null, unit: identifier.unit && identifier.unit !== product.unit ? identifier.unit : null } })
        return undefined
      })
      return settle()
    }

    // ── Nothing resolved: plan a create, under every ADR-083 guard.
    let master = mastersByCode.get(item.master.code) ?? null
    let masterSpec = null
    if (master) {
      if (master.businessId !== businessId) { issue('CONFLICT', 'INTAKE_MASTER_CODE_TAKEN', 'master.code', `รหัสสินค้าหลัก ${item.master.code} ถูกใช้แล้วใน Tenant นี้`); return settle() }
      if (master.status === 'ARCHIVED') { issue('INVALID', 'PRODUCT_MASTER_ARCHIVED', 'master.code', `สินค้าหลัก ${master.code} ถูกเก็บถาวร`); return settle() }
      masterSpec = { nature: master.nature, defaultStockPolicy: master.defaultStockPolicy, variantAxes: master.variantAxes ?? [] }
      out.master = { id: master.id, code: master.code, created: false }
    } else if (batch.newMasters.has(item.master.code)) {
      const planned = batch.newMasters.get(item.master.code)
      const given = ['categoryCode', 'nameTh', 'nameEn', 'nature', 'defaultStockPolicy'].filter((key) => item.master[key] !== undefined && item.master[key] !== planned.payload[key])
      const axesGiven = item.master.variantAxes !== undefined && canonicalJson(item.master.variantAxes) !== canonicalJson(planned.payload.variantAxes)
      if (given.length || axesGiven) { issue('INVALID', 'INTAKE_MASTER_INCONSISTENT', 'master', `สินค้าหลัก ${item.master.code} ในรายการ ${planned.ref} ระบุต่างจากรายการนี้`, { firstRef: planned.ref }); return settle() }
      masterSpec = planned.payload
      out.master = { id: null, code: item.master.code, created: true, createdBy: planned.ref }
    } else {
      const missing = ['categoryCode', 'nameTh', 'nameEn'].filter((key) => !item.master[key])
      if (missing.length) { issue('INVALID', 'INTAKE_MASTER_NOT_FOUND', 'master.code', `ไม่พบสินค้าหลัก ${item.master.code} — ถ้าจะสร้างใหม่ต้องระบุ ${missing.join(', ')}`); return settle() }
      const category = categoriesByCode.get(item.master.categoryCode)
      if (!category || category.businessId !== businessId) { issue('INVALID', 'INVENTORY_CATEGORY_NOT_FOUND', 'master.categoryCode', `ไม่พบหมวดหมู่ ${item.master.categoryCode} ใน Business นี้`); return settle() }
      if (category.status === 'ARCHIVED') { issue('INVALID', 'INVENTORY_CATEGORY_ARCHIVED', 'master.categoryCode', `หมวดหมู่ ${category.code} ถูกเก็บถาวร`); return settle() }
      const nature = item.master.nature ?? 'GOOD'
      if (nature === 'SERVICE' && (item.master.defaultStockPolicy || item.master.variantAxes?.length)) {
        issue('INVALID', 'INTAKE_SERVICE_MASTER_FIELDS', 'master', 'สินค้าหลักที่เป็นบริการไม่มีนโยบายสต๊อกหรือแกน variant'); return settle()
      }
      masterSpec = { categoryCode: category.code, categoryId: category.id, nameTh: item.master.nameTh, nameEn: item.master.nameEn, nature, defaultStockPolicy: nature === 'SERVICE' ? undefined : (item.master.defaultStockPolicy ?? 'TRACKED'), variantAxes: nature === 'SERVICE' ? [] : (item.master.variantAxes ?? []) }
      batch.newMasters.set(item.master.code, { ref, payload: masterSpec })
      out.master = { id: null, code: item.master.code, created: true, createdBy: ref }
      out.actions.push({ type: 'CREATE_MASTER', payload: { code: item.master.code, categoryId: category.id, nameTh: masterSpec.nameTh, nameEn: masterSpec.nameEn, nature, ...(nature === 'SERVICE' ? {} : { defaultStockPolicy: masterSpec.defaultStockPolicy }), variantAxes: masterSpec.variantAxes } })
    }

    const nature = natureRule(masterSpec, item.sku.stockPolicy)
    if (!nature.ok) { issue('INVALID', nature.code, 'sku.stockPolicy', `สินค้าหลัก ${item.master.code} เป็น${masterSpec.nature === 'SERVICE' ? 'บริการ' : 'สินค้า'} — SKU ใต้มันเป็น ${item.sku.stockPolicy} ไม่ได้`); return settle() }
    const stockPolicy = nature.stockPolicy
    const isService = stockPolicy === 'SERVICE'
    const unit = item.sku.unit ?? 'EA'
    if (stockPolicy !== 'TRACKED' && item.sku.trackingMode && item.sku.trackingMode !== 'NONE') issue('INVALID', 'INTAKE_TRACKING_MODE_WITHOUT_LEDGER', 'sku.trackingMode', `SKU ที่เป็น ${stockPolicy} ไม่มีการระบุหน่วยแบบ ${item.sku.trackingMode}`)
    if (isService) {
      const stockFields = ['safetyStock', 'reorderPoint', 'reorderQty', 'leadTimeDays'].filter((key) => item.sku[key] !== undefined && item.sku[key] !== null && item.sku[key] !== 0)
      if (stockFields.length) issue('INVALID', 'INVENTORY_PRODUCT_IS_A_SERVICE', 'sku', `บริการไม่มีค่า ${stockFields.join(', ')}`)
      if (item.sku.variant && Object.keys(item.sku.variant).length) issue('INVALID', 'INVENTORY_PRODUCT_IS_A_SERVICE', 'sku.variant', 'บริการไม่มี variant')
      if (conversions.length) issue('INVALID', 'INVENTORY_PRODUCT_IS_A_SERVICE', 'unitConversions', 'บริการไม่มีหน่วยแปลง')
    }
    const trackingMode = stockPolicy === 'TRACKED' ? (item.sku.trackingMode ?? 'NONE') : 'NONE'
    if (trackingMode === 'SERIAL' && conversions.length) issue('INVALID', 'INVENTORY_UNIT_NOT_FOR_SERIAL', 'unitConversions', 'สินค้าที่นับตาม Serial ใช้หน่วยฐานเท่านั้น')
    conversions.forEach((conversion, i) => { if (conversion.unit === unit) issue('INVALID', 'INVENTORY_UNIT_IS_BASE', `unitConversions.${i}.unit`, `${conversion.unit} คือหน่วยฐานของ SKU อยู่แล้ว`) })

    let variant = {}
    let variantKey = null
    if (!isService) {
      const axes = masterSpec.variantAxes ?? []
      const { values, missing, extra } = variantValues(axes, item.sku)
      if (missing.length) issue('INVALID', 'INVENTORY_VARIANT_AXES_INCOMPLETE', 'sku.variant', `ต้องระบุ variant ${missing.join(', ')}`)
      if (extra.length) issue('INVALID', 'INVENTORY_VARIANT_AXIS_UNKNOWN', 'sku.variant', `สินค้าหลักไม่มีแกน ${extra.join(', ')}`)
      variant = values
      variantKey = missing.length || extra.length ? null : variantKeyFor(axes, values)
    }
    if (out.issues.length) return settle()

    const siblings = master ? (productsByMasterId.get(master.id) ?? []) : []
    const scope = item.master.code
    if (variantKey) {
      const existing = siblings.find((p) => p.variantKey === variantKey)
      if (existing) issue('CONFLICT', 'INVENTORY_PRODUCT_VARIANT_EXISTS', 'sku.variant', `variant นี้คือ SKU ${existing.code} อยู่แล้ว${existing.status === 'ARCHIVED' ? ' (เก็บถาวร — REACTIVATE แทน)' : ''}`, { existingCode: existing.code })
      const first = batch.variantKeys.get(`${scope}|${variantKey}`)
      if (first) issue('CONFLICT', 'INTAKE_DUPLICATE_IN_BATCH', 'sku.variant', `variant นี้ซ้ำกับรายการ ${first}`, { firstRef: first })
      else batch.variantKeys.set(`${scope}|${variantKey}`, ref)
    }
    const fingerprint = lookalikeFingerprint({ name: item.sku.name, color: item.sku.color, material: item.sku.material, variantKey })
    if (fingerprint) {
      const lookalike = siblings.find((p) => p.status !== 'ARCHIVED' && lookalikeFingerprint(p) === fingerprint)
      const first = batch.fingerprints.get(`${scope}|${fingerprint}`)
      if (lookalike || first) {
        if (item.sku.allowLookalike) warn('INTAKE_LOOKALIKE_ALLOWED', `คล้าย ${lookalike ? `SKU ${lookalike.code}` : `รายการ ${first}`} ทุกประการ — สร้างต่อเพราะระบุ allowLookalike`)
        else issue('CONFLICT', 'INVENTORY_PRODUCT_LOOKALIKE', 'sku.name', `ชื่อ/สี/วัสดุเหมือน ${lookalike ? `SKU ${lookalike.code}` : `รายการ ${first}`} ทุกประการ — น่าจะซ้ำ`, lookalike ? { existingCode: lookalike.code } : { firstRef: first })
      }
      if (!first) batch.fingerprints.set(`${scope}|${fingerprint}`, ref)
    }
    const units = new Set([unit, ...conversions.map((c) => c.unit)])
    identifiers.forEach((identifier, i) => {
      const taken = identifierRows.find((row) => collisionKey(row.kind, row.value) === collisionKey(identifier.kind, identifier.value))
      if (taken) issue('CONFLICT', 'INTAKE_IDENTIFIER_TAKEN', `identifiers.${i}.value`, `รหัส ${identifier.value} ถูกใช้แล้ว (อาจเป็นรหัสที่ยกเลิกไปแล้ว) ใช้ซ้ำไม่ได้`)
      if (identifier.unit && !units.has(identifier.unit)) issue('INVALID', 'INVENTORY_UNIT_UNKNOWN', `identifiers.${i}.unit`, `หน่วย ${identifier.unit} ไม่มีใน SKU นี้`)
    })
    if (out.issues.length) return settle()

    out.actions.push({
      type: 'CREATE_PRODUCT',
      masterCode: item.master.code,
      payload: {
        code: item.sku.code, name: item.sku.name ?? null, color: item.sku.color ?? null, material: item.sku.material ?? null, unit,
        stockPolicy, ...(stockPolicy === 'TRACKED' ? { trackingMode } : {}),
        ...(isService ? {} : { safetyStock: item.sku.safetyStock ?? 10, reorderPoint: item.sku.reorderPoint ?? null, reorderQty: item.sku.reorderQty ?? null, leadTimeDays: item.sku.leadTimeDays ?? null }),
        ...(Object.keys(variant).length ? { variant } : {}),
        ...(item.sku.allowLookalike ? { allowLookalike: true } : {}),
      },
    })
    conversions.forEach((conversion) => out.actions.push({ type: 'ADD_UNIT_CONVERSION', productId: null, productCode: item.sku.code, payload: { unit: conversion.unit, factor: conversion.factor, usage: conversion.usage ?? 'ANY', name: conversion.name ?? null } }))
    identifiers.forEach((identifier) => out.actions.push({ type: 'ADD_IDENTIFIER', productId: null, productCode: item.sku.code, payload: { kind: identifier.kind, value: identifier.value, issuer: identifier.issuer ?? null, unit: identifier.unit && identifier.unit !== unit ? identifier.unit : null } }))
    return settle()
  })

  const counts = Object.fromEntries(INVENTORY_CATALOG_INTAKE_DECISIONS.map((d) => [d.toLowerCase(), 0]))
  for (const item of items) counts[item.decision.toLowerCase()] += 1
  counts.total = items.length
  counts.createMasters = items.reduce((n, item) => n + item.actions.filter((a) => a.type === 'CREATE_MASTER').length, 0)
  const committable = counts.conflict === 0 && counts.invalid === 0
  return { items, counts, committable }
}

/** Every code and identifier value a snapshot must cover for this envelope. */
export function catalogIntakeLookups(envelope) {
  const codes = new Set()
  const masterCodes = new Set()
  const categoryCodes = new Set()
  const identifierValues = new Set()
  for (const raw of envelope.items) {
    const parsed = zCatalogIntakeItem.safeParse(raw)
    if (!parsed.success) continue
    codes.add(parsed.data.sku.code)
    masterCodes.add(parsed.data.master.code)
    if (parsed.data.master.categoryCode) categoryCodes.add(parsed.data.master.categoryCode)
    for (const identifier of parsed.data.identifiers ?? []) identifierValues.add(identifier.value)
  }
  return { codes: [...codes], masterCodes: [...masterCodes], categoryCodes: [...categoryCodes], identifierValues: [...identifierValues] }
}
