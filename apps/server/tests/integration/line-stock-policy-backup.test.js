// @req FR-291 — restoring portable business data must not replay stock disclosure authority.
// @spec ADR-018, SEC-001
// @tested tests/integration/line-stock-policy-backup.test.js
import { describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer, makeOperatorViewer } from '../factories/viewer'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { createCategory, createProduct, createProductMaster } from '@/modules/inventory/application/inventory-catalog-service'
import { setLineStockDisclosurePolicy } from '@/modules/inventory/application/line-stock-disclosure-policy-service'
import { exportSnapshot, importSnapshot, SNAPSHOT_EXCLUDED_MODELS } from '@/modules/project-manager/application/backup-service'

describe('LINE stock disclosure recovery', () => {
  it('classifies disclosure authority and clears a real enabled grant on portable restore', async () => {
    expect(SNAPSHOT_EXCLUDED_MODELS.lineStockDisclosurePolicy).toMatch(/authority|disclosure/i)
    const suffix = Date.now()
    const portfolio = await createPortfolio({ code: 'PF-LSB-' + suffix, name: 'Stock recovery' })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-LSB-' + suffix, name: 'Stock recovery' })
    const business = await createBusiness({ tenantId: tenant.id, code: 'BUS-LSB-' + suffix, name: 'Stock recovery' })
    const owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: ['inventory'] })
    const provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
    const connection = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id, providerId: provider.id,
      name: 'Stock recovery', externalAccountId: 'line-lsb-' + suffix, status: 'ACTIVE' })
    const account = await prisma.lineOaAccount.create({ data: { tenantId: tenant.id, businessId: business.id,
      integrationConnectionId: connection.id, code: 'LSB-' + suffix, bindingCode: 'LSB-' + suffix,
      displayName: 'Stock recovery', status: 'CONNECTED', serverEnabled: true, transportMode: 'CLOUD' } })
    const category = await createCategory({ businessId: business.id, code: 'stock-recovery', nameTh: 'สินค้า', nameEn: 'Products' }, { viewer: owner })
    const master = await createProductMaster({ businessId: business.id, code: 'LSB-M-' + suffix,
      categoryId: category.id, nameTh: 'สินค้า', nameEn: 'Products' }, { viewer: owner })
    const product = await createProduct({ businessId: business.id, productMasterId: master.id,
      code: 'LSB-P-' + suffix, unit: 'piece' }, { viewer: owner })
    const policy = await setLineStockDisclosurePolicy({ businessId: business.id, lineOaAccountId: account.id,
      productId: product.id, enabled: true, expectedVersion: 0, reason: 'Owner allows test stock disclosure' }, { viewer: owner })
    expect(policy.enabled).toBe(true)
    expect(await prisma.lineStockDisclosurePolicy.count()).toBe(1)
    const snapshot = await exportSnapshot()
    expect(snapshot.tables).not.toHaveProperty('lineStockDisclosurePolicy')
    const restored = await importSnapshot(snapshot, { confirm: true, viewer: makeOperatorViewer() })
    expect(restored).toMatchObject({ restored: true })
    expect(await prisma.lineStockDisclosurePolicy.count()).toBe(0)
    expect(await prisma.lineOaAccount.findUnique({ where: { id: account.id } })).toMatchObject({ serverEnabled: false })
  })
})
