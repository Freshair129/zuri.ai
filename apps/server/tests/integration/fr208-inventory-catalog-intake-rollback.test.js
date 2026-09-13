// @req FR-208 — all or nothing: when a catalogue writer refuses in the middle of
//   a commit, everything the batch already wrote in that transaction is rolled
//   back and the intake stays PREVIEWED. The identifier writer is made to refuse
//   one specific value, because the planner models every rule the real writers
//   enforce and so never lets a refusable action reach a commit on its own —
//   which is exactly why the rollback needs proving with a writer that does.
// @spec ADR-084 D2; BR-009
// @tested tests/integration/fr208-inventory-catalog-intake-rollback.test.js
import { beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer } from '../factories/viewer'

vi.mock('@/modules/inventory/application/inventory-identity-service', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    addIdentifier: async (productId, input, options) => {
      if (input?.value === 'CIT-RB-REFUSE') throw Object.assign(new Error('INVENTORY_IDENTIFIER_TAKEN'), { status: 409 })
      return original.addIdentifier(productId, input, options)
    },
  }
})

const { createCategory, createProductMaster } = await import('@/modules/inventory/application/inventory-catalog-service')
const { commitCatalogIntake, previewCatalogIntake } = await import('@/modules/inventory/application/catalog-intake-service')

const DOMAINS = ['projects', 'platform', 'inventory']
let business, owner

describe('FR-208 commit rollback', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-CIT-RB', name: 'Rollback' })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-CIT-RB', name: 'Rollback tenant' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-CIT-RB', name: 'Rollback business' })
    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: DOMAINS })
    const category = await createCategory({ businessId: business.id, code: 'CIT-RB-CAT', nameTh: 'หมวด', nameEn: 'Cat' }, { viewer: owner })
    await createProductMaster({ businessId: business.id, code: 'CIT-RB-PM', categoryId: category.id, nameTh: 'หลัก', nameEn: 'Master' }, { viewer: owner })
  })

  it('AC-208.7 — a refusal on the second item removes the master, SKU and identifier the first item wrote', async () => {
    const { intake } = await previewCatalogIntake({
      schemaVersion: '1.0', businessId: business.id, source: { channel: 'REST_API', correlationId: 'rollback-1' },
      items: [
        { sku: { code: 'CIT-RB-OK', name: 'Written then undone' }, master: { code: 'CIT-RB-NEWPM', categoryCode: 'CIT-RB-CAT', nameTh: 'ใหม่', nameEn: 'New' }, identifiers: [{ kind: 'BARCODE', value: 'CIT-RB-FINE' }] },
        { sku: { code: 'CIT-RB-BAD', name: 'Refused' }, master: { code: 'CIT-RB-PM' }, identifiers: [{ kind: 'BARCODE', value: 'CIT-RB-REFUSE' }] },
      ],
    }, { viewer: owner })
    expect(intake.committable).toBe(true)

    await expect(commitCatalogIntake({ businessId: business.id, intakeId: intake.id, planHash: intake.planHash }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'INVENTORY_IDENTIFIER_TAKEN' })

    expect(await prisma.product.count({ where: { businessId: business.id, code: { in: ['CIT-RB-OK', 'CIT-RB-BAD'] } } })).toBe(0)
    expect(await prisma.productMaster.count({ where: { businessId: business.id, code: 'CIT-RB-NEWPM' } })).toBe(0)
    expect(await prisma.productIdentifier.count({ where: { businessId: business.id, value: 'CIT-RB-FINE' } })).toBe(0)
    expect(await prisma.auditEvent.count({ where: { action: 'PRODUCT_CREATED', payloadJson: { contains: 'CIT-RB-OK' } } })).toBe(0)
    const row = await prisma.inventoryCatalogIntake.findUnique({ where: { id: intake.id } })
    expect(row).toMatchObject({ status: 'PREVIEWED', committedAt: null, resultJson: null })
  })
})
