// @req FR-135 — disposal evidence remains available through the immutable audit log.
// @spec SDD-080, BR-023, SEC-023, ADR-055
// @tested tests/integration/asset-disposal-audit.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import {
  finalizeAssetDisposal,
  listAssetDisposalLogs,
} from '@/modules/asset-management/application/asset-disposal-service'

let business
let owner

describe('Asset disposal audit persistence', () => {
  beforeAll(async () => {
    const suffix = String(Date.now())
    const portfolio = await createPortfolio({ code: `PF-DISP-AUDIT-${suffix}`, name: `Disposal Audit Group ${suffix}` })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: `TNT-DISP-AUDIT-${suffix}`, name: `Disposal Audit Tenant ${suffix}` })
    business = await createBusiness({ tenantId: tenant.id, code: `BUS-DISP-AUDIT-${suffix}`, name: `Disposal Audit Business ${suffix}` })
    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: ['assets'] })
  })

  it('persists disposal details and returns them through the disposal log reader', async () => {
    const suffix = String(Date.now())
    const asset = await prisma.registeredAsset.create({
      data: {
        tenantId: business.tenantId,
        businessId: business.id,
        assetCode: `AST-DISP-AUDIT-${suffix}`,
        name: 'Disposal audit fixture',
        categoryCode: 'IT_EQUIPMENT',
      },
    })

    const expected = {
      method: 'DONATE',
      reason: 'Replaced equipment donated to training center',
      buyerOrRecipient: 'Community Training Center',
      documentRef: `DONATION-${suffix}`,
      evidenceFileAssetId: `evidence-${suffix}`,
    }
    await finalizeAssetDisposal({
      businessId: business.id,
      registeredAssetId: asset.id,
      ...expected,
      viewer: owner,
    })

    const event = await prisma.auditEvent.findFirst({
      where: { entityType: 'REGISTERED_ASSET', entityId: asset.id, action: 'ASSET_DISPOSED' },
    })
    expect(event).not.toBeNull()
    expect(JSON.parse(event.payloadJson)).toMatchObject({
      registeredAssetId: asset.id,
      assetCode: asset.assetCode,
      ...expected,
    })

    const logs = await listAssetDisposalLogs({ businessId: business.id, registeredAssetId: asset.id })
    expect(logs[0]).toMatchObject({
      registeredAssetId: asset.id,
      ...expected,
    })
  })
})
