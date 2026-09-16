// @req FR-194 — LegalEntity moves under Tenant; TaxRegistrationBranch is
// split out of Branch.taxBranchCode.
// @spec ADR-078 D1, D2; ADR-018 D4; BR-034
// @tested tests/integration/fr194-legal-entity-tax-branch.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createBranch, createLegalEntity, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { createOrder } from '@/modules/commerce/application/sales-order-service'
import { previewBillingDocument } from '@/modules/commerce/application/billing-invoice-service'
import * as scopeService from '@/modules/project-manager/application/scope-service'

const NOW = new Date('2026-09-12T03:00:00Z')
const DOMAINS = ['projects', 'platform', 'commerce']

let tenantA, tenantB, legalEntityA, businessA, warehouseBranch, headOfficeBranch, taxBranch, owner, order

describe('FR-194 LegalEntity is Tenant-scoped and TaxRegistrationBranch is split from Branch', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-FR194', name: 'Tax Branch Group' })
    tenantA = await createTenant({ portfolioId: portfolio.id, code: 'TNT-FR194-A', name: 'Tax Branch Tenant A' })
    tenantB = await createTenant({ portfolioId: portfolio.id, code: 'TNT-FR194-B', name: 'Tax Branch Tenant B' })
    legalEntityA = await createLegalEntity({
      tenantId: tenantA.id,
      code: 'LE-FR194-A',
      legalName: 'FR-194 Fixture Co., Ltd.',
      identifiers: [{ country: 'TH', type: 'TH_TAX_ID', value: '0105590000000' }],
    })
    businessA = await createBusiness({ tenantId: tenantA.id, code: 'BUS-FR194-A', name: 'Tax Branch Fixture' })
    await prisma.business.update({ where: { id: businessA.id }, data: { legalEntityId: legalEntityA.id } })
    await prisma.legalEntity.update({ where: { id: legalEntityA.id }, data: { legalAddress: '1 FR194 Road, Bangkok' } })
    await prisma.legalEntityIdentifier.updateMany({ where: { legalEntityId: legalEntityA.id }, data: { verifiedAt: new Date('2026-09-01T00:00:00Z') } })

    taxBranch = await prisma.taxRegistrationBranch.create({ data: { legalEntityId: legalEntityA.id, branchCode: '00000', name: 'Head Office', address: '1 FR194 Road, Bangkok' } })
    headOfficeBranch = await createBranch({ tenantId: tenantA.id, businessId: businessA.id, code: 'BR-FR194-HO', name: 'Head Office' })
    await prisma.branch.update({ where: { id: headOfficeBranch.id }, data: { address: '1 FR194 Road, Bangkok', taxRegistrationBranchId: taxBranch.id } })

    warehouseBranch = await createBranch({ tenantId: tenantA.id, businessId: businessA.id, code: 'BR-FR194-WH', name: 'Central Warehouse' })
    await prisma.branch.update({ where: { id: warehouseBranch.id }, data: { address: '2 FR194 Warehouse Road, Bangkok', kind: 'WAREHOUSE' } })

    owner = makeViewer({ visibleBusinessIds: [businessA.id], ownedBusinessIds: [businessA.id], visibleDomains: DOMAINS, principal: { id: 'per-fr194-owner', code: 'PER-FR194-OWNER', displayName: 'FR-194 Owner' } })
    await prisma.businessBillingProfile.create({
      data: {
        tenantId: tenantA.id, businessId: businessA.id, active: true,
        vatRegistered: true, vatRateBps: 700, vatTreatment: 'INCLUSIVE',
        taxPolicyVersion: 'TH-VAT-FR194-1', taxEffectiveAt: new Date('2026-01-01T00:00:00Z'), taxVerifiedAt: new Date('2026-01-02T00:00:00Z'),
        nonVatDocumentPolicy: 'ALLOW_INVOICE_RECEIPT', walkInDocumentPolicy: 'ALLOW_ANONYMOUS_RECEIPT',
      },
    })
    order = await createOrder({ businessId: businessA.id, lines: [{ description: 'FR-194 fixture item', qty: 1, unitPrice: 107 }] }, { viewer: owner, now: NOW })
  })

  const buyer = () => ({ source: 'ISSUANCE_INPUT', name: 'Buyer Co., Ltd.', taxId: '0105555555555', branchCode: '00000', address: '1 Buyer Road, Bangkok' })

  it('a Business cannot reference a LegalEntity in another Tenant', async () => {
    const legalEntityB = await createLegalEntity({ tenantId: tenantB.id, code: 'LE-FR194-B', legalName: 'Other Tenant Co., Ltd.' })
    const tenantAOwner = makeViewer({ role: 'OWNER', visibleBusinessIds: [], ownedBusinessIds: [], ownedTenantIds: [tenantA.id] })
    // Application-level ancestry guard (createBusiness) is what makes this
    // invariant real in SQLite dev/test, which has no compound-FK equivalent
    // to enforce the Postgres migration's composite FK against.
    await expect(
      scopeService.createBusiness({ tenantId: tenantA.id, code: 'BUS-FR194-CROSS', name: 'Cross-tenant attempt', legalEntityId: legalEntityB.id }, { viewer: tenantAOwner }),
    ).rejects.toMatchObject({ status: 422, message: 'LEGAL_ENTITY_TENANT_MISMATCH' })
    expect(await prisma.business.findUnique({ where: { code: 'BUS-FR194-CROSS' } })).toBeNull()
  })

  it('a warehouse Branch with no tax registration is a valid seller for INVOICE/RECEIPT', async () => {
    const preview = await previewBillingDocument(
      { orderId: order.id, branchId: warehouseBranch.id, documentType: 'RECEIPT', buyer: { source: 'ANONYMOUS_WALK_IN' } },
      { viewer: owner, now: NOW },
    )
    expect(preview.status).toBe('PREVIEW')
    expect(preview.snapshot.seller.branch).toMatchObject({ id: warehouseBranch.id, taxBranchCode: null })
  })

  it('the same warehouse Branch cannot produce a tax invoice — no tax registration branch', async () => {
    await expect(
      previewBillingDocument({ orderId: order.id, branchId: warehouseBranch.id, documentType: 'TAX_INVOICE', buyer: buyer() }, { viewer: owner, now: NOW }),
    ).rejects.toMatchObject({ status: 422, message: 'BILLING_TAX_BRANCH_NOT_CONFIGURED' })
  })

  it('the head office Branch, linked to its LegalEntity\'s own tax branch, issues a tax invoice', async () => {
    const preview = await previewBillingDocument(
      { orderId: order.id, branchId: headOfficeBranch.id, documentType: 'TAX_INVOICE', buyer: buyer() },
      { viewer: owner, now: NOW },
    )
    expect(preview.snapshot.seller.branch).toMatchObject({ id: headOfficeBranch.id, taxBranchCode: '00000' })
  })

  it('refuses a tax registration branch that belongs to a different LegalEntity than the Business', async () => {
    const otherLegalEntity = await createLegalEntity({ tenantId: tenantA.id, code: 'LE-FR194-OTHER', legalName: 'Different Entity Co., Ltd.' })
    const foreignTaxBranch = await prisma.taxRegistrationBranch.create({ data: { legalEntityId: otherLegalEntity.id, branchCode: '00001', name: 'Foreign branch', address: 'elsewhere' } })
    await prisma.branch.update({ where: { id: headOfficeBranch.id }, data: { taxRegistrationBranchId: foreignTaxBranch.id } })

    await expect(
      previewBillingDocument({ orderId: order.id, branchId: headOfficeBranch.id, documentType: 'TAX_INVOICE', buyer: buyer() }, { viewer: owner, now: NOW }),
    ).rejects.toMatchObject({ status: 422, message: 'BILLING_TAX_BRANCH_MISMATCH' })

    // restore for any test that runs after this one
    await prisma.branch.update({ where: { id: headOfficeBranch.id }, data: { taxRegistrationBranchId: taxBranch.id } })
  })
})
