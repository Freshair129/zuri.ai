import { beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { makeViewer } from '../factories/viewer'
import { createBusiness, createPortfolio, createTenant, createWorkspace } from '../factories/scope'
import { createProject, createWorkstream } from '@/modules/project-manager/application/project-service'
import { createItem } from '@/modules/project-manager/application/work-service'
import {
  listMarketingContentReferences,
  readMarketingContentReferences,
  resolveMarketingContentAsset,
} from '@/modules/marketing/application/marketing-content-references'

// @req FR-157 — Content owner-reference reads preserve Files/PM ownership,
// immutable FileAsset snapshots and bounded, locator-free DTOs.
// @spec SDD-088, SEC-001, SEC-008
// @tested tests/integration/marketing-content-references.test.js

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

function ownerViewer(businessIds, principalId) {
  return makeViewer({
    role: 'OWNER',
    visibleBusinessIds: businessIds,
    ownedBusinessIds: businessIds,
    visibleDomains: ['growth'],
    domainsByBusinessId: Object.fromEntries(businessIds.map((id) => [id, ['growth']])),
    principal: { id: principalId, code: principalId, displayName: principalId },
  })
}

async function createAsset({ business, project, workItem, code, sha256 = HASH_A, status = 'ACTIVE' }) {
  return prisma.fileAsset.create({
    data: {
      code,
      tenantId: business.tenantId,
      businessId: business.id,
      projectId: project.id,
      workItemId: workItem.id,
      storageKind: 'MANAGED_BLOB',
      blobRef: `private-locator-${code}`,
      externalUrl: 'https://private.example.invalid/owner-only',
      name: `${code}.png`,
      mime: 'image/png',
      size: 12,
      sha256,
      status,
    },
  })
}

let fixture

beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8).toUpperCase()
  const portfolio = await createPortfolio({ code: `PF-CONT-${suffix}`, name: 'Content group' })
  const tenant = await createTenant({ portfolioId: portfolio.id, code: `TNT-CONT-${suffix}`, name: 'Content tenant' })
  const foreignTenant = await createTenant({ portfolioId: portfolio.id, code: `TNT-CONT-X-${suffix}`, name: 'Foreign content tenant' })
  const businessA = await createBusiness({ tenantId: tenant.id, code: `BUS-CONT-A-${suffix}`, name: 'Content business A' })
  const businessB = await createBusiness({ tenantId: tenant.id, code: `BUS-CONT-B-${suffix}`, name: 'Content business B' })
  const workspaceA = await createWorkspace({
    code: `WS-CONT-A-${suffix}`,
    name: 'Content workspace A',
    scopeType: 'BUSINESS',
    businessId: businessA.id,
  })
  const workspaceB = await createWorkspace({
    code: `WS-CONT-B-${suffix}`,
    name: 'Content workspace B',
    scopeType: 'BUSINESS',
    businessId: businessB.id,
  })
  const viewerA = ownerViewer([businessA.id], `content-owner-a-${suffix}`)
  const viewerB = ownerViewer([businessB.id], `content-owner-b-${suffix}`)
  const viewerBoth = ownerViewer([businessA.id, businessB.id], `content-owner-both-${suffix}`)
  const projectA = await createProject({
    workspaceId: workspaceA.id,
    businessId: businessA.id,
    code: `PRJ-CONT-A-${suffix}`,
    name: 'Content project A',
  }, { viewer: viewerA })
  const projectB = await createProject({
    workspaceId: workspaceB.id,
    businessId: businessB.id,
    code: `PRJ-CONT-B-${suffix}`,
    name: 'Content project B',
  }, { viewer: viewerB })
  const workstreamA = await createWorkstream({
    projectId: projectA.id,
    code: `WST-CONT-A-${suffix}`,
    name: 'Content production A',
    executionMode: 'B2C_CAMPAIGN',
  }, { viewer: viewerA })
  const workstreamB = await createWorkstream({
    projectId: projectB.id,
    code: `WST-CONT-B-${suffix}`,
    name: 'Content production B',
    executionMode: 'B2C_CAMPAIGN',
  }, { viewer: viewerB })
  const workItemA = await createItem({
    workstreamId: workstreamA.id,
    code: `WI-CONT-A-${suffix}`,
    subtype: 'CREATIVE',
    title: 'Produce content A',
    status: 'PLANNED',
    startAt: new Date('2026-09-10T00:00:00.000Z'),
    targetAt: new Date('2026-09-20T00:00:00.000Z'),
  }, { viewer: viewerA })
  const workItemB = await createItem({
    workstreamId: workstreamB.id,
    code: `WI-CONT-B-${suffix}`,
    subtype: 'CREATIVE',
    title: 'Produce content B',
    status: 'PLANNED',
  }, { viewer: viewerB })
  const assetA = await createAsset({
    business: businessA,
    project: projectA,
    workItem: workItemA,
    code: `FIL-CONT-A-${suffix}`,
  })
  const assetB = await createAsset({
    business: businessB,
    project: projectB,
    workItem: workItemB,
    code: `FIL-CONT-B-${suffix}`,
  })
  fixture = {
    businessA,
    businessB,
    foreignTenant,
    projectA,
    projectB,
    workItemA,
    workItemB,
    assetA,
    assetB,
    viewerA,
    viewerB,
    viewerBoth,
  }
})

function assetSnapshot(asset = fixture.assetA) {
  return { fileId: asset.id, fileVersion: asset.version, sha256: asset.sha256 }
}

function productionSnapshot(project = fixture.projectA, workItem = fixture.workItemA) {
  return { projectId: project.id, workItemId: workItem.id }
}

function serialized(result) {
  return JSON.stringify(result)
}

describe('Marketing Content owner-reference adapters (FR-157)', () => {
  it('lists bounded sanitized Files and PM choices without storage locators', async () => {
    const result = await listMarketingContentReferences({
      viewer: fixture.viewerA,
      businessId: fixture.businessA.id,
      projectId: fixture.projectA.id,
    }, { db: prisma })

    expect(result.truncated).toEqual({ files: false, projects: false, workItems: false })
    expect(result.files).toEqual([expect.objectContaining({
      id: fixture.assetA.id,
      version: fixture.assetA.version,
      sha256: HASH_A,
      state: 'ACTIVE',
      projectId: fixture.projectA.id,
      workItemId: fixture.workItemA.id,
    })])
    expect(result.projects).toEqual([expect.objectContaining({
      id: fixture.projectA.id,
      code: fixture.projectA.code,
      name: fixture.projectA.name,
    })])
    expect(result.workItems).toEqual([expect.objectContaining({
      id: fixture.workItemA.id,
      projectId: fixture.projectA.id,
      title: fixture.workItemA.title,
      startAt: '2026-09-10T00:00:00.000Z',
      targetAt: '2026-09-20T00:00:00.000Z',
    })])
    expect(serialized(result)).not.toContain('private-locator')
    expect(serialized(result)).not.toContain('private.example.invalid')
    expect(result.files[0]).not.toHaveProperty('storageKind')
    expect(result.files[0]).not.toHaveProperty('relativePath')
    expect(result.files[0]).not.toHaveProperty('externalUrl')
    expect(result.files[0]).not.toHaveProperty('blobRef')
  })

  it('reads an exact ACTIVE FileAsset snapshot and authorized PM pair', async () => {
    const result = await readMarketingContentReferences({
      viewer: fixture.viewerA,
      businessId: fixture.businessA.id,
      asset: assetSnapshot(),
      production: productionSnapshot(),
    }, { db: prisma })

    expect(result).toMatchObject({
      asset: { status: 'READY', reasonCode: null, file: { id: fixture.assetA.id, version: 1, sha256: HASH_A } },
      production: {
        status: 'READY',
        reasonCode: null,
        project: { id: fixture.projectA.id },
        workItem: { id: fixture.workItemA.id, projectId: fixture.projectA.id },
      },
    })
    expect(serialized(result)).not.toContain('private-locator')
  })

  it('returns explicit unavailable null objects for null references', async () => {
    const result = await readMarketingContentReferences({
      viewer: fixture.viewerA,
      businessId: fixture.businessA.id,
      asset: null,
      production: null,
    }, { db: prisma })

    expect(result).toEqual({
      asset: { status: 'UNAVAILABLE', reasonCode: 'ASSET_REFERENCE_EMPTY', file: null },
      production: { status: 'UNAVAILABLE', reasonCode: 'PRODUCTION_REFERENCE_EMPTY', project: null, workItem: null },
    })
  })

  it('rejects changed hash/version, deleted and quarantined Files without locators', async () => {
    const original = assetSnapshot()
    await prisma.fileAsset.update({
      where: { id: fixture.assetA.id },
      data: { sha256: HASH_B },
    })
    const changed = await readMarketingContentReferences({
      viewer: fixture.viewerA,
      businessId: fixture.businessA.id,
      asset: original,
    }, { db: prisma })
    expect(changed).toEqual({ asset: { status: 'UNAVAILABLE', reasonCode: 'ASSET_SNAPSHOT_MISMATCH', file: null }, production: expect.any(Object) })

    await prisma.fileAsset.update({ where: { id: fixture.assetA.id }, data: { version: 2 } })
    const versionChanged = await readMarketingContentReferences({
      viewer: fixture.viewerA,
      businessId: fixture.businessA.id,
      asset: { fileId: fixture.assetA.id, fileVersion: 1, sha256: HASH_B },
    }, { db: prisma })
    expect(versionChanged.asset).toEqual({ status: 'UNAVAILABLE', reasonCode: 'ASSET_SNAPSHOT_MISMATCH', file: null })

    const current = { fileId: fixture.assetA.id, fileVersion: 2, sha256: HASH_B }
    await prisma.fileAsset.update({ where: { id: fixture.assetA.id }, data: { status: 'QUARANTINED' } })
    const quarantined = await readMarketingContentReferences({
      viewer: fixture.viewerA,
      businessId: fixture.businessA.id,
      asset: current,
    }, { db: prisma })
    expect(quarantined.asset).toEqual({ status: 'UNAVAILABLE', reasonCode: 'ASSET_NOT_USABLE', file: null })

    await prisma.fileAsset.update({ where: { id: fixture.assetA.id }, data: { deletedAt: new Date() } })
    const deleted = await readMarketingContentReferences({
      viewer: fixture.viewerA,
      businessId: fixture.businessA.id,
      asset: current,
    }, { db: prisma })
    expect(deleted.asset).toEqual({ status: 'UNAVAILABLE', reasonCode: 'ASSET_REFERENCE_UNAVAILABLE', file: null })

    await prisma.fileAsset.update({
      where: { id: fixture.assetA.id },
      data: { deletedAt: null, status: 'ACTIVE', sha256: HASH_A, version: 1 },
    })
  })

  it('fails closed for cross-Business assets and hidden Businesses', async () => {
    const crossBusiness = await readMarketingContentReferences({
      viewer: fixture.viewerBoth,
      businessId: fixture.businessA.id,
      asset: assetSnapshot(fixture.assetB),
    }, { db: prisma })
    expect(crossBusiness.asset).toEqual({ status: 'UNAVAILABLE', reasonCode: 'ASSET_REFERENCE_UNAVAILABLE', file: null })
    expect(serialized(crossBusiness)).not.toContain(fixture.assetB.id)
    await expect(listMarketingContentReferences({
      viewer: fixture.viewerA,
      businessId: fixture.businessB.id,
    }, { db: prisma })).rejects.toMatchObject({ status: 404 })
  })

  it('fails closed when a FileAsset tenant binding is malformed', async () => {
    await prisma.fileAsset.update({ where: { id: fixture.assetA.id }, data: { tenantId: fixture.foreignTenant.id } })
    const result = await readMarketingContentReferences({
      viewer: fixture.viewerA,
      businessId: fixture.businessA.id,
      asset: assetSnapshot(),
    }, { db: prisma })
    expect(result.asset).toEqual({ status: 'UNAVAILABLE', reasonCode: 'ASSET_REFERENCE_UNAVAILABLE', file: null })
    expect(serialized(result)).not.toContain(fixture.assetA.id)
    await prisma.fileAsset.update({ where: { id: fixture.assetA.id }, data: { tenantId: fixture.businessA.tenantId } })
  })

  it('requires the selected Project and WorkItem to form one authorized PM pair', async () => {
    const mismatch = await readMarketingContentReferences({
      viewer: fixture.viewerBoth,
      businessId: fixture.businessA.id,
      production: productionSnapshot(fixture.projectA, fixture.workItemB),
    }, { db: prisma })
    expect(mismatch.production).toEqual({
      status: 'UNAVAILABLE',
      reasonCode: 'PRODUCTION_REFERENCE_UNAVAILABLE',
      project: null,
      workItem: null,
    })
    expect(serialized(mismatch)).not.toContain(fixture.workItemB.id)

    const denied = await readMarketingContentReferences({
      viewer: fixture.viewerA,
      businessId: fixture.businessA.id,
      production: productionSnapshot(fixture.projectB, fixture.workItemB),
    }, { db: prisma })
    expect(denied.production).toEqual({
      status: 'UNAVAILABLE',
      reasonCode: 'PRODUCTION_REFERENCE_UNAVAILABLE',
      project: null,
      workItem: null,
    })
    await expect(listMarketingContentReferences({
      viewer: fixture.viewerA,
      businessId: fixture.businessA.id,
      projectId: fixture.projectB.id,
    }, { db: prisma })).rejects.toMatchObject({ status: 404 })
  })

  it('resolves a fresh active FileAsset for a save without exposing locators', async () => {
    const resolved = await resolveMarketingContentAsset({
      viewer: fixture.viewerA,
      businessId: fixture.businessA.id,
      fileId: fixture.assetA.id,
    }, { db: prisma })
    expect(resolved).toEqual(expect.objectContaining({ id: fixture.assetA.id, version: 1, sha256: HASH_A }))
    expect(resolved).not.toHaveProperty('blobRef')
    await prisma.fileAsset.update({ where: { id: fixture.assetA.id }, data: { status: 'QUARANTINED' } })
    await expect(resolveMarketingContentAsset({
      viewer: fixture.viewerA,
      businessId: fixture.businessA.id,
      fileId: fixture.assetA.id,
    }, { db: prisma })).rejects.toMatchObject({ status: 409 })
    await prisma.fileAsset.update({ where: { id: fixture.assetA.id }, data: { status: 'ACTIVE' } })
  })
})
