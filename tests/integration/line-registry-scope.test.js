import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import {
  LINE_REGISTRY_TYPES,
  LEGACY_LINE_OA_PROVIDER_CODE,
  listLineRegistry,
  saveLineGroup,
  saveLineUser,
} from '@/modules/integration/application/line-registry-service'
import { listPhase1Integrations } from '@/modules/integration/application/integration-management-service'
import { LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'

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
  where: { entityType: 'IntegrationConnection', entityId },
  orderBy: { occurredAt: 'asc' },
})

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
      where: { code: LEGACY_LINE_OA_PROVIDER_CODE },
      create: { code: LEGACY_LINE_OA_PROVIDER_CODE, name: 'LINE Official Account (legacy)', status: 'ACTIVE' },
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

  it('still lists a registration written under the legacy provider code', async () => {
    const legacyProvider = await prisma.integrationProvider.findUnique({
      where: { code: LEGACY_LINE_OA_PROVIDER_CODE },
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
    expect(rows.map((row) => row.id)).toContain(legacyRow.id)
  })

  it('de-dupes against a legacy row rather than creating a second registration', async () => {
    const before = await prisma.integrationConnection.count({
      where: { tenantId: tenantA.id, externalAccountId: 'Clegacy-code-group' },
    })
    expect(before).toBe(1)

    const saved = await saveLineGroup({
      businessId: ownedBusiness.id,
      name: 'Legacy Group (renamed)',
      groupId: 'Clegacy-code-group',
    }, { resolve: async () => viewer })

    expect(saved.created).toBe(false)
    const after = await prisma.integrationConnection.count({
      where: { tenantId: tenantA.id, externalAccountId: 'Clegacy-code-group' },
    })
    expect(after).toBe(1)
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
