// @req FR-133, FR-135 — scanner lookup reads evidence through canonical FileAsset fields and keeps Business scope.
// @spec SDD-078, SDD-080, BR-023, SEC-023, ADR-055
// @tested tests/unit/asset-lookup-schema-integration.test.js
import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { lookupAssetByQrOrCode } from '@/modules/asset-management/application/asset-lookup-service'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'

const unique = (prefix) => `${prefix}-${randomUUID()}`

describe('asset lookup against the Prisma FileAsset schema', () => {
  let business
  let asset
  let foreignAsset
  let evidence
  let file
  let missingToken

  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: unique('PF-SCANNER'), name: 'Scanner lookup fixture' })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: unique('T-SCANNER'), name: 'Scanner lookup fixture' })
    business = await createBusiness({ tenantId: tenant.id, code: unique('B-SCANNER'), name: 'Scanner lookup fixture' })
    const foreignBusiness = await createBusiness({ tenantId: tenant.id, code: unique('B-SCANNER-FOREIGN'), name: 'Foreign scanner fixture' })

    missingToken = unique('UNKNOWN-ASSET')
    file = await prisma.fileAsset.create({
      data: {
        code: unique('FIL-SCANNER'),
        tenantId: tenant.id,
        businessId: business.id,
        storageKind: 'MANAGED_BLOB',
        blobRef: unique('scanner-fixture'),
        name: 'scanner-evidence.jpg',
        mime: 'image/jpeg',
        size: 2048,
        status: 'ACTIVE',
      },
    })
    const intake = await prisma.assetIntake.create({
      data: {
        tenantId: tenant.id,
        businessId: business.id,
        intakeCode: unique('INT-SCANNER'),
        schemaVersion: '1.0',
        sourceChannel: 'WEB',
        sourceCorrelationId: unique('scanner-correlation'),
        origin: 'MANUAL',
      },
    })
    asset = await prisma.registeredAsset.create({
      data: {
        tenantId: tenant.id,
        businessId: business.id,
        assetCode: 'AST-2026-12345',
        name: 'Scanner fixture asset',
        categoryCode: 'IT_EQUIPMENT',
      },
    })
    evidence = await prisma.assetEvidence.create({
      data: {
        tenantId: tenant.id,
        businessId: business.id,
        intakeId: intake.id,
        registeredAssetId: asset.id,
        fileAssetId: file.id,
        role: 'ASSET_PHOTO',
      },
    })
    foreignAsset = await prisma.registeredAsset.create({
      data: {
        tenantId: tenant.id,
        businessId: foreignBusiness.id,
        assetCode: 'AST-2026-54321',
        name: 'Foreign Business asset',
        categoryCode: 'IT_EQUIPMENT',
      },
    })
  })

  it('returns a scoped 404 for unknown and foreign identifiers and canonical evidence metadata for a match', async () => {
    await expect(lookupAssetByQrOrCode({
      businessId: business.id,
      codeOrToken: missingToken,
      db: prisma,
    })).rejects.toMatchObject({
      status: 404,
      message: `Asset not found for identifier: ${missingToken}`,
    })

    const result = await lookupAssetByQrOrCode({
      businessId: business.id,
      codeOrToken: asset.assetCode,
      db: prisma,
    })
    expect(result).toMatchObject({
      id: asset.id,
      photoEvidence: {
        id: evidence.id,
        fileAssetId: file.id,
        fileName: file.name,
        mimeType: file.mime,
        sizeBytes: file.size,
      },
    })

    await expect(lookupAssetByQrOrCode({
      businessId: business.id,
      codeOrToken: foreignAsset.id,
      db: prisma,
    })).rejects.toMatchObject({ status: 404 })
  })
})
