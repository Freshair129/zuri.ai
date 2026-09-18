// @req FR-253 — backup retains scoped immutable pricing lineage in self-FK order.
// @spec ADR-098
import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { exportSnapshot, importSnapshot, previewImport, validateSnapshotRecovery, SNAPSHOT_MODELS } from '@/modules/project-manager/application/backup-service'
import { insertSnapshotIntoEmptyTarget, validateSnapshotRecovery as validateOfflineSnapshot } from '../../scripts/phase-b-recovery-hooks.mjs'
import { calculatePrice, defaultPricingRules, pricingHash, normalizePricingInput } from '@/modules/commerce/domain/pricing-engine'
import { makeOperatorViewer } from '../factories/viewer'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'

const rules = defaultPricingRules()
const rule = (id, sourceRuleSetId = null) => ({ id, tenantId: 'tenant-a', businessId: 'business-a', name: id, sourceRuleSetId, status: 'APPROVED', version: 1, rulesJson: JSON.stringify(rules), rulesHash: pricingHash(rules), approvedAt: '2026-09-17T00:00:00Z', effectiveFrom: '2026-09-17T00:00:00Z', approvalReason: 'test' })
const snapshot = () => ({ schemaVersion: '1.0', tables: { tenant: [{ id: 'tenant-a' }], business: [{ id: 'business-a', tenantId: 'tenant-a' }], pricingRuleSet: [rule('child', 'root'), rule('root')], pricingCalculation: [] } })
function mockDb(counts = {}, liveRows = []) {
  const models = new Map(), deletes = [], created = []
  const db = new Proxy({}, { get: (_, name) => {
    if (name === '_activeProvider') return 'sqlite'
    if (name === '$transaction') return async (work) => work(db)
    if (!models.has(name)) models.set(name, {
      count: vi.fn(async () => counts[name] || 0), findMany: vi.fn(async () => name === 'pricingRuleSet' ? liveRows : []),
      deleteMany: vi.fn(async () => { deletes.push(name) }), delete: vi.fn(async ({ where }) => { deletes.push(`${name}:${where.id}`) }),
      create: vi.fn(async ({ data }) => { created.push([name, data]); return data }),
    })
    return models.get(name)
  } })
  return { db, deletes, created }
}
const preview = (s, db) => previewImport(s, { db, viewer: makeOperatorViewer(), nested: true })

describe('pricing backup recovery boundary', () => {
  // @req FR-252 — the process-only recovery path composes the same Pricing
  // provenance validator and self-FK order as the web backup service.
  it('validates Pricing before offline insertion and uses parent-first rows', async () => {
    const s = snapshot()
    for (const model of SNAPSHOT_MODELS) s.tables[model] ??= []
    const validated = await validateOfflineSnapshot(s)
    expect(validated.valid).toBe(true)
    expect(validated.pricingRecovery.ruleRows.map((row) => row.id)).toEqual(['root', 'child'])
    const inserted = []
    const tx = { insertRows: async (model, rows) => { inserted.push([model, rows]) } }
    await insertSnapshotIntoEmptyTarget({ tx, adapter: {}, snapshot: s })
    expect(inserted.find(([model]) => model === 'pricingRuleSet')[1].map((row) => row.id)).toEqual(['root', 'child'])
  })
  it.each([
    ['invalid hash', (s) => { s.tables.pricingRuleSet[0].rulesHash = 'a'.repeat(64) }],
    ['cyclic lineage', (s) => { s.tables.pricingRuleSet[1].sourceRuleSetId = 'child' }],
  ])('rejects %s through shared and offline validators before any insert', async (_, mutate) => {
    const s = snapshot()
    for (const model of SNAPSHOT_MODELS) s.tables[model] ??= []
    mutate(s)
    expect(validateSnapshotRecovery(s).valid).toBe(false)
    expect((await validateOfflineSnapshot(s)).valid).toBe(false)
    const tx = { insertRows: vi.fn() }
    await expect(insertSnapshotIntoEmptyTarget({ tx, adapter: {}, snapshot: s })).rejects.toMatchObject({ code: 'PHASE_B_SNAPSHOT_INVALID' })
    expect(tx.insertRows).not.toHaveBeenCalled()
  })
  it('orders unordered derivations parent-first and deletes existing rows children-first', async () => {
    const mock = mockDb({}, [rule('root'), rule('child', 'root')])
    const p = await preview(snapshot(), mock.db)
    expect(p.valid).toBe(true)
    expect(p.pricingRecovery.ruleRows.map((row) => row.id)).toEqual(['root', 'child'])
    const result = await importSnapshot(snapshot(), { confirm: true, db: mock.db, viewer: makeOperatorViewer() })
    expect(result.restored).toBe(true)
    expect(mock.deletes.filter((name) => name.startsWith('pricingRuleSet:'))).toEqual(['pricingRuleSet:child', 'pricingRuleSet:root'])
    expect(mock.created.filter(([name]) => name === 'pricingRuleSet').map(([, row]) => row.id)).toEqual(['root', 'child'])
  })
  it.each([
    ['cycle', (s) => { s.tables.pricingRuleSet[1].sourceRuleSetId = 'child' }],
    ['missing source', (s) => { s.tables.pricingRuleSet[0].sourceRuleSetId = 'missing' }],
    ['omitted source lineage', (s) => { delete s.tables.pricingRuleSet[0].sourceRuleSetId }],
    ['cross-business source', (s) => { s.tables.business.push({ id: 'business-b', tenantId: 'tenant-a' }); s.tables.pricingRuleSet[0].businessId = 'business-b' }],
    ['cross-tenant row', (s) => { s.tables.pricingRuleSet[0].tenantId = 'other' }],
    ['duplicate id', (s) => { s.tables.pricingRuleSet.push(rule('root')) }],
    ['partial family', (s) => { delete s.tables.pricingCalculation }],
    ['malformed family', (s) => { s.tables.pricingRuleSet = null }],
    ['tampered rules hash', (s) => { s.tables.pricingRuleSet[0].rulesHash = 'a'.repeat(64) }],
  ])('refuses %s before any destructive action', async (_, mutate) => {
    const s = snapshot(), mock = mockDb(); mutate(s)
    const result = await importSnapshot(s, { confirm: true, db: mock.db, viewer: makeOperatorViewer() })
    expect(result).toMatchObject({ restored: false, valid: false })
    expect(mock.deletes).toEqual([])
  })
  it('refuses legacy omission when existing evidence would be erased', async () => {
    const s = snapshot(); delete s.tables.pricingRuleSet; delete s.tables.pricingCalculation
    const mock = mockDb({ pricingCalculation: 1 })
    const result = await importSnapshot(s, { confirm: true, db: mock.db, viewer: makeOperatorViewer() })
    expect(result).toMatchObject({ restored: false, valid: false })
    expect(result.errors.join(' ')).toMatch(/pricing.*erase evidence/i)
    expect(mock.deletes).toEqual([])
  })
  it('rechecks legacy omission inside the transaction if a row appeared after preview', async () => {
    const s = snapshot(); delete s.tables.pricingRuleSet; delete s.tables.pricingCalculation
    const mock = mockDb()
    mock.db.pricingRuleSet.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1)
    const result = await importSnapshot(s, { confirm: true, db: mock.db, viewer: makeOperatorViewer() })
    expect(result).toMatchObject({ restored: false, valid: false, errorCode: 'BACKUP_PRICING_RECOVERY_LIVE_DATA_APPEARED' })
    expect(mock.deletes).toEqual([])
  })
  it('validates pinned calculation scope and own historical hashes, not the latest mutable revision', async () => {
    const s = snapshot(), i = normalizePricingInput({ costBasis: 'landed', landedUnitCostThb: '100', orderCostThb: '0', quantity: 100, kind: 'set', profile: 'corporate', sourceRefs: [] })
    const result = calculatePrice(rules, i)
    s.tables.pricingCalculation.push({ id: 'calc', tenantId: 'tenant-a', businessId: 'business-a', ruleSetId: 'root', ruleVersion: 1, rulesHash: result.ruleHash, rulesJson: JSON.stringify(rules), inputHash: result.inputHash, inputJson: JSON.stringify(i), resultJson: JSON.stringify(result), evaluatorVersion: result.evaluatorVersion, idempotencyKey: 'test-key' })
    s.tables.pricingRuleSet[1].version = 2 // later lifecycle revision does not rewrite the result
    expect((await preview(s, mockDb().db)).valid).toBe(true)
    s.tables.pricingCalculation[0].businessId = 'other'
    expect((await preview(s, mockDb().db)).valid).toBe(false)
    s.tables.pricingCalculation[0].businessId = 'business-a'
    s.tables.pricingCalculation[0].inputHash = 'a'.repeat(64)
    expect((await preview(s, mockDb().db)).valid).toBe(false)
  })
  it('round-trips real SQLite self-FKs and preserves calculations on refusal', async () => {
    const suffix = randomUUID(), portfolio = await createPortfolio({ name: `pricing-backup-${suffix}` })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: `tenant-${suffix}` })
    const business = await createBusiness({ tenantId: tenant.id, name: `business-${suffix}` })
    const root = await prisma.pricingRuleSet.create({ data: { ...rule(randomUUID()), tenantId: tenant.id, businessId: business.id } })
    const child = await prisma.pricingRuleSet.create({ data: { ...rule(randomUUID(), root.id), tenantId: tenant.id, businessId: business.id } })
    const input = normalizePricingInput({ costBasis: 'landed', landedUnitCostThb: '100', orderCostThb: '0', quantity: 100, kind: 'set', profile: 'corporate', sourceRefs: [] })
    const calculation = calculatePrice(rules, input)
    const saved = await prisma.pricingCalculation.create({ data: { tenantId: tenant.id, businessId: business.id, ruleSetId: root.id, ruleVersion: 1, rulesJson: root.rulesJson, rulesHash: root.rulesHash, evaluatorVersion: calculation.evaluatorVersion, inputHash: calculation.inputHash, inputJson: JSON.stringify(input), resultJson: JSON.stringify(calculation), requestHash: pricingHash({ ruleSetId: root.id, input }), idempotencyKey: suffix } })
    const before = await exportSnapshot()
    before.tables.pricingRuleSet.sort((a, b) => a.id === child.id ? -1 : b.id === child.id ? 1 : 0)
    const restored = await importSnapshot(before, { confirm: true, viewer: makeOperatorViewer() })
    expect(restored.restored).toBe(true)
    expect(await prisma.pricingRuleSet.findUnique({ where: { id: child.id } })).toMatchObject({ sourceRuleSetId: root.id, rulesHash: root.rulesHash })
    expect(await prisma.pricingCalculation.findUnique({ where: { id: saved.id } })).toEqual(saved)
    const invalid = structuredClone(before); invalid.tables.pricingRuleSet.find((r) => r.id === root.id).sourceRuleSetId = child.id
    const refused = await importSnapshot(invalid, { confirm: true, viewer: makeOperatorViewer() })
    expect(refused.restored).toBe(false)
    expect(await prisma.pricingRuleSet.findUnique({ where: { id: root.id } })).toMatchObject({ sourceRuleSetId: null })
    expect(await prisma.pricingCalculation.findUnique({ where: { id: saved.id } })).toEqual(saved)
    await prisma.pricingCalculation.delete({ where: { id: saved.id } })
    await prisma.pricingRuleSet.delete({ where: { id: child.id } })
    await prisma.pricingRuleSet.delete({ where: { id: root.id } })
  })
})
