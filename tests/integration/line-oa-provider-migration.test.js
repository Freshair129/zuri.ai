import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import {
  LINE_REGISTRY_TYPES,
  LEGACY_LINE_OA_PROVIDER_CODE,
  listLineRegistry,
} from '@/modules/integration/application/line-registry-service'
import { LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import {
  planLineOaProviderMerge,
  applyLineOaProviderMerge,
  main as migrateLineOaProviderMain,
} from '../../scripts/migrate-line-oa-provider.mjs'

// @req FR-080 — the data migration that retires the legacy lowercase `line-oa`
// IntegrationProvider identity, closing the wave-1 open item
// line-registry-service.js's read-tolerance comment names.
// @spec BR-002, SEC-016
//
// Against the real database: a legacy connection with no canonical
// counterpart must be re-pointed to LINE_OA, a legacy connection that DOES
// collide with an existing canonical row (same tenantId + externalAccountId)
// must be disabled and tagged rather than merged into a duplicate, a
// same-externalAccountId row in a DIFFERENT tenant must never be treated as a
// collision, the legacy provider row must survive exactly as long as a
// disabled duplicate still references it, and listLineRegistry must keep
// listing every one of these rows before and after.

let tenantA, tenantB, businessA, businessB
let viewerA, viewerB
let legacyProvider

const NO_COLLIDE_ID = 'Cno-collide-group'
const COLLIDE_ID = 'Ccollide-group'

describe('LINE_OA provider merge migration (FR-080)', () => {
  beforeAll(async () => {
    const pf = await createPortfolio({ name: 'LINE OA Merge Group', code: 'PF-LINEOAMERGE' })
    tenantA = await createTenant({ portfolioId: pf.id, name: 'Merge Tenant A', code: 'TNT-LINEOAMERGE-A' })
    tenantB = await createTenant({ portfolioId: pf.id, name: 'Merge Tenant B', code: 'TNT-LINEOAMERGE-B' })
    businessA = await createBusiness({ tenantId: tenantA.id, name: 'Merge Business A', code: 'BUS-LINEOAMERGE-A' })
    businessB = await createBusiness({ tenantId: tenantB.id, name: 'Merge Business B', code: 'BUS-LINEOAMERGE-B' })

    viewerA = makeViewer({
      visibleBusinessIds: [businessA.id],
      ownedBusinessIds: [businessA.id],
      principal: { id: 'per-lineoamerge-a', code: 'PER-LINEOAMERGE-A', displayName: 'Merge Owner A' },
    })
    viewerB = makeViewer({
      visibleBusinessIds: [businessB.id],
      ownedBusinessIds: [businessB.id],
      principal: { id: 'per-lineoamerge-b', code: 'PER-LINEOAMERGE-B', displayName: 'Merge Owner B' },
    })

    legacyProvider = await prisma.integrationProvider.upsert({
      where: { code: LEGACY_LINE_OA_PROVIDER_CODE },
      create: { code: LEGACY_LINE_OA_PROVIDER_CODE, name: 'LINE Official Account (legacy)', status: 'ACTIVE' },
      update: {},
    })
    const canonicalProvider = await prisma.integrationProvider.upsert({
      where: { code: LINE_OA_PROVIDER_CODE },
      create: { code: LINE_OA_PROVIDER_CODE, name: 'LINE Official Account', status: 'ACTIVE' },
      update: {},
    })

    // The canonical row COLLIDE_ID already collides with under tenantA — this
    // is the "already re-created under the new code" case the merge must not
    // duplicate.
    await prisma.integrationConnection.create({
      data: {
        tenantId: tenantA.id,
        businessId: businessA.id,
        providerId: canonicalProvider.id,
        name: 'Already-canonical group',
        externalAccountId: COLLIDE_ID,
        purpose: LINE_REGISTRY_TYPES.GROUP,
        role: 'SECONDARY',
        status: 'ACTIVE',
        metadataJson: JSON.stringify({ groupName: 'Already-canonical group' }),
      },
    })

    // Legacy, tenantA, collides with the canonical row above → must be disabled.
    await prisma.integrationConnection.create({
      data: {
        tenantId: tenantA.id,
        businessId: businessA.id,
        providerId: legacyProvider.id,
        name: 'Legacy colliding group',
        externalAccountId: COLLIDE_ID,
        purpose: LINE_REGISTRY_TYPES.GROUP,
        role: 'SECONDARY',
        status: 'ACTIVE',
        metadataJson: JSON.stringify({ groupName: 'Legacy colliding group', departmentType: 'SALES_TEAM' }),
      },
    })

    // Legacy, tenantA, no canonical counterpart → must be re-pointed.
    await prisma.integrationConnection.create({
      data: {
        tenantId: tenantA.id,
        businessId: businessA.id,
        providerId: legacyProvider.id,
        name: 'Legacy free-standing group',
        externalAccountId: NO_COLLIDE_ID,
        purpose: LINE_REGISTRY_TYPES.GROUP,
        role: 'SECONDARY',
        status: 'ACTIVE',
        metadataJson: JSON.stringify({ groupName: 'Legacy free-standing group' }),
      },
    })

    // Legacy, tenantB, SAME externalAccountId string as the tenantA collision
    // but a different tenant and no canonical row of its own → must NOT be
    // treated as a collision; tenant scoping must hold.
    await prisma.integrationConnection.create({
      data: {
        tenantId: tenantB.id,
        businessId: businessB.id,
        providerId: legacyProvider.id,
        name: 'Legacy other-tenant group',
        externalAccountId: COLLIDE_ID,
        purpose: LINE_REGISTRY_TYPES.GROUP,
        role: 'SECONDARY',
        status: 'ACTIVE',
        metadataJson: JSON.stringify({ groupName: 'Legacy other-tenant group' }),
      },
    })
  })

  it('the script\'s copied provider-code constants match the canonical ones (it cannot import them directly — see the script\'s own comment)', async () => {
    const mod = await import('../../scripts/migrate-line-oa-provider.mjs')
    const source = await import('node:fs/promises').then((fs) => fs.readFile(
      new URL('../../scripts/migrate-line-oa-provider.mjs', import.meta.url),
      'utf8',
    ))
    expect(source).toContain(`const LINE_OA_PROVIDER_CODE = '${LINE_OA_PROVIDER_CODE}'`)
    expect(source).toContain(`const LEGACY_LINE_OA_PROVIDER_CODE = '${LEGACY_LINE_OA_PROVIDER_CODE}'`)
    expect(mod.MERGE_REASON).toBe('LINE_OA_PROVIDER_MERGE')
  })

  it('dry run reports the plan without writing anything', async () => {
    // Scoped to this file's tenants: the per-run database is shared with the
    // LINE registry suites, which seed legacy rows of their own.
    const plan = await planLineOaProviderMerge(prisma, { tenantIds: [tenantA.id, tenantB.id] })
    expect(plan.legacyProviderExists).toBe(true)
    expect(plan.repoint.map((c) => c.externalAccountId).sort()).toEqual([COLLIDE_ID, NO_COLLIDE_ID].sort())
    expect(plan.disable).toHaveLength(1)
    expect(plan.disable[0].connection.externalAccountId).toBe(COLLIDE_ID)
    expect(plan.disable[0].connection.tenantId).toBe(tenantA.id)
    expect(plan.unresolved).toHaveLength(0)

    // Untouched by a dry run.
    const stillLegacy = await prisma.integrationConnection.count({
      where: { providerId: legacyProvider.id, tenantId: { in: [tenantA.id, tenantB.id] } },
    })
    expect(stillLegacy).toBe(3)
  })

  it('the CLI dry run prints the summary and exits zero', async () => {
    const log = []
    const summary = await migrateLineOaProviderMain(
      ['--tenant', tenantA.id, '--tenant', tenantB.id],
      { db: prisma, log: (line) => log.push(line) },
    )
    expect(summary.mode).toBe('DRY_RUN')
    expect(summary.tenantScope).toEqual([tenantA.id, tenantB.id])
    expect(summary.wouldDisable).toBe(1)
    expect(summary.wouldRepoint).toBe(2)
    expect(summary.unresolvedCollisions).toBe(0)
    expect(log).toHaveLength(1)
  })

  it('applies the merge: re-points the free-standing rows, disables and tags the collision, keeps tenant scoping, and leaves the legacy provider because a duplicate still references it', async () => {
    const result = await applyLineOaProviderMerge(prisma, { tenantIds: [tenantA.id, tenantB.id] })
    expect(result.applied).toBe(true)
    expect(result.repointedCount).toBe(2)
    expect(result.disabledCount).toBe(1)
    expect(result.legacyProviderDeleted).toBe(false)

    const canonicalProvider = await prisma.integrationProvider.findUnique({ where: { code: LINE_OA_PROVIDER_CODE } })
    expect(canonicalProvider).toBeTruthy()

    const repointedA = await prisma.integrationConnection.findFirst({
      where: { tenantId: tenantA.id, externalAccountId: NO_COLLIDE_ID },
    })
    expect(repointedA.providerId).toBe(canonicalProvider.id)
    expect(repointedA.status).toBe('ACTIVE')

    const repointedB = await prisma.integrationConnection.findFirst({
      where: { tenantId: tenantB.id, externalAccountId: COLLIDE_ID },
    })
    expect(repointedB.providerId).toBe(canonicalProvider.id)

    const disabled = await prisma.integrationConnection.findFirst({
      where: { tenantId: tenantA.id, providerId: legacyProvider.id, externalAccountId: COLLIDE_ID },
    })
    expect(disabled).toBeTruthy()
    expect(disabled.status).toBe('DISABLED')
    const meta = JSON.parse(disabled.metadataJson)
    expect(meta.reason).toBe('LINE_OA_PROVIDER_MERGE')
    expect(meta.groupName).toBe('Legacy colliding group') // prior metadata preserved
    expect(meta.departmentType).toBe('SALES_TEAM')
    const canonicalCollisionRow = await prisma.integrationConnection.findFirst({
      where: { tenantId: tenantA.id, providerId: canonicalProvider.id, externalAccountId: COLLIDE_ID },
    })
    expect(meta.mergedInto).toBe(canonicalCollisionRow.id)

    // The legacy provider row is kept — the disabled duplicate above still
    // references it.
    const stillLegacyProvider = await prisma.integrationProvider.findUnique({ where: { code: LEGACY_LINE_OA_PROVIDER_CODE } })
    expect(stillLegacyProvider).toBeTruthy()
    const remainingLegacyRefs = await prisma.integrationConnection.count({ where: { providerId: legacyProvider.id } })
    expect(remainingLegacyRefs).toBe(1)
  })

  it('is idempotent: applying again changes nothing further', async () => {
    const plan = await planLineOaProviderMerge(prisma, { tenantIds: [tenantA.id, tenantB.id] })
    expect(plan.repoint).toHaveLength(0)
    expect(plan.disable).toHaveLength(0)
    expect(plan.unresolved).toHaveLength(0)

    const result = await applyLineOaProviderMerge(prisma)
    expect(result.repointedCount).toBe(0)
    expect(result.disabledCount).toBe(0)
    expect(result.legacyProviderDeleted).toBe(false)

    const remainingLegacyRefs = await prisma.integrationConnection.count({ where: { providerId: legacyProvider.id } })
    expect(remainingLegacyRefs).toBe(1)
  })

  it('listLineRegistry still lists every row afterwards — the re-pointed, the disabled duplicate, and the untouched other-tenant row, each to its own owner', async () => {
    const rowsA = await listLineRegistry({ businessId: businessA.id, resolve: async () => viewerA })
    const externalIdsA = rowsA.map((row) => row.externalAccountId)
    expect(externalIdsA).toEqual(expect.arrayContaining([NO_COLLIDE_ID, COLLIDE_ID]))
    // Both the canonical COLLIDE_ID row and the disabled legacy duplicate
    // under the same id must still be visible.
    expect(externalIdsA.filter((id) => id === COLLIDE_ID)).toHaveLength(2)

    const rowsB = await listLineRegistry({ businessId: businessB.id, resolve: async () => viewerB })
    expect(rowsB.map((row) => row.externalAccountId)).toContain(COLLIDE_ID)
    expect(rowsB).toHaveLength(1)
  })
})
