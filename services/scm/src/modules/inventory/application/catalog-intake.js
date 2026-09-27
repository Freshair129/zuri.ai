import { z } from 'zod'
import {
  CATALOG_INTAKE_ENTITY, CATALOG_INTAKE_PREVIEW_TTL_MS, catalogIntakeCode, catalogIntakeLookups, catalogIntakePayloadHash, catalogIntakePlanHash,
  planCatalogIntake, zCatalogIntakeAction, zCatalogIntakeEnvelope, zCommitCatalogIntake,
} from '../../../kernel/inventory/catalog-intake.js'
import { parseVariantAxes } from '../../../kernel/inventory/inventory-governance.js'
import { denied, inventoryAuthority } from '../../../infrastructure/delegation.js'
import { enqueueOutbox, recordAudit } from '../../../infrastructure/evidence.js'
import { createProduct, createProductMaster } from './catalog.js'
import { addIdentifier, addUnitConversion } from './identity.js'
import * as intakeRepo from '../adapters/intake-repo.js'
import * as reports from '../adapters/report-repo.js'

// Catalogue intake (FR-208, ADR-084) inside SCM — port of apps/server
// catalog-intake-service with the same codes, order of refusals and audit:
//   preview — validates the envelope header, gathers a catalogue snapshot for
//             exactly the codes and identifiers it names, lets the one kernel
//             planner resolve every item before it plans a create, and stores the
//             plan with its hash, idempotent on (Business, channel, correlation).
//   commit  — re-plans inside ONE unit of work, refuses a stale or uncommittable
//             plan, and runs every action through Inventory's own catalogue and
//             identity writers, so each keeps its guard and its audit row and any
//             refusal rolls the batch back. There is no second write path into the
//             catalogue (BR-009).
//   cancel  — PREVIEWED → CANCELLED, compare-and-swap on version.
// Deviations (D-27): commit and cancel take a lock-only touch on the intake before
// they read its status, so two commits of one intake serialize and the later one
// replays instead of colliding on the codes the first created; the LINE rule "only
// the person who previewed may confirm" is `requesterOnly: true` in the body (legacy
// passed it as an in-process option), checked against the delegated actor.
// The Excel workbook converter and the template stay at the edge (D-26): SCM
// accepts the JSON envelope every surface converges on.

const failure = (status, code, details) => Object.assign(new Error(code), { status, code, retryable: false }, details === undefined ? {} : { details })
const writer = (scope, businessId) => inventoryAuthority.require(scope, typeof businessId === 'string' ? businessId.trim() : '', { write: true })
const reader = (scope, businessId) => inventoryAuthority.require(scope, typeof businessId === 'string' ? businessId.trim() : '')

const zRequesterOnly = z.object({ requesterOnly: z.boolean().optional() }).passthrough()
/** Split the SCM-only `requesterOnly` flag from the legacy body the kernel parses strictly. */
function withRequester(input, schema) {
  const { requesterOnly, ...rest } = zRequesterOnly.parse(input ?? {})
  return { data: schema.parse(rest), requesterOnly: requesterOnly === true }
}

function parseJson(text, fallback) {
  try { return text ? JSON.parse(text) : fallback } catch { return fallback }
}

/** The public shape of an intake: the plan and the result as data, never as strings. */
export function catalogIntakeDto(row) {
  if (!row) return null
  const { planJson, resultJson, normalizedEnvelopeJson, ...rest } = row
  return { ...rest, ...(planJson !== undefined ? { plan: parseJson(planJson, null) } : {}), ...(resultJson !== undefined ? { result: parseJson(resultJson, null) } : {}) }
}

/**
 * Everything the planner may need to know about the catalogue for this envelope,
 * read inside the unit of work. Codes are unique per Tenant, so the lookups are
 * Tenant-wide and the planner — not the query — decides that a row in another
 * Business cannot be matched.
 */
function gatherSnapshot(sql, business, envelope) {
  const { codes, masterCodes, categoryCodes, identifierValues } = catalogIntakeLookups(envelope)
  const tenantId = business.tenantId
  const categories = reports.categoriesByCodes(sql, tenantId, categoryCodes)
  const masters = reports.mastersByCodes(sql, tenantId, masterCodes)
  const codeProducts = reports.productsByCodes(sql, tenantId, codes)
  const identifierRows = reports.identifiersByValues(sql, tenantId, identifierValues)

  const productsById = new Map(codeProducts.map((p) => [p.id, p]))
  // Follow identifier holders and merge chains until every id the planner may touch is loaded.
  let pending = [...new Set([...identifierRows.map((r) => r.productId), ...codeProducts.map((p) => p.mergedIntoProductId)].filter((id) => id && !productsById.has(id)))]
  for (let hop = 0; pending.length && hop < 12; hop += 1) {
    const rows = reports.productsByIdsInTenant(sql, tenantId, pending)
    for (const row of rows) productsById.set(row.id, row)
    pending = [...new Set(rows.map((r) => r.mergedIntoProductId).filter((id) => id && !productsById.has(id)))]
  }

  const sameBusinessMasterIds = masters.filter((m) => m.businessId === business.id).map((m) => m.id)
  const holderIds = [...productsById.keys()]
  const holderMasterIds = [...new Set([...productsById.values()].map((p) => p.productMasterId))].filter((id) => !masters.some((m) => m.id === id))
  const siblings = reports.productsUnderMasters(sql, sameBusinessMasterIds)
  const conversions = reports.conversionsOfProducts(sql, holderIds)
  const holderMasters = reports.mastersByIds(sql, holderMasterIds)

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

function planFor(sql, business, envelope) {
  const plan = planCatalogIntake(envelope, gatherSnapshot(sql, business, envelope))
  return { plan, planHash: catalogIntakePlanHash(plan) }
}

function evidence(sql, scope, business, row, action, payload, ctx) {
  recordAudit(sql, { entityType: CATALOG_INTAKE_ENTITY, entityId: row.id, action, actorId: scope.actorId, tenantId: business.tenantId, businessId: business.id, requestId: ctx.requestId, now: ctx.now, payload })
  enqueueOutbox(sql, { topic: `scm.inventory.${action.toLowerCase().replace(/_/g, '-')}`, aggregateType: CATALOG_INTAKE_ENTITY, aggregateId: row.id, aggregateVersion: row.version, now: ctx.now, payload: { businessId: business.id, code: row.code } })
}

export const previewerOf = (scope, body) => writer(scope, zCatalogIntakeEnvelope.parse(body).businessId).id
export const committerOf = (scope, body) => writer(scope, withRequester(body, zCommitCatalogIntake).data.businessId).id

/**
 * Preview an envelope: validate its header, plan every item, persist the plan.
 * A same-payload re-preview recomputes the plan against today's catalogue; a
 * committed or cancelled one is returned as it stands; a different payload under
 * the same correlation is refused.
 */
export function previewCatalogIntake(sql, scope, input, ctx) {
  const envelope = zCatalogIntakeEnvelope.parse(input)
  const payloadSha256 = catalogIntakePayloadHash(envelope)
  const channel = envelope.source.channel
  const correlationId = envelope.source.correlationId
  const business = writer(scope, envelope.businessId)
  const existing = intakeRepo.intakeByCorrelation(sql, business.id, channel, correlationId)
  if (existing && existing.payloadSha256 !== payloadSha256) throw failure(409, 'INVENTORY_CATALOG_INTAKE_CORRELATION_REUSED')
  if (existing && existing.status !== 'PREVIEWED') return { response: { replayed: true, intake: catalogIntakeDto(existing) }, affected: { intakeId: existing.id, replayed: true } }

  const { plan, planHash } = planFor(sql, business, envelope)
  const expiresAt = new Date(new Date(ctx.now).getTime() + (CATALOG_INTAKE_PREVIEW_TTL_MS[channel] ?? CATALOG_INTAKE_PREVIEW_TTL_MS.DEFAULT)).toISOString()
  const columns = { planJson: JSON.stringify(plan), planHash, committable: plan.committable, itemCount: plan.counts.total, expiresAt, requestedById: scope.actorId ?? null, now: ctx.now }
  const row = existing
    ? intakeRepo.replacePlan(sql, { id: existing.id, ...columns })
    : intakeRepo.insertIntake(sql, {
      ...columns, code: catalogIntakeCode({ businessId: business.id, channel, correlationId }), tenantId: business.tenantId, businessId: business.id,
      sourceChannel: channel, sourceCorrelationId: correlationId, payloadSha256, normalizedEnvelopeJson: JSON.stringify(envelope),
    })
  evidence(sql, scope, business, row, existing ? 'INVENTORY_CATALOG_INTAKE_REPREVIEWED' : 'INVENTORY_CATALOG_INTAKE_PREVIEWED',
    { businessId: business.id, code: row.code, channel, correlationId, planHash, counts: plan.counts, committable: plan.committable }, ctx)
  return { response: { replayed: false, intake: catalogIntakeDto(row) }, affected: { intakeId: row.id, version: row.version } }
}

/** The intake in a Business the caller may write, locked before its status is read. */
function intakeForWrite(sql, scope, businessId, intakeId) {
  const business = writer(scope, businessId)
  if (intakeRepo.intakeById(sql, intakeId)?.businessId !== business.id) throw denied()
  intakeRepo.lockIntake(sql, intakeId)
  return { business, row: intakeRepo.intakeWithEnvelope(sql, intakeId) }
}

/** Resolve the id an action names: a product the plan matched, or one this batch just created. */
function productIdFor(action, createdByCode) {
  if (action.productId) return action.productId
  const id = createdByCode.get(action.productCode)
  if (!id) throw failure(500, 'INVENTORY_CATALOG_INTAKE_ACTION_UNRESOLVED')
  return id
}

function stripNulls(payload) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== null && value !== undefined))
}

/**
 * Commit a previewed intake: the plan is recomputed in the same unit of work that
 * writes, and must hash to what the caller saw.
 */
export function commitCatalogIntake(sql, scope, input, ctx) {
  const { data, requesterOnly } = withRequester(input, zCommitCatalogIntake)
  const { business, row } = intakeForWrite(sql, scope, data.businessId, data.intakeId)
  if (requesterOnly && row.requestedById !== scope.actorId) throw denied()
  if (row.status === 'COMMITTED') {
    if (row.planHash !== data.planHash) throw failure(409, 'INVENTORY_CATALOG_INTAKE_PLAN_STALE')
    return { response: { replayed: true, intake: catalogIntakeDto(row) }, affected: { intakeId: row.id, replayed: true } }
  }
  if (row.status === 'CANCELLED') throw failure(409, 'INVENTORY_CATALOG_INTAKE_CANCELLED')
  if (new Date(row.expiresAt).getTime() <= new Date(ctx.now).getTime()) throw failure(409, 'INVENTORY_CATALOG_INTAKE_EXPIRED')

  const envelope = JSON.parse(row.normalizedEnvelopeJson)
  const { plan, planHash } = planFor(sql, business, envelope)
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
        const { master } = createProductMaster(sql, scope, { businessId: business.id, ...action.payload }, ctx).response
        masterIdByCode.set(master.code, master.id)
        result.mastersCreated.push({ id: master.id, code: master.code })
      } else if (action.type === 'CREATE_PRODUCT') {
        const productMasterId = masterIdByCode.get(action.masterCode) ?? item.master?.id
        if (!productMasterId) throw failure(500, 'INVENTORY_CATALOG_INTAKE_ACTION_UNRESOLVED')
        const { product } = createProduct(sql, scope, { businessId: business.id, productMasterId, ...action.payload }, ctx).response
        createdByCode.set(product.code, product.id)
      } else if (action.type === 'ADD_UNIT_CONVERSION') {
        addUnitConversion(sql, scope, productIdFor(action, createdByCode), { businessId: business.id, ...stripNulls(action.payload) }, ctx)
      } else if (action.type === 'ADD_IDENTIFIER') {
        addIdentifier(sql, scope, productIdFor(action, createdByCode), { businessId: business.id, ...stripNulls(action.payload) }, ctx)
      }
    }
    const summary = { ref: item.ref, code: item.code, additions: item.actions.filter((a) => a.type.startsWith('ADD_')).length }
    if (item.decision === 'CREATE') result.created.push({ ...summary, productId: createdByCode.get(item.code) })
    else if (item.decision === 'MATCH') result.matched.push({ ...summary, productId: item.product.id, productCode: item.product.code, matchedBy: item.matchedBy })
    else result.unchanged.push({ ...summary, productId: item.product?.id ?? null, productCode: item.product?.code ?? null })
  }

  if (intakeRepo.commitIntake(sql, { id: row.id, version: row.version, resultJson: JSON.stringify(result), now: ctx.now }) !== 1) throw failure(409, 'INVENTORY_CATALOG_INTAKE_VERSION_CONFLICT')
  const fresh = intakeRepo.intakeById(sql, row.id)
  evidence(sql, scope, business, fresh, 'INVENTORY_CATALOG_INTAKE_COMMITTED', {
    businessId: business.id, code: row.code, channel: row.sourceChannel, planHash, created: result.created.length, matched: result.matched.length, unchanged: result.unchanged.length, mastersCreated: result.mastersCreated.length,
  }, ctx)
  return { response: { replayed: false, intake: catalogIntakeDto(fresh) }, affected: { intakeId: row.id, version: fresh.version, created: result.created.length } }
}

const zCancelBody = zCatalogIntakeAction.extend({ businessId: z.string().trim().min(1).max(200).optional() })

/** The Business an intake action is authorized against: the intake's own (a `businessId` in the body must match it). */
export function cancellerOf(sql, scope, id, body) {
  const { data } = withRequester(body, zCancelBody)
  const row = typeof id === 'string' && id.trim() ? intakeRepo.intakeById(sql, id.trim()) : null
  if (!row || row.tenantId !== scope.tenantId || (data.businessId && row.businessId !== data.businessId)) throw denied()
  return writer(scope, row.businessId).id
}

/** CANCEL a previewed intake; compare-and-swap on version. A committed one cannot be cancelled. */
export function applyCatalogIntakeAction(sql, scope, id, input, ctx) {
  const { data, requesterOnly } = withRequester(input, zCancelBody)
  const probe = intakeRepo.intakeById(sql, typeof id === 'string' ? id.trim() : '')
  if (!probe || (data.businessId && probe.businessId !== data.businessId)) throw denied()
  const { business, row } = intakeForWrite(sql, scope, probe.businessId, probe.id)
  if (requesterOnly && row.requestedById !== scope.actorId) throw denied()
  if (row.version !== data.version) throw failure(409, 'INVENTORY_CATALOG_INTAKE_VERSION_CONFLICT')
  if (row.status !== 'PREVIEWED') throw failure(409, row.status === 'COMMITTED' ? 'INVENTORY_CATALOG_INTAKE_ALREADY_COMMITTED' : 'INVENTORY_CATALOG_INTAKE_CANCELLED')
  if (intakeRepo.cancelIntake(sql, { id: row.id, version: row.version, now: ctx.now }) !== 1) throw failure(409, 'INVENTORY_CATALOG_INTAKE_VERSION_CONFLICT')
  const fresh = intakeRepo.intakeById(sql, row.id)
  evidence(sql, scope, business, fresh, 'INVENTORY_CATALOG_INTAKE_CANCELLED', { businessId: business.id, code: row.code, channel: row.sourceChannel }, ctx)
  return { response: { intake: catalogIntakeDto(fresh) }, affected: { intakeId: row.id, version: fresh.version, status: fresh.status } }
}

/** One intake in a visible Business; reads need the `inventory` domain, not write authority. */
export function getCatalogIntake(sql, scope, id) {
  const row = typeof id === 'string' && id.trim() ? intakeRepo.intakeById(sql, id.trim()) : null
  if (!row) throw denied()
  reader(scope, row.businessId)
  return catalogIntakeDto(row)
}

/** The Business's recent intakes, newest first, without their plans. */
export function listCatalogIntakes(sql, scope, { businessId, limit = 20 }) {
  const business = reader(scope, businessId)
  const take = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20))
  return intakeRepo.intakesOf(sql, business.id, take)
}

/** The intake a LINE confirmation names, by its human code (write authority, as legacy). */
export function findCatalogIntakeByCode(sql, scope, { businessId, code }) {
  const business = writer(scope, businessId)
  const value = typeof code === 'string' ? code.trim().toUpperCase() : ''
  if (!value) throw denied()
  const row = intakeRepo.intakeByCode(sql, business.tenantId, value)
  if (!row || row.businessId !== business.id) throw denied()
  return catalogIntakeDto(row)
}
