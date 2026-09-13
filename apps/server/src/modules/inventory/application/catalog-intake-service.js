import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { parseVariantAxes } from '../domain/inventory-governance'
import {
  CATALOG_INTAKE_ENTITY,
  CATALOG_INTAKE_PREVIEW_TTL_MS,
  catalogIntakeCode,
  catalogIntakeLookups,
  catalogIntakePayloadHash,
  catalogIntakePlanHash,
  planCatalogIntake,
  zCatalogIntakeAction,
  zCatalogIntakeEnvelope,
  zCommitCatalogIntake,
} from '../domain/catalog-intake'
import { loadBusiness, notFound } from './inventory-authority'
import { createProduct, createProductMaster } from './inventory-catalog-service'
import { addIdentifier, addUnitConversion } from './inventory-identity-service'

// @req FR-208 — the catalogue intake pipeline (ADR-084): preview → persisted
//   plan → commit, the one path every surface (JSON, Excel, LINE) writes
//   through. `previewCatalogIntake` gathers a catalogue snapshot for exactly
//   the codes and identifiers the envelope names, lets the pure planner
//   resolve every item before it plans a create, and stores the plan with its
//   hash, idempotent on (Business, channel, correlation). `commitCatalogIntake`
//   re-plans inside ONE transaction, refuses a stale or uncommittable plan, and
//   runs every action through the existing catalogue writers — so each keeps
//   its own guard and audit row, and any refusal rolls the batch back. There
//   is no second write path into the catalogue (BR-009).
// @spec ADR-084 D1, D2; BR-009, BR-041; SDD-009; SEC-001; FR-072
// @tested tests/integration/fr208-inventory-catalog-intake.test.js

const failure = (status, message, details) => Object.assign(new Error(message), { status }, details === undefined ? {} : { details })
const actor = (viewer) => viewer?.principal?.id ?? null
const inTx = (db, fn) => (typeof db?.$transaction === 'function' ? db.$transaction(fn) : fn(db))

const INTAKE_SELECT = {
  id: true, code: true, tenantId: true, businessId: true, sourceChannel: true, sourceCorrelationId: true, payloadSha256: true,
  planJson: true, planHash: true, committable: true, itemCount: true, status: true, requestedById: true, resultJson: true,
  expiresAt: true, committedAt: true, cancelledAt: true, createdAt: true, updatedAt: true, version: true,
}

function parseJson(text, fallback) {
  try { return text ? JSON.parse(text) : fallback } catch { return fallback }
}

/** The public shape of an intake: the plan and the result as data, never as strings. */
export function catalogIntakeDto(row) {
  if (!row) return null
  const { planJson, resultJson, ...rest } = row
  return { ...rest, plan: parseJson(planJson, null), result: parseJson(resultJson, null) }
}

/**
 * Everything the planner may need to know about the catalogue for this
 * envelope, read inside the caller's client (a transaction at commit). Codes
 * are unique per Tenant, so the lookups are Tenant-wide and the planner — not
 * the query — decides that a row in another Business cannot be matched.
 */
async function gatherSnapshot(db, business, envelope) {
  const { codes, masterCodes, categoryCodes, identifierValues } = catalogIntakeLookups(envelope)
  const tenantId = business.tenantId
  const productSelect = { id: true, code: true, businessId: true, status: true, mergedIntoProductId: true, productMasterId: true, unit: true, stockPolicy: true, trackingMode: true, name: true, color: true, material: true, variantKey: true }
  const [categories, masters, codeProducts, identifierRows] = await Promise.all([
    categoryCodes.length ? db.inventoryCategory.findMany({ where: { tenantId, code: { in: categoryCodes } }, select: { id: true, code: true, businessId: true, status: true } }) : [],
    masterCodes.length ? db.productMaster.findMany({ where: { tenantId, code: { in: masterCodes } }, select: { id: true, code: true, businessId: true, status: true, nature: true, defaultStockPolicy: true, variantAxesJson: true } }) : [],
    codes.length ? db.product.findMany({ where: { tenantId, code: { in: codes } }, select: productSelect }) : [],
    identifierValues.length ? db.productIdentifier.findMany({ where: { tenantId, value: { in: identifierValues } }, select: { kind: true, value: true, status: true, productId: true } }) : [],
  ])

  const productsById = new Map(codeProducts.map((p) => [p.id, p]))
  // Follow identifier holders and merge chains until every id the planner may touch is loaded.
  let pending = [...new Set([...identifierRows.map((r) => r.productId), ...codeProducts.map((p) => p.mergedIntoProductId)].filter((id) => id && !productsById.has(id)))]
  for (let hop = 0; pending.length && hop < 12; hop += 1) {
    const rows = await db.product.findMany({ where: { tenantId, id: { in: pending } }, select: productSelect })
    for (const row of rows) productsById.set(row.id, row)
    pending = [...new Set(rows.map((r) => r.mergedIntoProductId).filter((id) => id && !productsById.has(id)))]
  }

  const sameBusinessMasterIds = masters.filter((m) => m.businessId === business.id).map((m) => m.id)
  const holderIds = [...productsById.keys()]
  const holderMasterIds = [...new Set([...productsById.values()].map((p) => p.productMasterId))].filter((id) => !masters.some((m) => m.id === id))
  const [siblings, conversions, holderMasters] = await Promise.all([
    sameBusinessMasterIds.length ? db.product.findMany({ where: { productMasterId: { in: sameBusinessMasterIds } }, select: productSelect }) : [],
    holderIds.length ? db.productUnitConversion.findMany({ where: { productId: { in: holderIds } }, select: { productId: true, unit: true, factor: true, status: true } }) : [],
    holderMasterIds.length ? db.productMaster.findMany({ where: { id: { in: holderMasterIds } }, select: { id: true, code: true, businessId: true, status: true, nature: true, defaultStockPolicy: true, variantAxesJson: true } }) : [],
  ])

  const masterDto = (m) => ({ ...m, variantAxes: parseVariantAxes(m.variantAxesJson) })
  const allMasters = [...masters, ...holderMasters].map(masterDto)
  const productsByMasterId = new Map()
  for (const product of siblings) {
    if (!productsByMasterId.has(product.productMasterId)) productsByMasterId.set(product.productMasterId, [])
    productsByMasterId.get(product.productMasterId).push(product)
  }
  const conversionsByProductId = new Map()
  for (const row of conversions) {
    if (!conversionsByProductId.has(row.productId)) conversionsByProductId.set(row.productId, [])
    conversionsByProductId.get(row.productId).push(row)
  }
  return {
    businessId: business.id,
    categoriesByCode: new Map(categories.map((c) => [c.code, c])),
    mastersByCode: new Map(masters.map(masterDto).map((m) => [m.code, m])),
    mastersById: new Map(allMasters.map((m) => [m.id, m])),
    productsByCode: new Map(codeProducts.map((p) => [p.code, p])),
    productsById,
    identifierRows,
    conversionsByProductId,
    productsByMasterId,
  }
}

async function planFor(db, business, envelope) {
  const snapshot = await gatherSnapshot(db, business, envelope)
  const plan = planCatalogIntake(envelope, snapshot)
  return { plan, planHash: catalogIntakePlanHash(plan) }
}

/**
 * Preview an envelope: validate its header, plan every item, persist the plan.
 * Needs Inventory write authority, because it stores a row. A same-payload
 * re-preview recomputes the plan against today's catalogue; a committed or
 * cancelled one is returned as it stands; a different payload under the same
 * correlation is refused (`INVENTORY_CATALOG_INTAKE_CORRELATION_REUSED`).
 */
export async function previewCatalogIntake(input, { viewer, db = prisma, now = new Date(), requestedById = null } = {}) {
  const envelope = zCatalogIntakeEnvelope.parse(input)
  const payloadSha256 = catalogIntakePayloadHash(envelope)
  const channel = envelope.source.channel
  const correlationId = envelope.source.correlationId
  return inTx(db, async (tx) => {
    const business = await loadBusiness(tx, viewer, envelope.businessId, { write: true })
    const existing = await tx.inventoryCatalogIntake.findUnique({
      where: { businessId_sourceChannel_sourceCorrelationId: { businessId: business.id, sourceChannel: channel, sourceCorrelationId: correlationId } },
      select: INTAKE_SELECT,
    })
    if (existing && existing.payloadSha256 !== payloadSha256) throw failure(409, 'INVENTORY_CATALOG_INTAKE_CORRELATION_REUSED')
    if (existing && existing.status !== 'PREVIEWED') return { replayed: true, intake: catalogIntakeDto(existing) }

    const { plan, planHash } = await planFor(tx, business, envelope)
    const expiresAt = new Date(now.getTime() + (CATALOG_INTAKE_PREVIEW_TTL_MS[channel] ?? CATALOG_INTAKE_PREVIEW_TTL_MS.DEFAULT))
    const columns = { planJson: JSON.stringify(plan), planHash, committable: plan.committable, itemCount: plan.counts.total, expiresAt, requestedById: requestedById ?? actor(viewer) }
    const row = existing
      ? await tx.inventoryCatalogIntake.update({ where: { id: existing.id }, data: { ...columns, version: { increment: 1 } }, select: INTAKE_SELECT })
      : await tx.inventoryCatalogIntake.create({
        data: {
          ...columns, code: catalogIntakeCode({ businessId: business.id, channel, correlationId }), tenantId: business.tenantId, businessId: business.id,
          sourceChannel: channel, sourceCorrelationId: correlationId, payloadSha256, normalizedEnvelopeJson: JSON.stringify(envelope),
        },
        select: INTAKE_SELECT,
      })
    await recordAudit(tx, {
      entityType: CATALOG_INTAKE_ENTITY, entityId: row.id, action: existing ? 'INVENTORY_CATALOG_INTAKE_REPREVIEWED' : 'INVENTORY_CATALOG_INTAKE_PREVIEWED', actorId: actor(viewer),
      payload: { businessId: business.id, code: row.code, channel, correlationId, planHash, counts: plan.counts, committable: plan.committable },
    })
    return { replayed: false, intake: catalogIntakeDto(row) }
  })
}

async function loadIntakeForWrite(tx, viewer, businessId, where) {
  const business = await loadBusiness(tx, viewer, businessId, { write: true })
  const row = await tx.inventoryCatalogIntake.findFirst({ where: { ...where, businessId: business.id }, select: { ...INTAKE_SELECT, normalizedEnvelopeJson: true } })
  if (!row) throw notFound()
  return { business, row }
}

/** Resolve the id an action names: a product the plan matched, or one this batch just created. */
function productIdFor(action, createdByCode) {
  if (action.productId) return action.productId
  const id = createdByCode.get(action.productCode)
  if (!id) throw failure(500, 'INVENTORY_CATALOG_INTAKE_ACTION_UNRESOLVED')
  return id
}

/**
 * Commit a previewed intake: the plan is recomputed in the same transaction
 * that writes, and must hash to what the caller saw. `requestedById`, when
 * given, must be the person who previewed (the LINE confirmation rule).
 */
export async function commitCatalogIntake(input, { viewer, db = prisma, now = new Date(), requestedById = null } = {}) {
  const data = zCommitCatalogIntake.parse(input)
  return inTx(db, async (tx) => {
    const { business, row } = await loadIntakeForWrite(tx, viewer, data.businessId, { id: data.intakeId })
    if (requestedById && row.requestedById !== requestedById) throw notFound()
    if (row.status === 'COMMITTED') {
      if (row.planHash !== data.planHash) throw failure(409, 'INVENTORY_CATALOG_INTAKE_PLAN_STALE')
      const { normalizedEnvelopeJson, ...rest } = row
      return { replayed: true, intake: catalogIntakeDto(rest) }
    }
    if (row.status === 'CANCELLED') throw failure(409, 'INVENTORY_CATALOG_INTAKE_CANCELLED')
    if (row.expiresAt.getTime() <= now.getTime()) throw failure(409, 'INVENTORY_CATALOG_INTAKE_EXPIRED')

    const envelope = JSON.parse(row.normalizedEnvelopeJson)
    const { plan, planHash } = await planFor(tx, business, envelope)
    if (planHash !== data.planHash || planHash !== row.planHash) throw failure(409, 'INVENTORY_CATALOG_INTAKE_PLAN_STALE', [{ kind: 'PLAN_CHANGED', storedPlanHash: row.planHash, currentPlanHash: planHash }])
    if (!plan.committable) {
      throw failure(409, 'INVENTORY_CATALOG_INTAKE_NOT_COMMITTABLE', plan.items.filter((i) => i.decision === 'CONFLICT' || i.decision === 'INVALID').map((i) => ({ ref: i.ref, decision: i.decision, codes: i.issues.map((x) => x.code) })))
    }

    const masterIdByCode = new Map()
    const createdByCode = new Map()
    const result = { created: [], matched: [], unchanged: [], mastersCreated: [] }
    for (const item of plan.items) {
      for (const action of item.actions) {
        if (action.type === 'CREATE_MASTER') {
          const master = await createProductMaster({ businessId: business.id, ...action.payload }, { viewer, db: tx })
          masterIdByCode.set(master.code, master.id)
          result.mastersCreated.push({ id: master.id, code: master.code })
        } else if (action.type === 'CREATE_PRODUCT') {
          const productMasterId = masterIdByCode.get(action.masterCode) ?? item.master?.id
          if (!productMasterId) throw failure(500, 'INVENTORY_CATALOG_INTAKE_ACTION_UNRESOLVED')
          const product = await createProduct({ businessId: business.id, productMasterId, ...action.payload }, { viewer, db: tx })
          createdByCode.set(product.code, product.id)
        } else if (action.type === 'ADD_UNIT_CONVERSION') {
          await addUnitConversion(productIdFor(action, createdByCode), { businessId: business.id, ...stripNulls(action.payload) }, { viewer, db: tx })
        } else if (action.type === 'ADD_IDENTIFIER') {
          await addIdentifier(productIdFor(action, createdByCode), { businessId: business.id, ...stripNulls(action.payload) }, { viewer, db: tx })
        }
      }
      const summary = { ref: item.ref, code: item.code, additions: item.actions.filter((a) => a.type.startsWith('ADD_')).length }
      if (item.decision === 'CREATE') result.created.push({ ...summary, productId: createdByCode.get(item.code) })
      else if (item.decision === 'MATCH') result.matched.push({ ...summary, productId: item.product.id, productCode: item.product.code, matchedBy: item.matchedBy })
      else result.unchanged.push({ ...summary, productId: item.product?.id ?? null, productCode: item.product?.code ?? null })
    }

    const updated = await tx.inventoryCatalogIntake.updateMany({
      where: { id: row.id, version: row.version, status: 'PREVIEWED' },
      data: { status: 'COMMITTED', committedAt: now, resultJson: JSON.stringify(result), version: { increment: 1 } },
    })
    if (updated.count !== 1) throw failure(409, 'INVENTORY_CATALOG_INTAKE_VERSION_CONFLICT')
    await recordAudit(tx, {
      entityType: CATALOG_INTAKE_ENTITY, entityId: row.id, action: 'INVENTORY_CATALOG_INTAKE_COMMITTED', actorId: actor(viewer),
      payload: { businessId: business.id, code: row.code, channel: row.sourceChannel, planHash, created: result.created.length, matched: result.matched.length, unchanged: result.unchanged.length, mastersCreated: result.mastersCreated.length },
    })
    const fresh = await tx.inventoryCatalogIntake.findUnique({ where: { id: row.id }, select: INTAKE_SELECT })
    return { replayed: false, intake: catalogIntakeDto(fresh) }
  })
}

function stripNulls(payload) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== null && value !== undefined))
}

/** CANCEL a previewed intake; compare-and-swap on version. A committed one cannot be cancelled. */
export async function applyCatalogIntakeAction(id, input, { viewer, db = prisma, now = new Date(), businessId = null, requestedById = null } = {}) {
  const data = zCatalogIntakeAction.parse(input)
  const intakeId = typeof id === 'string' ? id.trim() : ''
  if (!intakeId) throw notFound()
  return inTx(db, async (tx) => {
    const probe = await tx.inventoryCatalogIntake.findUnique({ where: { id: intakeId }, select: { businessId: true } })
    if (!probe || (businessId && probe.businessId !== businessId)) throw notFound()
    const { business, row } = await loadIntakeForWrite(tx, viewer, probe.businessId, { id: intakeId })
    if (requestedById && row.requestedById !== requestedById) throw notFound()
    if (row.version !== data.version) throw failure(409, 'INVENTORY_CATALOG_INTAKE_VERSION_CONFLICT')
    if (row.status !== 'PREVIEWED') throw failure(409, row.status === 'COMMITTED' ? 'INVENTORY_CATALOG_INTAKE_ALREADY_COMMITTED' : 'INVENTORY_CATALOG_INTAKE_CANCELLED')
    const result = await tx.inventoryCatalogIntake.updateMany({ where: { id: row.id, version: row.version }, data: { status: 'CANCELLED', cancelledAt: now, version: { increment: 1 } } })
    if (result.count !== 1) throw failure(409, 'INVENTORY_CATALOG_INTAKE_VERSION_CONFLICT')
    await recordAudit(tx, { entityType: CATALOG_INTAKE_ENTITY, entityId: row.id, action: 'INVENTORY_CATALOG_INTAKE_CANCELLED', actorId: actor(viewer), payload: { businessId: business.id, code: row.code, channel: row.sourceChannel } })
    return catalogIntakeDto(await tx.inventoryCatalogIntake.findUnique({ where: { id: row.id }, select: INTAKE_SELECT }))
  })
}

/** One intake in a visible Business; reads need the `inventory` domain, not write authority. */
export async function getCatalogIntake(id, { viewer, db = prisma } = {}) {
  const intakeId = typeof id === 'string' ? id.trim() : ''
  if (!intakeId) throw notFound()
  const row = await db.inventoryCatalogIntake.findUnique({ where: { id: intakeId }, select: INTAKE_SELECT })
  if (!row) throw notFound()
  await loadBusiness(db, viewer, row.businessId)
  return catalogIntakeDto(row)
}

/** The Business's recent intakes, newest first, without their plans. */
export async function listCatalogIntakes({ businessId, limit = 20, viewer, db = prisma } = {}) {
  const business = await loadBusiness(db, viewer, businessId)
  const take = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20))
  const { planJson, resultJson, ...summarySelect } = INTAKE_SELECT
  return db.inventoryCatalogIntake.findMany({ where: { businessId: business.id }, orderBy: [{ createdAt: 'desc' }], take, select: summarySelect })
}

/** The PREVIEWED intake a LINE confirmation names, by its human code. */
export async function findCatalogIntakeByCode({ businessId, code }, { viewer, db = prisma } = {}) {
  const business = await loadBusiness(db, viewer, businessId, { write: true })
  const value = typeof code === 'string' ? code.trim().toUpperCase() : ''
  if (!value) throw notFound()
  const row = await db.inventoryCatalogIntake.findUnique({ where: { tenantId_code: { tenantId: business.tenantId, code: value } }, select: INTAKE_SELECT })
  if (!row || row.businessId !== business.id) throw notFound()
  return catalogIntakeDto(row)
}
