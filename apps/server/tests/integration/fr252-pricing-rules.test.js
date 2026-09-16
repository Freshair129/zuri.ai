// @req FR-252 — real persistence, authorization, immutable lineage and lifecycle gates.
// @spec ADR-097; SEC-001; BR-001; BR-002
// @tested tests/integration/fr252-pricing-rules.test.js
import { beforeEach, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { defaultPricingRules } from '@/modules/commerce/domain/pricing-engine'
import { applyPricingRuleAction, calculatePricing, createPricingRuleSet, getActivePricingRuleSet, listPricingRules, previewPricingRules, updatePricingRuleSet } from '@/modules/commerce/application/pricing-rules-service'

const NOW = new Date('2026-09-17T00:00:00.000Z')
const later = (minutes) => new Date(NOW.getTime() + minutes * 60000)
const input = () => ({ costBasis: 'landed', landedUnitCostThb: '123.45', quantity: 100, kind: 'set', profile: 'corporate', orderCostThb: '0', sourceRefs: [] })
let business, other, owner, member, foreignOwner
let fixture = 0

describe('FR-252 scoped pricing lifecycle', () => {
  beforeEach(async () => {
    fixture += 1
    const portfolio = await createPortfolio({ code: `PF-FR252-${fixture}`, name: 'Pricing fixture' })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: `TNT-FR252-${fixture}`, name: 'Pricing' })
    business = await createBusiness({ tenantId: tenant.id, code: `BUS-FR252-${fixture}`, name: 'Pricing A' })
    other = await createBusiness({ tenantId: tenant.id, code: `BUS-FR252-${fixture}-OTHER`, name: 'Pricing B' })
    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: ['commerce'] })
    member = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: ['commerce'] })
    foreignOwner = makeViewer({ visibleBusinessIds: [other.id], ownedBusinessIds: [other.id], visibleDomains: ['commerce'] })
  })
  const draft = (over = {}, opts = {}) => createPricingRuleSet({ businessId: business.id, name: 'Fixture policy', rules: defaultPricingRules(), ...over }, { viewer: owner, now: NOW, ...opts })
  const approve = (row, over = {}, now = NOW) => applyPricingRuleAction(row.id, { businessId: business.id, version: row.version, action: 'APPROVE', reason: 'Fixture owner review', ...over }, { viewer: owner, now })
  const calculate = (key, ruleSetId, over = {}, opts = {}) => calculatePricing({ businessId: business.id, ruleSetId, idempotencyKey: key, input: input(), ...over }, { viewer: owner, now: NOW, ...opts })

  it('refuses internal reads, editing, preview, calculation and activation by members or other Business owners', async () => {
    const row = await draft()
    for (const viewer of [member, foreignOwner]) {
      await expect(listPricingRules({ businessId: business.id }, { viewer })).rejects.toMatchObject({ status: 404 })
      await expect(draft({}, { viewer })).rejects.toMatchObject({ status: 404 })
      await expect(previewPricingRules({ businessId: business.id, rules: row.rules, input: input() }, { viewer })).rejects.toMatchObject({ status: 404 })
      await expect(calculate('forbidden', row.id, {}, { viewer })).rejects.toMatchObject({ status: 404 })
      await expect(applyPricingRuleAction(row.id, { businessId: business.id, version: 1, action: 'APPROVE', reason: 'attempt' }, { viewer })).rejects.toMatchObject({ status: 404 })
    }
    const foreign = await draft({ businessId: other.id }, { viewer: foreignOwner })
    await expect(draft({ sourceRuleSetId: foreign.id })).rejects.toMatchObject({ status: 404 })
    await expect(previewPricingRules({ businessId: business.id, rules: row.rules, input: input(), compareRuleSetId: foreign.id }, { viewer: owner })).rejects.toMatchObject({ status: 404 })
    await expect(calculate('foreign-id', foreign.id)).rejects.toMatchObject({ status: 404 })
  })

  it('edits drafts with compare-and-swap and records changes and approval atomically', async () => {
    const row = await draft()
    const patch = { businessId: business.id, version: row.version, name: 'Reviewed draft', rules: row.rules, reason: 'Rename after review' }
    const updated = await updatePricingRuleSet(row.id, patch, { viewer: owner })
    expect(updated).toMatchObject({ version: 2, name: 'Reviewed draft', status: 'DRAFT' })
    await expect(updatePricingRuleSet(row.id, patch, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'PRICING_RULE_VERSION_CONFLICT' })
    const approved = await approve(updated)
    expect(approved).toMatchObject({ status: 'APPROVED', version: 3, approvedByPersonId: owner.principal.id, isActive: true })
    await expect(updatePricingRuleSet(row.id, { ...patch, version: approved.version }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'PRICING_RULE_IMMUTABLE' })
    await expect(approve(approved)).rejects.toMatchObject({ status: 409, message: 'PRICING_RULE_IMMUTABLE' })
    const audits = await prisma.auditEvent.findMany({ where: { entityType: 'PRICING_RULE_SET', entityId: row.id }, orderBy: { occurredAt: 'asc' } })
    expect(audits.map((event) => event.action)).toEqual(['PRICING_RULE_DRAFT_CREATED', 'PRICING_RULE_DRAFT_UPDATED', 'PRICING_RULE_APPROVED'])
    expect(audits.every((event) => event.businessId === business.id)).toBe(true)
    expect(audits[2].reason).toBe('Fixture owner review')
  })

  it('rolls back the rule write when its audit write fails', async () => {
    const count = await prisma.pricingRuleSet.count({ where: { businessId: business.id } })
    const db = { $transaction: (fn) => prisma.$transaction((tx) => fn(new Proxy(tx, { get(target, key) { return key === 'auditEvent' ? { create: () => { throw new Error('audit unavailable') } } : target[key] } }))) }
    await expect(draft({}, { db })).rejects.toThrow('audit unavailable')
    expect(await prisma.pricingRuleSet.count({ where: { businessId: business.id } })).toBe(count)
  })

  it('uses the same evaluator in preview and durable calculation, with immutable snapshots and idempotency', async () => {
    const approved = await approve(await draft())
    const preview = await previewPricingRules({ businessId: business.id, rules: approved.rules, input: input(), compareRuleSetId: approved.id }, { viewer: owner })
    const result = await calculate('same-request', approved.id)
    expect(result.result).toEqual(preview.result)
    expect(preview.comparison).toMatchObject({ ruleSetId: approved.id, deltaUnitPriceSatang: 0, deltaTotalPriceSatang: 0 })
    expect(result).toMatchObject({ ruleSetId: approved.id, ruleVersion: approved.version, rulesHash: approved.rulesHash, inputProvenance: 'USER_ENTERED', publishable: false })
    expect(result.inputHash).toBe(result.result.inputHash)
    expect(result.rulesHash).toBe(result.result.ruleHash)
    expect(result).not.toHaveProperty('rulesJson')
    expect((await calculate('same-request', approved.id)).id).toBe(result.id)
    await expect(calculate('same-request', approved.id, { input: { ...input(), quantity: 200 } })).rejects.toMatchObject({ status: 409, message: 'PRICING_CALCULATION_IDEMPOTENCY_CONFLICT' })
    const next = await draft({ name: 'New generation', sourceRuleSetId: approved.id })
    await approve(next, {}, later(1))
    await expect(calculate('superseded-explicit', approved.id, {}, { now: later(2) })).rejects.toMatchObject({ status: 409, message: 'PRICING_RULE_NOT_ACTIVE' })
    const stored = await prisma.pricingCalculation.findUnique({ where: { id: result.id } })
    expect(stored.ruleVersion).toBe(approved.version)
    expect(JSON.parse(stored.resultJson)).toEqual(preview.result)
    expect(await prisma.auditEvent.count({ where: { entityId: result.id, action: 'PRICING_CALCULATED' } })).toBe(1)
  })

  it('rejects caller approval/provenance claims and malformed formulas without persisting', async () => {
    await expect(draft({ status: 'APPROVED' })).rejects.toThrow()
    const row = await approve(await draft())
    await expect(calculate('spoof-source', row.id, { inputProvenance: 'VERIFIED', publishable: true })).rejects.toThrow()
    await expect(calculate('spoof-input', row.id, { input: { ...input(), approved: true } })).rejects.toMatchObject({ status: 422 })
    await expect(draft({ rules: { invalid: true } })).rejects.toMatchObject({ status: 422, details: expect.any(Array) })
  })

  it('does not activate future policy early, expire late or fall back after latest-policy revocation', async () => {
    const previous = await approve(await draft(), { effectiveFrom: later(10).toISOString() })
    const next = await approve(await draft(), { effectiveFrom: later(20).toISOString(), expiresAt: later(30).toISOString() })
    await expect(calculate('future-policy', next.id)).rejects.toMatchObject({ status: 409, message: 'PRICING_RULE_NOT_ACTIVE' })
    expect((await getActivePricingRuleSet(business.id, { viewer: owner, now: later(15) })).id).toBe(previous.id)
    expect((await getActivePricingRuleSet(business.id, { viewer: owner, now: later(25) })).id).toBe(next.id)
    await expect(calculate('expired-policy', next.id, {}, { now: later(30) })).rejects.toMatchObject({ status: 409 })
    await expect(getActivePricingRuleSet(business.id, { viewer: owner, now: later(31) })).rejects.toMatchObject({ status: 409 })
    const immutable = await calculate('before-revoke', next.id, {}, { now: later(25) })
    const revoked = await applyPricingRuleAction(next.id, { businessId: business.id, version: next.version, action: 'REVOKE', reason: 'Withdraw fixture' }, { viewer: owner, now: later(26) })
    expect(revoked).toMatchObject({ status: 'REVOKED', rulesHash: next.rulesHash, isActive: false })
    await expect(calculate('before-revoke', next.id, {}, { now: later(27) })).rejects.toMatchObject({ status: 409 })
    await expect(getActivePricingRuleSet(business.id, { viewer: owner, now: later(27) })).rejects.toMatchObject({ status: 409 })
    const listed = await listPricingRules({ businessId: business.id }, { viewer: owner, now: later(27) })
    expect(listed.rules.some((row) => row.isActive)).toBe(false)
    expect(JSON.parse((await prisma.pricingCalculation.findUnique({ where: { id: immutable.id } })).resultJson)).toEqual(immutable.result)
  })

  it('rejects invalid activation windows and missing policy rather than defaulting to template rates', async () => {
    const row = await draft()
    await expect(approve(row, { effectiveFrom: later(-1).toISOString() })).rejects.toMatchObject({ status: 422 })
    await expect(approve(row, { effectiveFrom: later(1).toISOString(), expiresAt: later(1).toISOString() })).rejects.toMatchObject({ status: 422 })
    await expect(getActivePricingRuleSet(other.id, { viewer: foreignOwner, now: NOW })).rejects.toMatchObject({ status: 409 })
    const listed = await listPricingRules({ businessId: business.id }, { viewer: owner, now: NOW })
    expect(listed.canManage).toBe(true)
    expect(listed.template).toEqual(defaultPricingRules())
  })
})
