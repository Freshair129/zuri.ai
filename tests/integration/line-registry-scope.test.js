import { describe, it, expect, beforeAll, vi } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import {
  LINE_REGISTRY_TYPES,
  listLineRegistry,
  saveLineGroup,
  saveLineUser,
} from '@/modules/integration/application/line-registry-service'
import { listPhase1Integrations } from '@/modules/integration/application/integration-management-service'
import { LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { GET } from '@/app/api/platform/integrations/line-registry/route'

// The retired legacy provider code. line-registry-service.js no longer
// exports this — the read tolerance it named is gone — so rows written under
// it are seeded here directly, against the database, as data the service must
// now ignore rather than as a constant the service still recognises.
const RETIRED_LINE_OA_PROVIDER_CODE = 'line-oa'

// @req FR-080 — the Platform LINE Registry, against the real database.
// @spec SEC-001, SEC-003, SEC-016, BR-002, ADR-032
//
// The unit suite for this service never reached persistence
// (D2-domain-integration-verifier-30), which is how three defects survived: an
// unscoped read that returned every tenant's LINE ids
// (D3-integration-knowledge-document-intake-14 / D4-connector-governance-13), an
// audit call with the wrong arity whose failure was swallowed
// (D3-integration-knowledge-document-intake-15 / D4-connector-governance-03),
// and a tenant-scoped de-dupe that let one Business take over another's
// registration (D2-domain-integration-verifier-29). Each is asserted here
// against real rows, because each is invisible to a test that stops at Zod.

let tenantA, tenantB, ownedBusiness, siblingBusiness, otherTenantBusiness
let viewer, siblingViewer, memberViewer

const GROUP_ID = 'Cregistry-scope-group'
const USER_ID = 'Uregistry-scope-user'

const auditFor = (entityId) => prisma.auditEvent.findMany({
  where: { entityType: 'INTEGRATION_CONNECTION', entityId },
  orderBy: { occurredAt: 'asc' },
})

// The route is the surface the leak was reported against, so the listing is
// also asserted through its GET handler: only the session resolution is
// replaced, everything below it — handle(), the service, the database — is real.
const mocks = vi.hoisted(() => ({ resolveRequestViewer: vi.fn() }))
vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer: mocks.resolveRequestViewer }))

const REGISTRY_URL = 'http://local/api/platform/integrations/line-registry'

async function getRegistry(asViewer, query = '') {
  mocks.resolveRequestViewer.mockResolvedValueOnce(asViewer)
  const response = await GET(new Request(`${REGISTRY_URL}${query}`))
  return { status: response.status, body: await response.json() }
}

describe('LINE Registry scope, audit and ownership (FR-080)', () => {
  beforeAll(async () => {
    const pf = await createPortfolio({ name: 'Registry Group', code: 'PF-LINEREG' })
    tenantA = await createTenant({ portfolioId: pf.id, name: 'Registry Tenant A', code: 'TNT-LINEREG-A' })
    tenantB = await createTenant({ portfolioId: pf.id, name: 'Registry Tenant B', code: 'TNT-LINEREG-B' })
    ownedBusiness = await createBusiness({ tenantId: tenantA.id, name: 'Owned Business', code: 'BUS-LINEREG-1' })
    siblingBusiness = await createBusiness({ tenantId: tenantA.id, name: 'Sibling Business', code: 'BUS-LINEREG-2' })
    otherTenantBusiness = await createBusiness({ tenantId: tenantB.id, name: 'Other Tenant Business', code: 'BUS-LINEREG-3' })

    viewer = makeViewer({
      visibleBusinessIds: [ownedBusiness.id],
      ownedBusinessIds: [ownedBusiness.id],
      principal: { id: 'per-linereg-1', code: 'PER-LINEREG-1', displayName: 'Registry Owner' },
    })
    siblingViewer = makeViewer({
      visibleBusinessIds: [siblingBusiness.id],
      ownedBusinessIds: [siblingBusiness.id],
      principal: { id: 'per-linereg-2', code: 'PER-LINEREG-2', displayName: 'Sibling Owner' },
    })
    memberViewer = makeViewer({
      role: 'MEMBER',
      visibleBusinessIds: [ownedBusiness.id, otherTenantBusiness.id],
      ownedBusinessIds: [],
      principal: { id: 'per-linereg-3', code: 'PER-LINEREG-3', displayName: 'Sees Everything, Owns Nothing' },
    })

    // Another tenant's registration, written directly so the listing has
    // something it must refuse to return.
    const legacyProvider = await prisma.integrationProvider.upsert({
      where: { code: RETIRED_LINE_OA_PROVIDER_CODE },
      create: { code: RETIRED_LINE_OA_PROVIDER_CODE, name: 'LINE Official Account (legacy)', status: 'ACTIVE' },
      update: {},
    })
    await prisma.integrationConnection.create({
      data: {
        tenantId: tenantB.id,
        businessId: otherTenantBusiness.id,
        providerId: legacyProvider.id,
        name: 'Other Tenant Group',
        externalAccountId: 'Cother-tenant-secret-group',
        purpose: LINE_REGISTRY_TYPES.GROUP,
        role: 'SECONDARY',
        status: 'ACTIVE',
        metadataJson: '{}',
      },
    })
  })

  it('creates a group under the shared provider code and records an audit event', async () => {
    const saved = await saveLineGroup({
      businessId: ownedBusiness.id,
      name: 'ทีมเซลล์',
      groupId: GROUP_ID,
      departmentType: 'SALES_TEAM',
    }, { resolve: async () => viewer })

    expect(saved.ok).toBe(true)
    expect(saved.created).toBe(true)

    const row = await prisma.integrationConnection.findUnique({
      where: { id: saved.connection.id },
      include: { provider: true },
    })
    expect(row.provider.code).toBe(LINE_OA_PROVIDER_CODE)
    expect(row.businessId).toBe(ownedBusiness.id)
    expect(row.tenantId).toBe(tenantA.id)

    const events = await auditFor(saved.connection.id)
    expect(events).toHaveLength(1)
    expect(events[0].action).toBe('CREATE_LINE_GROUP')
    expect(events[0].actorId).toBe(viewer.principal.id)
    expect(JSON.parse(events[0].payloadJson)).toMatchObject({
      businessId: ownedBusiness.id,
      groupId: GROUP_ID,
    })
  })

  it('records an audit event for a user save too, and one more on update', async () => {
    const created = await saveLineUser({
      businessId: ownedBusiness.id,
      displayName: 'สมชาย',
      userId: USER_ID,
      role: 'SALES',
    }, { resolve: async () => viewer })
    expect(created.created).toBe(true)

    const updated = await saveLineUser({
      businessId: ownedBusiness.id,
      displayName: 'สมชาย (หัวหน้าทีม)',
      userId: USER_ID,
      role: 'SALES_LEAD',
    }, { resolve: async () => viewer })
    expect(updated.created).toBe(false)
    expect(updated.connection.id).toBe(created.connection.id)

    const events = await auditFor(created.connection.id)
    expect(events.map((e) => e.action)).toEqual(['CREATE_LINE_USER', 'UPDATE_LINE_USER'])
  })

  it('returns only the viewer\'s owned Businesses when no businessId is given', async () => {
    const rows = await listLineRegistry({ resolve: async () => viewer })
    expect(rows.length).toBeGreaterThan(0)
    expect(new Set(rows.map((row) => row.businessId))).toEqual(new Set([ownedBusiness.id]))
    expect(rows.every((row) => row.tenantId === tenantA.id)).toBe(true)
    expect(rows.some((row) => row.externalAccountId === 'Cother-tenant-secret-group')).toBe(false)
  })

  it('returns nothing to a viewer who sees Businesses but owns none', async () => {
    expect(await listLineRegistry({ resolve: async () => memberViewer })).toEqual([])
  })

  it('GET without a businessId is limited to the owned Businesses at the route itself', async () => {
    const owned = await getRegistry(viewer)
    expect(owned.status).toBe(200)
    expect(owned.body.length).toBeGreaterThan(0)
    expect(new Set(owned.body.map((row) => row.businessId))).toEqual(new Set([ownedBusiness.id]))
    expect(owned.body.every((row) => row.tenantId === tenantA.id)).toBe(true)
    expect(owned.body.some((row) => row.externalAccountId === 'Cother-tenant-secret-group')).toBe(false)

    expect(await getRegistry(memberViewer)).toEqual({ status: 200, body: [] })

    const foreign = await getRegistry(viewer, `?businessId=${encodeURIComponent(otherTenantBusiness.id)}`)
    expect(foreign.status).toBe(404)
    expect(foreign.body).toEqual({ error: 'LINE registry entry is outside your owned scope' })
  })

  it('refuses a businessId outside the viewer\'s ownership', async () => {
    await expect(listLineRegistry({
      businessId: otherTenantBusiness.id,
      resolve: async () => viewer,
    })).rejects.toMatchObject({ status: 404 })

    await expect(listLineRegistry({
      businessId: siblingBusiness.id,
      resolve: async () => viewer,
    })).rejects.toMatchObject({ status: 404 })
  })

  it('refuses a cross-Business re-point with 409 and leaves the row untouched', async () => {
    await expect(saveLineGroup({
      businessId: siblingBusiness.id,
      name: 'Hijacked',
      groupId: GROUP_ID,
      departmentType: 'EXECUTIVE',
    }, { resolve: async () => siblingViewer })).rejects.toMatchObject({ status: 409 })

    const row = await prisma.integrationConnection.findFirst({
      where: { tenantId: tenantA.id, externalAccountId: GROUP_ID },
    })
    expect(row.businessId).toBe(ownedBusiness.id)
    expect(row.name).toBe('ทีมเซลล์')

    await expect(saveLineUser({
      businessId: siblingBusiness.id,
      displayName: 'Hijacked',
      userId: USER_ID,
    }, { resolve: async () => siblingViewer })).rejects.toMatchObject({ status: 409 })
  })

  it('does not list a registration written under the retired legacy provider code', async () => {
    // A row under the retired code is no longer part of the registry read
    // model — the tolerance that used to surface it is gone. Such a row is no
    // longer written by the application; scripts/migrate-line-oa-provider.mjs
    // is the path for re-pointing one on a developer SQLite database.
    const legacyProvider = await prisma.integrationProvider.findUnique({
      where: { code: RETIRED_LINE_OA_PROVIDER_CODE },
    })
    const legacyRow = await prisma.integrationConnection.create({
      data: {
        tenantId: tenantA.id,
        businessId: ownedBusiness.id,
        providerId: legacyProvider.id,
        name: 'Legacy Group',
        externalAccountId: 'Clegacy-code-group',
        purpose: LINE_REGISTRY_TYPES.GROUP,
        role: 'SECONDARY',
        status: 'ACTIVE',
        metadataJson: '{}',
      },
    })

    const rows = await listLineRegistry({ businessId: ownedBusiness.id, resolve: async () => viewer })
    expect(rows.map((row) => row.id)).not.toContain(legacyRow.id)
  })

  it('does not de-dupe against a retired legacy row — it creates a new registration under the shared code', async () => {
    // The legacy row from the previous test still exists under the retired
    // code; the de-dupe lookup no longer matches it, so saving the same LINE
    // id creates a second, independent registration rather than updating it.
    const before = await prisma.integrationConnection.count({
      where: { tenantId: tenantA.id, externalAccountId: 'Clegacy-code-group' },
    })
    expect(before).toBe(1)

    const saved = await saveLineGroup({
      businessId: ownedBusiness.id,
      name: 'Legacy Group (renamed)',
      groupId: 'Clegacy-code-group',
    }, { resolve: async () => viewer })

    expect(saved.created).toBe(true)
    const after = await prisma.integrationConnection.count({
      where: { tenantId: tenantA.id, externalAccountId: 'Clegacy-code-group' },
    })
    expect(after).toBe(2)

    const newRow = await prisma.integrationConnection.findUnique({
      where: { id: saved.connection.id },
      include: { provider: true },
    })
    expect(newRow.provider.code).toBe(LINE_OA_PROVIDER_CODE)
  })

  it('keeps registry rows out of the FR-080 health read model', async () => {
    const rows = await listPhase1Integrations({
      resolve: async () => viewer,
      businessId: ownedBusiness.id,
    })
    const purposes = rows.map((row) => row.purpose)
    expect(purposes).not.toContain(LINE_REGISTRY_TYPES.GROUP)
    expect(purposes).not.toContain(LINE_REGISTRY_TYPES.USER)
    expect(rows.some((row) => row.id === undefined)).toBe(false)
  })
})
