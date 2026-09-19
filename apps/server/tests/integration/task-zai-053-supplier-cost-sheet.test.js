import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { createCategory, createProduct, createProductMaster, getProduct } from '@/modules/inventory/application/inventory-catalog-service'
import { catalogHygiene } from '@/modules/inventory/application/inventory-hygiene-service'
import { commitSupplierCostSheet, previewSupplierCostSheet } from '@/modules/procurement/application/supplier-cost-sheet-service'
import { createSupplier } from '@/modules/procurement/application/supplier-service'
import { ROLE_PROCUREMENT_BUYER } from '@/modules/identity/rbac'

// @spec ZAI:PROPOSAL-SMARTGIFT-COST-QUOTE-ENGINE-20260913; TASK-ZAI-053 —
//   preview/commit is idempotent on source hash, refuses unconfirmed mappings,
//   records lines only at commit, updates carton attributes through Inventory,
//   and exposes locked-FX price breaks plus CARTON_DATA_MISSING hygiene.
// @tested tests/integration/task-zai-053-supplier-cost-sheet.test.js

const DOMAINS = ['projects', 'platform', 'procurement', 'inventory']
const HASH = 'a'.repeat(64)
let business
let supplier
let product
let missingCartonProduct
let owner
let buyer

describe('TASK-ZAI-053 supplier cost sheets', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'Cost Group', code: 'PF-COST-053' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'Cost Tenant', code: 'TNT-COST-053' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Cost Business', code: 'BUS-COST-053' })
    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: DOMAINS, principal: { id: 'per-cost-owner', code: 'PER-COST-OWNER', displayName: 'Cost Owner' } })
    buyer = makeViewer({ visibleBusinessIds: [business.id], visibleDomains: DOMAINS, rolesByBusinessId: { [business.id]: [ROLE_PROCUREMENT_BUYER] }, principal: { id: 'per-cost-buyer', code: 'PER-COST-BUYER', displayName: 'Cost Buyer' } })

    supplier = await createSupplier({ businessId: business.id, code: 'SUP-COST-053', name: 'Factory Cost Supplier' }, { viewer: owner })
    const category = await createCategory({ businessId: business.id, code: 'COST-CAT-053', nameTh: 'ของใช้', nameEn: 'Goods' }, { viewer: owner })
    const master = await createProductMaster({ businessId: business.id, code: 'PM-COST-053', categoryId: category.id, nameTh: 'กล่อง', nameEn: 'Box' }, { viewer: owner })
    product = await createProduct({ businessId: business.id, code: 'SG-BOX-053', productMasterId: master.id, name: 'Gift box' }, { viewer: owner })
    missingCartonProduct = await createProduct({ businessId: business.id, code: 'SG-MISSING-053', productMasterId: master.id, name: 'Missing carton data' }, { viewer: owner })
  })

  const envelope = () => ({
    businessId: business.id,
    supplierId: supplier.id,
    currency: 'USD',
    fxRateLocked: 34,
    sourceRef: 'factory-costs.json',
    sourceSha256: HASH,
    lines: [
      { sku: product.code, minQty: 1, unitCostForeign: 1.25, unitsPerCarton: 24, cartonCbm: 0.018, cartonKg: 4.2, freightGoodsType: 'GENERAL', leadTimeDays: 14 },
      { sku: product.code, minQty: 100, unitCostForeign: 1.1, unitsPerCarton: 24, cartonCbm: 0.018, cartonKg: 4.2, freightGoodsType: 'GENERAL', leadTimeDays: 14 },
    ],
  })

  it('previews without lines, requires person-confirmed mapping, and replays by source hash', async () => {
    const preview = await previewSupplierCostSheet(envelope(), { viewer: owner })
    expect(preview.replayed).toBe(false)
    expect(preview.sheet).toMatchObject({ businessId: business.id, supplierId: supplier.id, currency: 'USD', fxRateLocked: 34, sourceSha256: HASH, status: 'DRAFT', lineCount: 2, version: 1 })
    expect(preview.sheet.preview.lines[0].mapping).toMatchObject({ productId: product.id, confidence: 'EXACT_PRODUCT_CODE' })
    expect(await prisma.supplierCostLine.count({ where: { sheetId: preview.sheet.id } })).toBe(0)

    await expect(commitSupplierCostSheet({ businessId: business.id, sheetId: preview.sheet.id, previewHash: preview.sheet.preview.hash }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'PROCUREMENT_COST_SHEET_MAPPING_UNCONFIRMED' })
    expect(await prisma.supplierCostLine.count({ where: { sheetId: preview.sheet.id } })).toBe(0)

    const replay = await previewSupplierCostSheet(envelope(), { viewer: owner })
    expect(replay).toMatchObject({ replayed: true, sheet: { id: preview.sheet.id, preview: { hash: preview.sheet.preview.hash } } })
  })

  it('keeps Procurement buyer and Inventory writer authorities separate, then commits the confirmed version atomically', async () => {
    const preview = await previewSupplierCostSheet(envelope(), { viewer: owner })
    const mappings = [{ sourceSku: product.code, productId: product.id, confirmed: true }]

    await expect(commitSupplierCostSheet({ businessId: business.id, sheetId: preview.sheet.id, previewHash: preview.sheet.preview.hash, mappings }, { viewer: buyer })).rejects.toMatchObject({ status: 404 })
    expect(await prisma.supplierCostLine.count({ where: { sheetId: preview.sheet.id } })).toBe(0)

    const committed = await commitSupplierCostSheet({
      businessId: business.id,
      sheetId: preview.sheet.id,
      previewHash: preview.sheet.preview.hash,
      mappings,
    }, { viewer: owner })
    expect(committed).toMatchObject({ replayed: false, sheet: { status: 'CONFIRMED', version: 2, lineCount: 2 } })
    expect(committed.sheet.lines).toHaveLength(2)
    expect(committed.sheet.lines.map((line) => line.unitCostBaht)).toEqual([42.5, 37.4])
    expect(await prisma.supplierCostLine.count({ where: { sheetId: preview.sheet.id } })).toBe(2)

    const productPage = await getProduct(product.id, { viewer: owner })
    expect(productPage).toMatchObject({
      unitsPerCarton: 24,
      cartonCbm: 0.018,
      cartonKg: 4.2,
      freightGoodsType: 'GENERAL',
      costing: { supplierCostPriceBreaks: expect.arrayContaining([expect.objectContaining({ minQty: 1, unitCostBaht: 42.5, fxRateLocked: 34, currency: 'USD' })]) },
    })
    expect(productPage.supplierCostPriceBreaks).toHaveLength(2)

    const replay = await commitSupplierCostSheet({ businessId: business.id, sheetId: preview.sheet.id, previewHash: preview.sheet.preview.hash, mappings }, { viewer: owner })
    expect(replay).toMatchObject({ replayed: true, sheet: { status: 'CONFIRMED', version: 2 } })

    const report = await catalogHygiene({ businessId: business.id, viewer: owner })
    const cartonFinding = report.findings.find((finding) => finding.kind === 'CARTON_DATA_MISSING')
    expect(cartonFinding).toMatchObject({ codes: [missingCartonProduct.code], missingFields: ['unitsPerCarton', 'cartonCbm', 'cartonKg'] })
    expect(report.findings.filter((finding) => finding.kind === 'CARTON_DATA_MISSING').flatMap((finding) => finding.codes)).not.toContain(product.code)
  })

  it('refuses a changed payload under a reused file hash', async () => {
    const changed = envelope()
    changed.lines[0].unitCostForeign = 1.3
    await expect(previewSupplierCostSheet(changed, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'PROCUREMENT_COST_SHEET_SOURCE_HASH_REUSED' })
  })
})
