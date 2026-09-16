// @req FR-253 — ledger-only sell-side admission, immutable retry and no fabricated publication.
// @spec ADR-098; ADR-075; SEC-001; BR-002
// @tested tests/integration/fr252-pricing-catalog.test.js
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { createCategory, createProduct, createProductMaster } from '@/modules/inventory/application/inventory-catalog-service'
import { recordMovement } from '@/modules/inventory/application/inventory-stock-service'
import { defaultPricingRules, pricingHash } from '@/modules/commerce/domain/pricing-engine'
import { createPricingRuleSet, applyPricingRuleAction } from '@/modules/commerce/application/pricing-rules-service'
import { admitPricingCatalog } from '@/modules/commerce/application/pricing-catalog-service'
import { assertKnowledgeFileCurrent, assertKnowledgeFileReadable } from '@/modules/knowledge/knowledge-authorization'
import { renderStructuredCatalogDocument } from '@/modules/knowledge/genesisrag17-structured-record'

const NOW = new Date(Date.now() - 60000)
const EXPIRES = new Date(NOW.getTime() + 3600000)
let business, owner, member, product, missing, partial, approved, env, first, reviewHash
const blobs = new Map()
const storage = {
  async put({ key, content }) { const ref = `memory://${key}`; blobs.set(ref, Buffer.from(content)); return { ref } },
  async get({ ref }) { if (!blobs.has(ref)) throw new Error('Blob missing'); return blobs.get(ref) },
  async remove({ ref }) { blobs.delete(ref) },
}

describe('FR-253 computed catalog admission', () => {
  afterAll(async () => {
    // This run shares its DB with durable-worker tests. Retire only this
    // fixture's queue rows after its admission assertions have completed.
    if (business) await prisma.knowledgeIngestion.deleteMany({ where: { corpus: { businessId: business.id } } })
  })
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-PCAT', name: 'Pricing catalog' })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-PCAT', name: 'Pricing catalog' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-PCAT', name: 'Pricing catalog' })
    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: ['commerce', 'inventory', 'knowledge'] })
    member = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: ['commerce', 'inventory', 'knowledge'] })
    const draft = await createPricingRuleSet({ businessId: business.id, name: 'Catalog fixture', rules: defaultPricingRules() }, { viewer: owner, now: NOW })
    approved = await applyPricingRuleAction(draft.id, { businessId: business.id, version: draft.version, action: 'APPROVE', expiresAt: EXPIRES.toISOString(), reason: 'Catalog fixture review' }, { viewer: owner, now: NOW })
    const category = await createCategory({ businessId: business.id, code: 'pricing-catalog', nameTh: 'สินค้าทดสอบ', nameEn: 'Fixture' }, { viewer: owner })
    const master = await createProductMaster({ businessId: business.id, code: 'PM-PCAT', categoryId: category.id, nameTh: 'แก้วทดสอบ', nameEn: 'Fixture tumbler' }, { viewer: owner })
    const sku = (code) => createProduct({ businessId: business.id, productMasterId: master.id, code, name: code }, { viewer: owner })
    product = await sku('SKU-PCAT')
    missing = await sku('SKU-PCAT-MISSING')
    partial = await sku('SKU-PCAT-PARTIAL')
    await recordMovement({ businessId: business.id, productId: product.id, kind: 'RECEIPT', quantity: 200, costSatang: 10000 }, { viewer: owner })
    await recordMovement({ businessId: business.id, productId: partial.id, kind: 'RECEIPT', quantity: 200, costSatang: 10000 }, { viewer: owner })
    await recordMovement({ businessId: business.id, productId: partial.id, kind: 'RECEIPT', quantity: 100 }, { viewer: owner })
    const scope = { portfolioId: portfolio.id, tenantId: tenant.id, businessId: business.id, workspaceId: 'workspace-pricing-catalog', agentId: 'agent-pricing-catalog', visibility: 'private' }
    env = { ZURI_KNOWLEDGE_ENABLED: '1', ZURI_KNOWLEDGE_BINDINGS: JSON.stringify([{ scope, policy: { allowEmbedding: true, allowPublication: true } }]), MSP_PIPELINE_PRINCIPALS: JSON.stringify([{ role: 'source', credential: 'fixture-only-catalog-credential', scope }]), ZURI_MSP_COMMAND: process.execPath }
  })
  const admit = (over = {}, options = {}) => admitPricingCatalog({ businessId: business.id, productId: product.id, expectedRuleSetId: approved.id, expectedRuleVersion: approved.version, quantities: [100, 300], reason: 'Owner reviewed catalog tiers', idempotencyKey: 'catalog-first', previewHash: reviewHash || '0'.repeat(64), ...over }, { viewer: owner, db: prisma, now: NOW, env, objectStoragePort: storage, ...options })

  it('refuses non-owner and disabled Knowledge before any upload or calculation', async () => {
    await expect(admit({}, { viewer: member })).rejects.toMatchObject({ status: 404 })
    await expect(admit({ expectedRuleSetId: 'stale-policy' })).rejects.toMatchObject({ status: 409, message: 'PRICING_CATALOG_POLICY_CHANGED' })
    await expect(admit({ expectedRuleVersion: 1 })).rejects.toMatchObject({ status: 409, message: 'PRICING_CATALOG_POLICY_CHANGED' })
    await expect(admit({}, { env: { ...env, ZURI_KNOWLEDGE_ENABLED: '0' } })).rejects.toMatchObject({ status: 503 })
    expect(blobs.size).toBe(0)
    expect(await prisma.pricingCalculation.count({ where: { businessId: business.id } })).toBe(0)
  })

  it('previews exact sell prices without writes and refuses stale cost evidence before approval', async () => {
    const audits = await prisma.auditEvent.count({ where: { businessId: business.id } })
    const preview = await admit({ previewOnly: true })
    expect(preview).toMatchObject({ previewOnly: true, publicationStatus: 'NOT_SUBMITTED', ruleSetId: approved.id, ruleVersion: approved.version, previewHash: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(preview.prices.map((price) => price.quantity)).toEqual([100, 300])
    expect(preview.prices.every((price) => Number.isSafeInteger(price.unitPriceSatang) && price.totalPriceSatang === price.quantity * price.unitPriceSatang)).toBe(true)
    expect(await prisma.pricingCalculation.count({ where: { businessId: business.id } })).toBe(0)
    expect(await prisma.auditEvent.count({ where: { businessId: business.id } })).toBe(audits)
    expect(blobs.size).toBe(0)
    await expect(admit({ previewHash: undefined })).rejects.toThrow()
    await recordMovement({ businessId: business.id, productId: product.id, kind: 'RECEIPT', quantity: 100, costSatang: 15000 }, { viewer: owner })
    await expect(admit({ previewHash: preview.previewHash })).rejects.toMatchObject({ status: 409, message: 'PRICING_CATALOG_PREVIEW_CHANGED' })
    expect(await prisma.pricingCalculation.count({ where: { businessId: business.id } })).toBe(0)
    expect(blobs.size).toBe(0)
    const refreshed = await admit({ previewOnly: true })
    expect(refreshed.previewHash).not.toBe(preview.previewHash)
    reviewHash = refreshed.previewHash
  })

  it('freezes ledger-calculated allowlisted records and queues the existing 17-stage admission without claiming publication', async () => {
    first = await admit()
    expect(first).toMatchObject({ status: 'ADMITTED', publicationStatus: 'NOT_VERIFIED', ruleSetId: approved.id, admission: { recordCount: 3, admittedCount: 3, deniedCount: 0 } })
    const asset = await prisma.fileAsset.findUnique({ where: { id: first.fileAssetId } })
    const text = (await storage.get({ ref: asset.blobRef })).toString('utf8')
    const records = JSON.parse(text)
    expect(records.map((record) => record.entityType)).toEqual(['ProductMaster', 'PriceListEntry', 'PriceListEntry'])
    expect(records[0].externalId).toBe(`commerce-sku:${product.id}`)
    expect(records[0].code).toBe(records[0].externalId)
    expect(records[0].nameTh).toContain(product.code)
    for (const record of records) expect(() => renderStructuredCatalogDocument(JSON.stringify(record))).not.toThrow()
    expect(records[1]).toMatchObject({ qty: 100, srpSource: 'COMMERCE_APPROVED_COMPUTED', productExternalId: records[0].externalId })
    expect(text).not.toMatch(/costSatang|unitLandedCost|grossProfit|rulesJson|rulesHash|receiptId|margin|floor/i)
    const calculations = await prisma.pricingCalculation.findMany({ where: { id: { in: first.calculationIds } } })
    expect(calculations).toHaveLength(2)
    for (const row of calculations) {
      expect(row.inputProvenance).toBe('INVENTORY_LEDGER')
      expect(row.rulesHash).toBe(approved.rulesHash)
      expect(row.inputHash).toBe(pricingHash(JSON.parse(row.inputJson)))
      expect(JSON.parse(row.inputJson).sourceRefs[0]).toMatchObject({ kind: 'INVENTORY_LEDGER', productId: product.id, receiptCount: 2, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) })
    }
    const sources = await prisma.knowledgeSource.findMany({ where: { fileAssetId: asset.id } })
    const jobs = await prisma.knowledgeIngestion.findMany({ where: { sourceId: { in: sources.map((source) => source.id) } } })
    expect(jobs).toHaveLength(3)
    expect(jobs.every((job) => job.status === 'QUEUED' && job.executionRunId === null)).toBe(true)
  })

  it('replays identical frozen bytes after ledger updates; a changed owner request cannot reuse its key', async () => {
    await recordMovement({ businessId: business.id, productId: product.id, kind: 'RECEIPT', quantity: 100, costSatang: 15000 }, { viewer: owner })
    const replay = await admit()
    expect(replay.fileAssetId).toBe(first.fileAssetId)
    expect(replay.contentHash).toBe(first.contentHash)
    expect(replay.calculationIds.sort()).toEqual(first.calculationIds.sort())
    expect(replay.admission.unchangedCount).toBe(3)
    expect(blobs.size).toBe(1)
    await expect(admit({ quantities: [100, 500] })).rejects.toMatchObject({ status: 409, message: 'PRICING_CATALOG_IDEMPOTENCY_CONFLICT' })
  })

  it('refuses missing/partial ledger cost and any browser attempt to supply prices, calculations or approval evidence', async () => {
    for (const target of [missing, partial]) {
      await expect(admit({ productId: target.id, idempotencyKey: target.code })).rejects.toMatchObject({ status: 422, message: 'PRICING_CATALOG_COMPLETE_LEDGER_COST_REQUIRED' })
    }
    await expect(admit({ calculationId: first.calculationIds[0] })).rejects.toThrow()
    await expect(admit({ unitPriceSatang: 100, sourceRefs: [{ verified: true }] })).rejects.toThrow()
    expect(await prisma.pricingCalculation.count({ where: { businessId: business.id } })).toBe(2)
  })

  it('hashes more than 200 receipt rows and detects a tail receipt even when the sell prices stay identical', async () => {
    await prisma.stockMovement.createMany({ data: Array.from({ length: 201 }, () => ({ businessId: business.id, tenantId: business.tenantId, productId: product.id, kind: 'RECEIPT', quantity: 1, costSatang: 15000 })) })
    const firstPreview = await admit({ previewOnly: true, idempotencyKey: 'large-ledger-preview' })
    const receipts = await prisma.stockMovement.findMany({ where: { businessId: business.id, productId: product.id, kind: 'RECEIPT' }, orderBy: { id: 'asc' } })
    expect(receipts.length).toBeGreaterThan(200)
    const currentUnitCost = Math.ceil(receipts.reduce((sum, row) => sum + row.quantity * row.costSatang, 0) / receipts.reduce((sum, row) => sum + row.quantity, 0))
    await prisma.stockMovement.create({ data: { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', businessId: business.id, tenantId: business.tenantId, productId: product.id, kind: 'RECEIPT', quantity: 1, costSatang: currentUnitCost } })
    const nextPreview = await admit({ previewOnly: true, idempotencyKey: 'large-ledger-preview' })
    expect(nextPreview.prices).toEqual(firstPreview.prices)
    expect(nextPreview.previewHash).not.toBe(firstPreview.previewHash)
    expect(await prisma.pricingCalculation.count({ where: { businessId: business.id } })).toBe(2)
  })

  it('refuses replay after its rule is revoked and retains immutable prior evidence', async () => {
    await expect(assertKnowledgeFileReadable(member, first.fileAssetId, { businessId: business.id, db: prisma, env })).resolves.toHaveProperty('asset')
    // Date-only mocking leaves Prisma's real asynchronous timers running.
    vi.setSystemTime(EXPIRES)
    try {
      await expect(assertKnowledgeFileReadable(member, first.fileAssetId, { businessId: business.id, db: prisma, env })).rejects.toMatchObject({ status: 409, code: 'PRICING_CATALOG_NOT_CURRENT' })
      await expect(assertKnowledgeFileCurrent(first.fileAssetId, { businessId: business.id, db: prisma })).rejects.toMatchObject({ status: 409, code: 'PRICING_CATALOG_NOT_CURRENT' })
    } finally { vi.useRealTimers() }
    await applyPricingRuleAction(approved.id, { businessId: business.id, version: approved.version, action: 'REVOKE', reason: 'Withdraw fixture policy' }, { viewer: owner, now: NOW })
    await expect(admit()).rejects.toMatchObject({ status: 409, message: 'PRICING_RULE_NOT_ACTIVE' })
    await expect(assertKnowledgeFileReadable(member, first.fileAssetId, { businessId: business.id, db: prisma, env })).rejects.toMatchObject({ status: 409, code: 'PRICING_CATALOG_NOT_CURRENT' })
    await expect(assertKnowledgeFileCurrent(first.fileAssetId, { businessId: business.id, db: prisma })).rejects.toMatchObject({ status: 409, code: 'PRICING_CATALOG_NOT_CURRENT' })
    expect(await prisma.pricingCalculation.count({ where: { businessId: business.id } })).toBe(2)
  })
})
