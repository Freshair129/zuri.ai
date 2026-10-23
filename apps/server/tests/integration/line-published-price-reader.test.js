import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { createCategory, createProduct, createProductMaster } from '@/modules/inventory/application/inventory-catalog-service'
import { EVALUATOR_VERSION, pricingHash } from '@/modules/commerce/domain/pricing-engine'
import { uniquePublishedCatalogEntry } from '@/modules/knowledge/corpus-knowledge-reader'
import { withdrawKnowledgeSource } from '@/modules/knowledge/knowledge-corpus-service'
import { readPublishedExactPriceForLine } from '@/modules/commerce/application/line-published-price-reader'
import { createPublishedPriceCatalogFixture } from '../factories/published-price-catalog'

// @req FR-291 — an exact LINE sell-price projection requires the currently
// accepted Knowledge publication, its receipt-backed manifest, and the
// frozen FR-253 producer row; admission alone must never be treated as publish.
// @spec ADR-075, ADR-098, ADR-090, SEC-001
// @tested tests/integration/line-published-price-reader.test.js

function token() {
  return randomUUID().replaceAll('-', '').slice(0, 16)
}

describe('LINE exact published-price reader', () => {
  let business
  let product
  let owner
  let admission
  let reader
  let blobs
  let publicationFixture

  beforeAll(async () => {
    const suffix = token()
    const portfolio = await createPortfolio({ code: `PF-LINE-PRICE-${suffix}`, name: 'LINE price reader' })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: `TNT-LINE-PRICE-${suffix}`, name: 'LINE price reader' })
    business = await createBusiness({ tenantId: tenant.id, code: `BUS-LINE-PRICE-${suffix}`, name: 'LINE price reader' })
    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: ['commerce', 'inventory', 'knowledge'] })
    const category = await createCategory({ businessId: business.id, code: `line-price-${suffix}`, nameTh: 'สินค้าทดสอบ', nameEn: 'Test products' }, { viewer: owner })
    const master = await createProductMaster({ businessId: business.id, code: `PM-LINE-${suffix}`, categoryId: category.id, nameTh: 'สินค้าทดสอบ', nameEn: 'Test product' }, { viewer: owner })
    product = await createProduct({ businessId: business.id, productMasterId: master.id, code: `SKU-LINE-${suffix}`, name: 'Line price test', unit: 'piece' }, { viewer: owner })
    publicationFixture = await createPublishedPriceCatalogFixture({
      business, product, viewer: owner, quantity: 100, quantities: [100, 300],
      publishImmediately: false, db: prisma,
    })
    admission = publicationFixture.admission
    expect(admission.publicationStatus).toBe('NOT_VERIFIED')
    reader = publicationFixture.reader
    blobs = publicationFixture.blobs
  }, 60_000)

  afterAll(async () => {
    if (business) {
      // Retire only this fixture's unprocessed admissions; never touch another
      // Business's shared worker queue.
      await prisma.knowledgeIngestion.updateMany({
        where: { corpus: { businessId: business.id }, status: { in: ['QUEUED', 'RUNNING'] } },
        data: { status: 'WITHDRAWN', failureCode: 'LINE_PRICE_TEST_CLEANUP' },
      })
      await prisma.knowledgeIngestion.deleteMany({ where: { corpus: { businessId: business.id } } })
    }
    blobs.clear()
  }, 60_000)

  it('does not treat a queued FR-253 admission as a published customer price', async () => {
    const result = await readPublishedExactPriceForLine({
      tenantId: product.tenantId, businessId: business.id, productId: product.id, quantity: 100, unit: product.unit,
    }, { db: prisma, knowledgeReader: reader })
    expect(result.state).toBe('UNAVAILABLE')
  })

  it('reads only the exact current receipt-backed published record and never interpolates quantity', async () => {
    const published = await publicationFixture.publish()
    expect(published.status).toBe('PUBLISHED')

    const result = await readPublishedExactPriceForLine({
      tenantId: product.tenantId, businessId: business.id, productId: product.id, quantity: 100, unit: product.unit,
    }, { db: prisma, knowledgeReader: reader })
    expect(result).toMatchObject({ state: 'PUBLISHED', unitAmountMinor: publicationFixture.expectedUnitAmountMinor, currency: 'THB', quantity: 100, unit: product.unit, taxTreatment: 'UNKNOWN' })
    expect(result.publicationDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(result.observedFrom).toBeTruthy()
    expect(result.observedTo).toBeTruthy()
    expect(JSON.stringify(result)).not.toMatch(/costSatang|rulesHash|margin|receiptHash|fileName|provenance|sourceId|ingestionId|productExternalId/i)

    const absentTier = await readPublishedExactPriceForLine({
      tenantId: product.tenantId, businessId: business.id, productId: product.id, quantity: 200, unit: product.unit,
    }, { db: prisma, knowledgeReader: reader })
    expect(absentTier.state).toBe('UNAVAILABLE')
  }, 60_000)

  it('fails closed when Product.unit changes after publication instead of relabeling the frozen price', async () => {
    const originalUnit = product.unit
    const changedUnit = 'carton'
    await prisma.product.update({ where: { id: product.id }, data: { unit: changedUnit } })
    try {
      const result = await readPublishedExactPriceForLine({
        tenantId: product.tenantId, businessId: business.id, productId: product.id, quantity: 100, unit: changedUnit,
      }, { db: prisma, knowledgeReader: reader })
      expect(result.state).toBe('UNAVAILABLE')
    } finally {
      await prisma.product.update({ where: { id: product.id }, data: { unit: originalUnit } })
    }
  }, 60_000)

  it('fails closed when managed bytes no longer match the accepted publication', async () => {
    const asset = await prisma.fileAsset.findUnique({ where: { id: admission.fileAssetId } })
    const original = Buffer.from(blobs.get(asset.blobRef))
    blobs.set(asset.blobRef, Buffer.concat([original, Buffer.from(' ')]))
    try {
      const result = await readPublishedExactPriceForLine({
        tenantId: product.tenantId, businessId: business.id, productId: product.id, quantity: 100, unit: product.unit,
      }, { db: prisma, knowledgeReader: reader })
      expect(result.state).toBe('UNAVAILABLE')
    } finally { blobs.set(asset.blobRef, original) }
  })

  it('fails closed when the frozen producer result disagrees with its published record', async () => {
    const id = publicationFixture.calculationIdsByQuantity[100]
    const original = await prisma.pricingCalculation.findUnique({ where: { id } })
    const resultJson = JSON.parse(original.resultJson)
    resultJson.unitPriceSatang += 1
    resultJson.catalogProjection.priceRecord.srpUnitPriceThb += 0.01
    await prisma.pricingCalculation.update({ where: { id }, data: { resultJson: JSON.stringify(resultJson) } })
    try {
      const result = await readPublishedExactPriceForLine({
        tenantId: product.tenantId, businessId: business.id, productId: product.id, quantity: 100, unit: product.unit,
      }, { db: prisma, knowledgeReader: reader })
      expect(result.state).toBe('UNAVAILABLE')
    } finally {
      await prisma.pricingCalculation.update({ where: { id }, data: { resultJson: original.resultJson } })
    }
  })

  it('fails closed if the published record loses its frozen FR-253 calculation lineage', async () => {
    const original = await prisma.pricingCalculation.findUnique({ where: { id: publicationFixture.calculationIdsByQuantity[100] } })
    await prisma.pricingCalculation.update({ where: { id: original.id }, data: { inputProvenance: 'USER_ENTERED' } })
    try {
      const result = await readPublishedExactPriceForLine({
        tenantId: product.tenantId, businessId: business.id, productId: product.id, quantity: 100, unit: product.unit,
      }, { db: prisma, knowledgeReader: reader })
      expect(result.state).toBe('UNAVAILABLE')
    } finally {
      await prisma.pricingCalculation.update({ where: { id: original.id }, data: { inputProvenance: original.inputProvenance } })
    }
  })

  it('fails closed when the published FR-253 rule set expires', async () => {
    const rule = await prisma.pricingRuleSet.findUnique({ where: { id: admission.ruleSetId } })
    await prisma.pricingRuleSet.update({ where: { id: rule.id }, data: { expiresAt: new Date('2000-01-01T00:00:00.000Z') } })
    try {
      const result = await readPublishedExactPriceForLine({
        tenantId: product.tenantId, businessId: business.id, productId: product.id, quantity: 100, unit: product.unit,
      }, { db: prisma, knowledgeReader: reader })
      expect(result.state).toBe('UNAVAILABLE')
    } finally {
      await prisma.pricingRuleSet.update({ where: { id: rule.id }, data: { expiresAt: rule.expiresAt } })
    }
  })

  it('fails closed after the owner withdraws the current receipt-backed price source', async () => {
    const published = await publicationFixture.publish()
    expect(published.status).toBe('PUBLISHED')
    const source = await prisma.knowledgeSource.findUnique({ where: { id: publicationFixture.sourceId } })
    expect(source).toMatchObject({ activeIngestionId: publicationFixture.ingestionId, revokedAt: null, deletedAt: null })

    const withdrawal = await withdrawKnowledgeSource(source.id, { expectedVersion: source.version }, {
      db: prisma, viewer: owner, env: publicationFixture.env,
    })
    expect(withdrawal.status).toBe('WITHDRAWN')
    expect(withdrawal.source).toMatchObject({ activeIngestionId: null, revokedAt: expect.any(Date), deletedAt: null })
    expect(await prisma.knowledgeIngestion.findUnique({ where: { id: publicationFixture.ingestionId } }))
      .toMatchObject({ status: 'WITHDRAWN', failureCode: 'KNOWLEDGE_SOURCE_WITHDRAWN' })

    const result = await readPublishedExactPriceForLine({
      tenantId: product.tenantId, businessId: business.id, productId: product.id, quantity: 100, unit: product.unit,
    }, { db: prisma, knowledgeReader: reader })
    expect(result.state).toBe('UNAVAILABLE')
  }, 60_000)
})

describe('readPublishedExactPriceForLine boundary', () => {
  const validRecord = {
    entityType: 'PriceListEntry', externalId: 'commerce-price:product-1:10',
    productExternalId: 'commerce-sku:product-1', qty: 10,
    srpUnitPriceThb: 12.34, srpSource: 'COMMERCE_APPROVED_COMPUTED',
  }
  const base = { tenantId: 'tenant-1', businessId: 'business-1', productId: 'product-1', quantity: 10, unit: 'piece' }
  const requestKey = 'b'.repeat(64)
  const rulesHash = 'd'.repeat(64)
  const input = {
    costBasis: 'landed', landedUnitCostThb: '1', quantity: 10, kind: 'single', profile: 'corporate', orderCostThb: '0',
    sourceRefs: [{ kind: 'INVENTORY_LEDGER', productId: 'product-1', receiptCount: 1, sha256: 'e'.repeat(64) }],
  }
  const calculation = {
    id: 'calculation-1', tenantId: 'tenant-1', businessId: 'business-1', ruleSetId: 'rule-1', ruleVersion: 1,
    rulesHash, evaluatorVersion: EVALUATOR_VERSION, inputHash: pricingHash(input), inputJson: JSON.stringify(input),
    resultJson: JSON.stringify({
      evaluatorVersion: EVALUATOR_VERSION, inputHash: pricingHash(input), ruleHash: rulesHash,
      quantity: 10, currency: 'THB', unitPriceSatang: 1234,
      catalogProjection: {
        fileName: 'commerce-price-product-1.json',
        baseUnit: 'piece',
        productRecord: { externalId: 'commerce-sku:product-1' },
        priceRecord: validRecord,
      },
    }),
    inputProvenance: 'INVENTORY_LEDGER', idempotencyKey: `catalog:${requestKey}:10`, requestHash: 'f'.repeat(64),
  }
  const asset = {
    id: 'asset-1', tenantId: 'tenant-1', businessId: 'business-1', projectId: null,
    code: `PCAT-${requestKey}`, sha256: 'c'.repeat(64), name: 'commerce-price-product-1.json',
    mime: 'application/json', storageKind: 'MANAGED_BLOB', status: 'ACTIVE', deletedAt: null,
  }
  const reader = { readPublishedCatalogRecord: async () => ({
    record: validRecord, publicationDigest: 'a'.repeat(64), observedFrom: '2026-10-23T00:00:00.000Z', observedTo: '2026-10-23T00:00:00.010Z',
    assetId: asset.id, assetCode: asset.code, assetSha256: asset.sha256,
  }) }
  const db = {
    product: { findFirst: async () => ({ id: 'product-1', tenantId: 'tenant-1', businessId: 'business-1', status: 'ACTIVE', unit: 'piece', itemKind: 'RAW_COMPONENT', dedicatedCustomerId: null, dedicatedSalesOrderId: null }) },
    fileAsset: { findUnique: async () => asset },
    pricingCalculation: {
      findFirst: async () => calculation,
      findMany: async () => [{ ruleSetId: 'rule-1', ruleVersion: 1, rulesHash, inputProvenance: 'INVENTORY_LEDGER' }],
    },
    pricingRuleSet: { findFirst: async () => ({ id: 'rule-1', version: 1, rulesHash, status: 'APPROVED', approvedAt: new Date('2026-01-01T00:00:00.000Z'), effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), expiresAt: null }) },
  }

  it('returns only an exact two-decimal published price with no source metadata', async () => {
    const result = await readPublishedExactPriceForLine(base, { db, knowledgeReader: reader })
    expect(result).toMatchObject({ state: 'PUBLISHED', unitAmountMinor: 1234, currency: 'THB', quantity: 10, unit: 'piece', taxTreatment: 'UNKNOWN' })
    expect(Object.keys(result).sort()).toEqual(['currency', 'observedFrom', 'observedTo', 'publicationDigest', 'quantity', 'state', 'taxTreatment', 'unit', 'unitAmountMinor'].sort())
  })

  it('refuses wrong quantity, wrong product identity, non-exact minor units and unit mismatch', async () => {
    for (const badRecord of [
      { ...validRecord, qty: 11 },
      { ...validRecord, productExternalId: 'commerce-sku:other' },
      { ...validRecord, srpUnitPriceThb: 12.341 },
    ]) {
      const result = await readPublishedExactPriceForLine(base, {
        db, knowledgeReader: { readPublishedCatalogRecord: async () => ({ ...await reader.readPublishedCatalogRecord(), record: badRecord }) },
      })
      expect(result.state).toBe('UNAVAILABLE')
    }
    const unitMismatch = await readPublishedExactPriceForLine({ ...base, unit: 'box' }, { db, knowledgeReader: reader })
    expect(unitMismatch.state).toBe('UNAVAILABLE')
  })

  it('preserves a published zero price as an exact value', async () => {
    const zeroRecord = { ...validRecord, srpUnitPriceThb: 0 }
    const zeroResult = JSON.parse(calculation.resultJson)
    zeroResult.unitPriceSatang = 0
    zeroResult.catalogProjection.priceRecord = zeroRecord
    const zeroDb = {
      ...db,
      pricingCalculation: {
        ...db.pricingCalculation,
        findFirst: async () => ({ ...calculation, resultJson: JSON.stringify(zeroResult) }),
      },
    }
    const zeroReader = {
      readPublishedCatalogRecord: async () => ({
        ...await reader.readPublishedCatalogRecord(),
        record: zeroRecord,
      }),
    }
    const result = await readPublishedExactPriceForLine(base, { db: zeroDb, knowledgeReader: zeroReader })
    expect(result).toMatchObject({ state: 'PUBLISHED', unitAmountMinor: 0, currency: 'THB' })
  })

  it('rejects legacy frozen calculations with no unit binding', async () => {
    const legacyResult = JSON.parse(calculation.resultJson)
    delete legacyResult.catalogProjection.baseUnit
    const legacyDb = {
      ...db,
      pricingCalculation: {
        ...db.pricingCalculation,
        findFirst: async () => ({ ...calculation, resultJson: JSON.stringify(legacyResult) }),
      },
    }
    const result = await readPublishedExactPriceForLine(base, { db: legacyDb, knowledgeReader: reader })
    expect(result.state).toBe('UNAVAILABLE')
  })

  it('rejects multiple current exact product and quantity publications as ambiguous', async () => {
    const entry = { title: 'PriceListEntry commerce-price:product-1:10', fileAssetId: 'asset-1' }
    const selected = uniquePublishedCatalogEntry([entry, { ...entry, sourceId: 'second-source', ingestionId: 'second-ingestion' }], 'commerce-price:product-1:10')
    expect(selected).toBeNull()
  })
})
