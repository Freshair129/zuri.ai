import { z } from 'zod'
import prisma from '@/lib/db'
import { ownsBusiness } from '@/modules/identity/viewer-authority'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { loadBusiness, notFound } from './commerce-authority'
import { calculatePrice, defaultPricingRules, normalizePricingInput, pricingHash, validatePricingRules } from '../domain/pricing-engine'

// @req FR-252 — owner-only rule revisions, atomic audit, immutable calculation
// snapshots and effective-date/expiry/revocation gates. Browser input never
// asserts verified source or publishable-price authority.
// @spec ADR-097; SEC-001; BR-001; BR-002
// @tested tests/integration/fr252-pricing-rules.test.js

const id = z.string().trim().min(1).max(200)
const revision = z.number().int().positive()
const name = z.string().trim().min(1).max(120)
const reason = z.string().trim().min(1).max(2000)
const scope = { businessId: id }
const createSchema = z.object({ ...scope, name, rules: z.unknown(), sourceRuleSetId: id.optional() }).strict()
const updateSchema = z.object({ ...scope, version: revision, name, rules: z.unknown(), reason }).strict()
const actionSchema = z.object({ ...scope, version: revision, action: z.enum(['APPROVE', 'REVOKE']), effectiveFrom: z.string().datetime({ offset: true }).optional(), expiresAt: z.string().datetime({ offset: true }).nullable().optional(), reason }).strict()
const previewSchema = z.object({ ...scope, rules: z.unknown(), input: z.unknown(), compareRuleSetId: id.optional() }).strict()
const calculateSchema = z.object({ ...scope, ruleSetId: id.optional(), input: z.unknown(), idempotencyKey: z.string().trim().min(1).max(200) }).strict()
const fail = (status, message) => Object.assign(new Error(message), { status })
const actor = (viewer) => viewer?.principal?.id ?? null

function engine(fn) {
  try { return fn() } catch (error) {
    if (error.status === 422) error.details = [{ field: error.field ?? 'rules', code: error.code ?? 'INVALID_PRICING_RULES', message: error.message }]
    throw error
  }
}

async function ownerBusiness(db, viewer, businessId) {
  const business = await loadBusiness(db, viewer, businessId)
  if (!ownsBusiness(viewer, business.id)) throw notFound()
  return business
}

async function scopedRule(db, business, ruleSetId) {
  const row = await db.pricingRuleSet.findFirst({ where: { id: ruleSetId, businessId: business.id, tenantId: business.tenantId } })
  if (!row) throw notFound()
  return row
}

function usable(row, now) {
  return row.status === 'APPROVED' && row.effectiveFrom && row.effectiveFrom <= now && (!row.expiresAt || row.expiresAt > now)
}

function ruleDto(row, now) {
  const { rulesJson, ...meta } = row
  return { ...meta, rules: JSON.parse(rulesJson), isActive: Boolean(usable(row, now)) }
}

function calculationDto(row) {
  const { inputJson, resultJson, rulesJson, requestHash, ...meta } = row
  return { ...meta, input: JSON.parse(inputJson), result: JSON.parse(resultJson), publishable: false }
}

async function audit(tx, viewer, business, row, action, reasonText, before = null) {
  const snapshot = (value) => value && ({ status: value.status, version: value.version, rulesHash: value.rulesHash, effectiveFrom: value.effectiveFrom, expiresAt: value.expiresAt })
  await recordAudit(tx, { entityType: 'PRICING_RULE_SET', entityId: row.id, action, actorId: actor(viewer), tenantId: business.tenantId, businessId: business.id, reason: reasonText, beforeJson: snapshot(before), afterJson: snapshot(row), payload: { name: row.name, sourceRuleSetId: row.sourceRuleSetId } })
}

export async function listPricingRules(query, { viewer, db = prisma, now = new Date() } = {}) {
  const data = z.object(scope).strict().parse(query)
  const business = await ownerBusiness(db, viewer, data.businessId)
  const rows = await db.pricingRuleSet.findMany({ where: { tenantId: business.tenantId, businessId: business.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
  const current = await latestEffectiveRule(db, business, now)
  return { businessId: business.id, rules: rows.map((row) => ({ ...ruleDto(row, now), isActive: row.id === current?.id && Boolean(usable(row, now)) })), template: defaultPricingRules(), canManage: true }
}

export async function createPricingRuleSet(input, { viewer, db = prisma, now = new Date() } = {}) {
  const data = createSchema.parse(input)
  return db.$transaction(async (tx) => {
    const business = await ownerBusiness(tx, viewer, data.businessId)
    if (data.sourceRuleSetId) await scopedRule(tx, business, data.sourceRuleSetId)
    const rules = engine(() => validatePricingRules(data.rules))
    const row = await tx.pricingRuleSet.create({ data: { tenantId: business.tenantId, businessId: business.id, name: data.name, rulesJson: JSON.stringify(rules), rulesHash: pricingHash(rules), sourceRuleSetId: data.sourceRuleSetId ?? null, createdByPersonId: actor(viewer), createdAt: now } })
    await audit(tx, viewer, business, row, 'PRICING_RULE_DRAFT_CREATED', null)
    return ruleDto(row, now)
  })
}

export async function updatePricingRuleSet(ruleSetId, input, { viewer, db = prisma, now = new Date() } = {}) {
  const data = updateSchema.parse(input)
  return db.$transaction(async (tx) => {
    const business = await ownerBusiness(tx, viewer, data.businessId)
    const before = await scopedRule(tx, business, ruleSetId)
    if (before.version !== data.version) throw fail(409, 'PRICING_RULE_VERSION_CONFLICT')
    if (before.status !== 'DRAFT') throw fail(409, 'PRICING_RULE_IMMUTABLE')
    const rules = engine(() => validatePricingRules(data.rules))
    const changed = await tx.pricingRuleSet.updateMany({ where: { id: before.id, version: data.version, status: 'DRAFT' }, data: { name: data.name, rulesJson: JSON.stringify(rules), rulesHash: pricingHash(rules), version: { increment: 1 } } })
    if (changed.count !== 1) throw fail(409, 'PRICING_RULE_VERSION_CONFLICT')
    const row = await scopedRule(tx, business, ruleSetId)
    await audit(tx, viewer, business, row, 'PRICING_RULE_DRAFT_UPDATED', data.reason, before)
    return ruleDto(row, now)
  })
}

export async function applyPricingRuleAction(ruleSetId, input, { viewer, db = prisma, now = new Date() } = {}) {
  const data = actionSchema.parse(input)
  return db.$transaction(async (tx) => {
    const business = await ownerBusiness(tx, viewer, data.businessId)
    const before = await scopedRule(tx, business, ruleSetId)
    if (before.version !== data.version) throw fail(409, 'PRICING_RULE_VERSION_CONFLICT')
    let change
    if (data.action === 'APPROVE') {
      if (before.status !== 'DRAFT') throw fail(409, 'PRICING_RULE_IMMUTABLE')
      engine(() => validatePricingRules(JSON.parse(before.rulesJson)))
      const effectiveFrom = data.effectiveFrom ? new Date(data.effectiveFrom) : now
      const expiresAt = data.expiresAt ? new Date(data.expiresAt) : null
      if (effectiveFrom < now) throw fail(422, 'PRICING_RULE_EFFECTIVE_DATE_IN_PAST')
      if (expiresAt && expiresAt <= effectiveFrom) throw fail(422, 'PRICING_RULE_EXPIRY_BEFORE_EFFECTIVE_DATE')
      change = { status: 'APPROVED', approvedAt: now, approvedByPersonId: actor(viewer), effectiveFrom, expiresAt, approvalReason: data.reason }
    } else {
      if (before.status !== 'APPROVED') throw fail(409, 'PRICING_RULE_NOT_APPROVED')
      if (data.effectiveFrom !== undefined || data.expiresAt !== undefined) throw fail(422, 'PRICING_RULE_REVOKE_DATES_NOT_ALLOWED')
      change = { status: 'REVOKED', revokedAt: now, revokedByPersonId: actor(viewer), revocationReason: data.reason }
    }
    const changed = await tx.pricingRuleSet.updateMany({ where: { id: before.id, version: data.version, status: before.status }, data: { ...change, version: { increment: 1 } } })
    if (changed.count !== 1) throw fail(409, 'PRICING_RULE_VERSION_CONFLICT')
    const row = await scopedRule(tx, business, ruleSetId)
    await audit(tx, viewer, business, row, data.action === 'APPROVE' ? 'PRICING_RULE_APPROVED' : 'PRICING_RULE_REVOKED', data.reason, before)
    return ruleDto(row, now)
  })
}

async function latestEffectiveRule(db, business, now) {
  return db.pricingRuleSet.findFirst({ where: { businessId: business.id, tenantId: business.tenantId, approvedAt: { not: null }, effectiveFrom: { lte: now } }, orderBy: [{ effectiveFrom: 'desc' }, { approvedAt: 'desc' }, { id: 'desc' }] })
}

async function activeRule(db, business, now, ruleSetId) {
  // Include revoked/expired approvals in selection: never silently fall back
  // to an older policy because the latest effective policy was withdrawn.
  const row = ruleSetId ? await scopedRule(db, business, ruleSetId) : await latestEffectiveRule(db, business, now)
  if (!row || !usable(row, now)) throw fail(409, 'PRICING_RULE_NOT_ACTIVE')
  if (ruleSetId && (await latestEffectiveRule(db, business, now))?.id !== row.id) throw fail(409, 'PRICING_RULE_NOT_ACTIVE')
  return row
}

export async function getActivePricingRuleSet(businessId, { viewer, db = prisma, now = new Date() } = {}) {
  const business = await ownerBusiness(db, viewer, businessId)
  return ruleDto(await activeRule(db, business, now), now)
}

export async function previewPricingRules(input, { viewer, db = prisma } = {}) {
  const data = previewSchema.parse(input)
  const business = await ownerBusiness(db, viewer, data.businessId)
  const baseline = data.compareRuleSetId ? await scopedRule(db, business, data.compareRuleSetId) : null
  const result = engine(() => calculatePrice(data.rules, data.input))
  if (!baseline) return { result }
  const previous = engine(() => calculatePrice(JSON.parse(baseline.rulesJson), data.input))
  return { result, comparison: { ruleSetId: baseline.id, result: previous, deltaUnitPriceSatang: result.unitPriceSatang - previous.unitPriceSatang, deltaTotalPriceSatang: result.totalPriceSatang - previous.totalPriceSatang } }
}

export async function calculatePricing(input, { viewer, db = prisma, now = new Date() } = {}) {
  const data = calculateSchema.parse(input)
  const run = async () => db.$transaction(async (tx) => {
    const business = await ownerBusiness(tx, viewer, data.businessId)
    const normalizedInput = engine(() => normalizePricingInput(data.input))
    const requestHash = pricingHash({ ruleSetId: data.ruleSetId ?? null, input: normalizedInput })
    const existing = await tx.pricingCalculation.findUnique({ where: { businessId_idempotencyKey: { businessId: business.id, idempotencyKey: data.idempotencyKey } } })
    if (existing) {
      if (existing.requestHash !== requestHash) throw fail(409, 'PRICING_CALCULATION_IDEMPOTENCY_CONFLICT')
      // A replay is historical evidence, but must not offer a withdrawn price.
      await activeRule(tx, business, now, existing.ruleSetId)
      return calculationDto(existing)
    }
    const row = await activeRule(tx, business, now, data.ruleSetId)
    const result = engine(() => calculatePrice(JSON.parse(row.rulesJson), normalizedInput))
    const created = await tx.pricingCalculation.create({ data: { businessId: business.id, tenantId: business.tenantId, ruleSetId: row.id, ruleVersion: row.version, rulesHash: row.rulesHash, rulesJson: row.rulesJson, evaluatorVersion: result.evaluatorVersion, inputHash: result.inputHash, inputJson: JSON.stringify(normalizedInput), resultJson: JSON.stringify(result), requestHash, idempotencyKey: data.idempotencyKey, createdByPersonId: actor(viewer), createdAt: now } })
    await recordAudit(tx, { entityType: 'PRICING_CALCULATION', entityId: created.id, action: 'PRICING_CALCULATED', tenantId: business.tenantId, businessId: business.id, actorId: actor(viewer), payload: { ruleSetId: row.id, ruleVersion: row.version, rulesHash: row.rulesHash, inputHash: result.inputHash, evaluatorVersion: result.evaluatorVersion, inputProvenance: 'USER_ENTERED' } })
    return calculationDto(created)
  })
  try { return await run() } catch (error) {
    // A simultaneous identical key may win the unique constraint. Re-read it
    // in a fresh transaction; a changed payload still returns a conflict.
    if (error.code === 'P2002') return run()
    if (error.code === 'P2034') throw fail(409, 'PRICING_CALCULATION_CONCURRENT_CHANGE')
    throw error
  }
}
