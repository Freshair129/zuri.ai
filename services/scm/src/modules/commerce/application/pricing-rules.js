import { z } from 'zod'
import { calculatePrice, defaultPricingRules, normalizePricingInput, pricingHash, validatePricingRules } from '../../../kernel/commerce/pricing-engine.js'
import { commerceAuthority, denied } from '../../../infrastructure/delegation.js'
import { enqueueOutbox, recordAudit } from '../../../infrastructure/evidence.js'
import * as repo from '../adapters/pricing-repo.js'

// Pricing rules lifecycle and calculation (FR-253, ADR-098) inside SCM — port of
// apps/server pricing-rules-service with the same schemas, the same order of
// refusals, the same error codes and the same audit actions:
//   draft    — OWNER only; rules validated by the ONE kernel evaluator; a source
//              rule set must be in the same Business (404 otherwise).
//   update   — DRAFT only, compare-and-swap on (id, version, status).
//   approve  — DRAFT → APPROVED with an effective date not in the past and an
//              expiry after it; revoke — APPROVED → REVOKED, dates refused.
//   calculate— against the latest effective policy only. A revoked or expired
//              latest policy is refused, never replaced by an older one
//              (no silent fallback); the result is an immutable snapshot that is
//              never publishable; the same key + same normalized request
//              replays, a different one is 409; a replay re-checks the policy,
//              so a withdrawn price is never offered again.
// Differences from legacy are recorded in SCM-HANDOFF §5 (D-11: the business
// idempotency key is the Idempotency-Key header, not a body field).

const id = z.string().trim().min(1).max(200)
const revision = z.number().int().positive()
const name = z.string().trim().min(1).max(120)
const reason = z.string().trim().min(1).max(2000)
const scope = { businessId: id }
export const zListPricingRules = z.object(scope).strict()
export const zCreatePricingRule = z.object({ ...scope, name, rules: z.unknown(), sourceRuleSetId: id.optional() }).strict()
export const zUpdatePricingRule = z.object({ ...scope, version: revision, name, rules: z.unknown(), reason }).strict()
export const zPricingRuleAction = z.object({ ...scope, version: revision, action: z.enum(['APPROVE', 'REVOKE']), effectiveFrom: z.string().datetime({ offset: true }).optional(), expiresAt: z.string().datetime({ offset: true }).nullable().optional(), reason }).strict()
export const zPreviewPricing = z.object({ ...scope, rules: z.unknown(), input: z.unknown(), compareRuleSetId: id.optional() }).strict()
export const zCalculatePricing = z.object({ ...scope, ruleSetId: id.optional(), input: z.unknown() }).strict()

const RULE_ENTITY = 'PRICING_RULE_SET'
const CALCULATION_ENTITY = 'PRICING_CALCULATION'
const failure = (status, code) => Object.assign(new Error(code), { status, code, retryable: false })

function engine(fn) {
  try { return fn() } catch (error) {
    if (error.status === 422) error.details = [{ field: error.field ?? 'rules', code: error.code ?? 'INVALID_PRICING_RULES', message: error.message }]
    throw error
  }
}

/** Commerce view + Business OWNER, or the same 404 as an unknown Business. */
export const ownerBusiness = (scopeOf, businessId) => commerceAuthority.require(scopeOf, businessId, 'pricing')

function scopedRule(sql, business, ruleSetId) {
  const row = repo.ruleById(sql, ruleSetId)
  if (!row || row.businessId !== business.id || row.tenantId !== business.tenantId) throw denied()
  return row
}

const usable = (row, now) => row.status === 'APPROVED' && Boolean(row.effectiveFrom) && row.effectiveFrom <= now && (!row.expiresAt || row.expiresAt > now)

function ruleDto(row, now) {
  const { rulesJson, ...meta } = row
  return { ...meta, rules: JSON.parse(rulesJson), isActive: usable(row, now) }
}

function calculationDto(row) {
  const { inputJson, resultJson, rulesJson, requestHash, ...meta } = row
  return { ...meta, input: JSON.parse(inputJson), result: JSON.parse(resultJson), publishable: false }
}

const snapshot = (value) => value && ({ status: value.status, version: value.version, rulesHash: value.rulesHash, effectiveFrom: value.effectiveFrom, expiresAt: value.expiresAt })

function audit(sql, scopeOf, row, action, reasonText, before, { now, requestId, faults = {} }) {
  recordAudit(sql, { entityType: RULE_ENTITY, entityId: row.id, action, actorId: scopeOf.actorId, tenantId: row.tenantId, businessId: row.businessId, requestId, now, reason: reasonText, before: snapshot(before), after: snapshot(row), payload: { name: row.name, sourceRuleSetId: row.sourceRuleSetId } })
  faults.afterAudit?.()
  // Outbox carries identity and hashes only — never rule content or a price.
  enqueueOutbox(sql, { topic: `scm.commerce.${action.toLowerCase().replace(/_/g, '-')}`, aggregateType: RULE_ENTITY, aggregateId: row.id, aggregateVersion: row.version, now, payload: { businessId: row.businessId, status: row.status, rulesHash: row.rulesHash, effectiveFrom: row.effectiveFrom, expiresAt: row.expiresAt } })
}

const ruleOutcome = (dto) => ({ response: { ruleSet: dto }, affected: { ruleSetId: dto.id, ruleSetVersion: dto.version, status: dto.status } })

/** The rule a command targets, in the caller's Business; authorization for update/action. */
export function loadRuleInScope(sql, scopeOf, ruleSetId, businessId) {
  const business = ownerBusiness(scopeOf, businessId)
  return scopedRule(sql, business, typeof ruleSetId === 'string' ? ruleSetId.trim() : '')
}

export function listPricingRules(sql, scopeOf, query, now) {
  const data = zListPricingRules.parse(query)
  const business = ownerBusiness(scopeOf, data.businessId)
  const rows = repo.rulesOfBusiness(sql, business.tenantId, business.id)
  const current = repo.latestEffectiveRule(sql, business.tenantId, business.id, now)
  return { businessId: business.id, rules: rows.map((row) => ({ ...ruleDto(row, now), isActive: row.id === current?.id && usable(row, now) })), template: defaultPricingRules(), canManage: true }
}

export function createPricingRuleSet(sql, scopeOf, input, ctx) {
  const data = zCreatePricingRule.parse(input)
  const business = ownerBusiness(scopeOf, data.businessId)
  if (data.sourceRuleSetId) scopedRule(sql, business, data.sourceRuleSetId)
  const rules = engine(() => validatePricingRules(data.rules))
  const ruleId = repo.insertRule(sql, { tenantId: business.tenantId, businessId: business.id, name: data.name, rulesJson: JSON.stringify(rules), rulesHash: pricingHash(rules), sourceRuleSetId: data.sourceRuleSetId ?? null, createdByPersonId: scopeOf.actorId, now: ctx.now })
  const row = repo.ruleById(sql, ruleId)
  audit(sql, scopeOf, row, 'PRICING_RULE_DRAFT_CREATED', null, null, ctx)
  return ruleOutcome(ruleDto(row, ctx.now))
}

export function updatePricingRuleSet(sql, scopeOf, ruleSetId, input, ctx) {
  const data = zUpdatePricingRule.parse(input)
  const business = ownerBusiness(scopeOf, data.businessId)
  const before = scopedRule(sql, business, ruleSetId)
  if (before.version !== data.version) throw failure(409, 'PRICING_RULE_VERSION_CONFLICT')
  if (before.status !== 'DRAFT') throw failure(409, 'PRICING_RULE_IMMUTABLE')
  const rules = engine(() => validatePricingRules(data.rules))
  ctx.faults?.beforeRuleUpdate?.()
  if (repo.casUpdateRule(sql, { id: before.id, version: data.version, status: 'DRAFT', change: { name: data.name, rulesJson: JSON.stringify(rules), rulesHash: pricingHash(rules) }, now: ctx.now }) !== 1) throw failure(409, 'PRICING_RULE_VERSION_CONFLICT')
  const row = scopedRule(sql, business, before.id)
  audit(sql, scopeOf, row, 'PRICING_RULE_DRAFT_UPDATED', data.reason, before, ctx)
  return ruleOutcome(ruleDto(row, ctx.now))
}

const iso = (value) => new Date(value).toISOString()

export function applyPricingRuleAction(sql, scopeOf, ruleSetId, input, ctx) {
  const data = zPricingRuleAction.parse(input)
  const business = ownerBusiness(scopeOf, data.businessId)
  const before = scopedRule(sql, business, ruleSetId)
  const { now } = ctx
  if (before.version !== data.version) throw failure(409, 'PRICING_RULE_VERSION_CONFLICT')
  let change
  if (data.action === 'APPROVE') {
    if (before.status !== 'DRAFT') throw failure(409, 'PRICING_RULE_IMMUTABLE')
    engine(() => validatePricingRules(JSON.parse(before.rulesJson)))
    const effectiveFrom = data.effectiveFrom ? iso(data.effectiveFrom) : now
    const expiresAt = data.expiresAt ? iso(data.expiresAt) : null
    if (effectiveFrom < now) throw failure(422, 'PRICING_RULE_EFFECTIVE_DATE_IN_PAST')
    if (expiresAt && expiresAt <= effectiveFrom) throw failure(422, 'PRICING_RULE_EXPIRY_BEFORE_EFFECTIVE_DATE')
    change = { status: 'APPROVED', approvedAt: now, approvedByPersonId: scopeOf.actorId, effectiveFrom, expiresAt, approvalReason: data.reason }
  } else {
    if (before.status !== 'APPROVED') throw failure(409, 'PRICING_RULE_NOT_APPROVED')
    if (data.effectiveFrom !== undefined || data.expiresAt !== undefined) throw failure(422, 'PRICING_RULE_REVOKE_DATES_NOT_ALLOWED')
    change = { status: 'REVOKED', revokedAt: now, revokedByPersonId: scopeOf.actorId, revocationReason: data.reason }
  }
  ctx.faults?.beforeRuleUpdate?.()
  if (repo.casUpdateRule(sql, { id: before.id, version: data.version, status: before.status, change, now }) !== 1) throw failure(409, 'PRICING_RULE_VERSION_CONFLICT')
  const row = scopedRule(sql, business, before.id)
  audit(sql, scopeOf, row, data.action === 'APPROVE' ? 'PRICING_RULE_APPROVED' : 'PRICING_RULE_REVOKED', data.reason, before, ctx)
  return ruleOutcome(ruleDto(row, now))
}

/** The usable latest policy, or 409 — an explicit id must BE the latest policy. */
function activeRule(sql, business, now, ruleSetId) {
  const latest = repo.latestEffectiveRule(sql, business.tenantId, business.id, now)
  const row = ruleSetId ? scopedRule(sql, business, ruleSetId) : latest
  if (!row || !usable(row, now)) throw failure(409, 'PRICING_RULE_NOT_ACTIVE')
  if (ruleSetId && latest?.id !== row.id) throw failure(409, 'PRICING_RULE_NOT_ACTIVE')
  return row
}

export function getActivePricingRuleSet(sql, scopeOf, businessId, now) {
  const business = ownerBusiness(scopeOf, businessId)
  return { ruleSet: ruleDto(activeRule(sql, business, now), now) }
}

export function previewPricingRules(sql, scopeOf, input) {
  const data = zPreviewPricing.parse(input)
  const business = ownerBusiness(scopeOf, data.businessId)
  const baseline = data.compareRuleSetId ? scopedRule(sql, business, data.compareRuleSetId) : null
  const result = engine(() => calculatePrice(data.rules, data.input))
  if (!baseline) return { result }
  const previous = engine(() => calculatePrice(JSON.parse(baseline.rulesJson), data.input))
  return { result, comparison: { ruleSetId: baseline.id, result: previous, deltaUnitPriceSatang: result.unitPriceSatang - previous.unitPriceSatang, deltaTotalPriceSatang: result.totalPriceSatang - previous.totalPriceSatang } }
}

/** The normalized request a calculation key is bound to (legacy requestHash input). */
export function calculationRequest(body) {
  const data = zCalculatePricing.parse(body)
  return { ruleSetId: data.ruleSetId ?? null, input: engine(() => normalizePricingInput(data.input)) }
}

/** Replay of a stored calculation: historical evidence, but never a withdrawn price. */
export function guardCalculationReplay(sql, scopeOf, businessId, stored, now) {
  const business = ownerBusiness(scopeOf, businessId)
  activeRule(sql, business, now, stored.calculation.ruleSetId)
}

export function calculatePricing(sql, scopeOf, body, { now, requestId, faults = {} }) {
  const data = zCalculatePricing.parse(body)
  const business = ownerBusiness(scopeOf, data.businessId)
  const request = calculationRequest(body)
  const requestHash = pricingHash(request)
  const outcome = (row) => ({ response: { calculation: calculationDto(row) }, affected: { calculationId: row.id, ruleSetId: row.ruleSetId, ruleVersion: row.ruleVersion } })
  // Keys are per Business, not per caller: another owner re-using a key gets the
  // same snapshot (same request) or the same conflict (different request).
  const existing = repo.calculationByKey(sql, business.id, requestId)
  if (existing) {
    if (existing.requestHash !== requestHash) throw failure(409, 'PRICING_CALCULATION_IDEMPOTENCY_CONFLICT')
    activeRule(sql, business, now, existing.ruleSetId)
    return outcome(existing)
  }
  const row = activeRule(sql, business, now, data.ruleSetId)
  const result = engine(() => calculatePrice(JSON.parse(row.rulesJson), request.input))
  faults.beforeCalculationInsert?.()
  const calculationId = repo.insertCalculation(sql, { tenantId: business.tenantId, businessId: business.id, ruleSetId: row.id, ruleVersion: row.version, rulesHash: row.rulesHash, rulesJson: row.rulesJson, evaluatorVersion: result.evaluatorVersion, inputHash: result.inputHash, inputJson: JSON.stringify(request.input), resultJson: JSON.stringify(result), requestHash, idempotencyKey: requestId, createdByPersonId: scopeOf.actorId, now })
  recordAudit(sql, { entityType: CALCULATION_ENTITY, entityId: calculationId, action: 'PRICING_CALCULATED', actorId: scopeOf.actorId, tenantId: business.tenantId, businessId: business.id, requestId, now, payload: { ruleSetId: row.id, ruleVersion: row.version, rulesHash: row.rulesHash, inputHash: result.inputHash, evaluatorVersion: result.evaluatorVersion, inputProvenance: 'USER_ENTERED' } })
  faults.afterAudit?.()
  enqueueOutbox(sql, { topic: 'scm.commerce.pricing-calculated', aggregateType: CALCULATION_ENTITY, aggregateId: calculationId, aggregateVersion: 1, now, payload: { businessId: business.id, ruleSetId: row.id, ruleVersion: row.version, rulesHash: row.rulesHash, inputHash: result.inputHash, evaluatorVersion: result.evaluatorVersion } })
  return outcome(repo.calculationById(sql, calculationId))
}
