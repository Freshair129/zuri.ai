import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { makeViewer, ownsElsewhere } from '../factories/viewer'
import {
  createPortfolio,
  createTenant,
  createBusiness,
  createWorkspace,
} from '../factories/scope'
import { createProject, createWorkstream } from '@/modules/project-manager/application/project-service'
import { createDependency, deleteDependency } from '@/modules/project-manager/application/dependency-service'

// @req FR-072 — a Dependency write requires the viewer own the governing
// Business of BOTH endpoints (the fail-closed composition of SEC-001). The
// two-fixture design proves the conjunction is causal, not incidental: owning
// only one of the two endpoints' Businesses is not enough.
// @spec SEC-001, SEC-008, BR-001

let businessA, businessB, businessAttackerHome
let workspaceA, workspaceB, projectA, projectB, workstreamA, workstreamB, workstreamB2
let ownerB, attacker, viewerBoth, viewerOnlyA

async function refusalFrom(fn) {
  try {
    await fn()
  } catch (error) {
    return error
  }
  throw new Error('expected the call to be refused, but it resolved')
}

describe('FR-072 dependency-service authorization', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'Dep Authz Group', code: 'PF-DEPAUTHZ' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'Dep Authz Tenant', code: 'TNT-DEPAUTHZ' })
    businessA = await createBusiness({ tenantId: tenant.id, name: 'Dep Authz Business A', code: 'BUS-DEPAUTHZ-A' })
    businessB = await createBusiness({ tenantId: tenant.id, name: 'Dep Authz Business B', code: 'BUS-DEPAUTHZ-B' })
    businessAttackerHome = await createBusiness({ tenantId: tenant.id, name: 'Attacker Home', code: 'BUS-DEPAUTHZ-C' })

    // Built before the fixtures below, not beside their first assertion: Wave 1
    // landed after this file and guarded createProject/createWorkstream, so
    // this suite's own fixture-building calls now need a viewer too. viewerBoth
    // owns both A and B, so it is the one used to plant fixtures on either side.
    ownerB = makeViewer({ visibleBusinessIds: [businessB.id], ownedBusinessIds: [businessB.id] })
    // Owns a Business elsewhere, merely sees Business B — the attacker shape.
    attacker = ownsElsewhere({ owns: businessAttackerHome.id, sees: businessB.id })
    viewerBoth = makeViewer({
      visibleBusinessIds: [businessA.id, businessB.id],
      ownedBusinessIds: [businessA.id, businessB.id],
    })
    viewerOnlyA = makeViewer({
      visibleBusinessIds: [businessA.id, businessB.id],
      ownedBusinessIds: [businessA.id],
    })

    workspaceA = await createWorkspace({ name: 'Dep WS A', scopeType: 'BUSINESS', businessId: businessA.id, code: 'WS-DEPAUTHZ-A' })
    workspaceB = await createWorkspace({ name: 'Dep WS B', scopeType: 'BUSINESS', businessId: businessB.id, code: 'WS-DEPAUTHZ-B' })

    projectA = await createProject({ workspaceId: workspaceA.id, name: 'Dep Project A', code: 'PRJ-DEPAUTHZ-A' }, { viewer: viewerBoth })
    projectB = await createProject({ workspaceId: workspaceB.id, name: 'Dep Project B', code: 'PRJ-DEPAUTHZ-B' }, { viewer: viewerBoth })

    workstreamA = await createWorkstream({
      projectId: projectA.id, name: 'Dep Stream A', executionMode: 'SOFTWARE_SPRINT', code: 'WST-DEPAUTHZ-A',
    }, { viewer: viewerBoth })
    workstreamB = await createWorkstream({
      projectId: projectB.id, name: 'Dep Stream B', executionMode: 'SOFTWARE_SPRINT', code: 'WST-DEPAUTHZ-B',
    }, { viewer: viewerBoth })
    workstreamB2 = await createWorkstream({
      projectId: projectB.id, name: 'Dep Stream B2', executionMode: 'SOFTWARE_SPRINT', code: 'WST-DEPAUTHZ-B2',
    }, { viewer: viewerBoth })
  })

  describe('createDependency — fixture (i): both endpoints in Business B', () => {
    it('refuses the attacker (nothing written) and permits the owner of B on the same edge', async () => {
      const before = await prisma.dependency.count()
      const error = await refusalFrom(() =>
        createDependency(
          { sourceType: 'WORKSTREAM', sourceId: workstreamB.id, targetType: 'WORKSTREAM', targetId: workstreamB2.id, dependencyType: 'BLOCKS' },
          { viewer: attacker },
        ),
      )
      expect(error.status).toBe(404)
      expect(await prisma.dependency.count()).toBe(before)

      const created = await createDependency(
        { sourceType: 'WORKSTREAM', sourceId: workstreamB.id, targetType: 'WORKSTREAM', targetId: workstreamB2.id, dependencyType: 'BLOCKS' },
        { viewer: ownerB },
      )
      expect(created.sourceId).toBe(workstreamB.id)
      expect(await prisma.dependency.count()).toBe(before + 1)
    })
  })

  describe('createDependency — fixture (ii): endpoints in A and B (proves the conjunction is causal)', () => {
    it('a viewer owning both A and B succeeds; a viewer owning only A is refused', async () => {
      const before = await prisma.dependency.count()

      // Owning only A is not enough — the target endpoint lives in B.
      const error = await refusalFrom(() =>
        createDependency(
          { sourceType: 'WORKSTREAM', sourceId: workstreamA.id, targetType: 'WORKSTREAM', targetId: workstreamB.id, dependencyType: 'REQUIRES' },
          { viewer: viewerOnlyA },
        ),
      )
      expect(error.status).toBe(404)
      expect(await prisma.dependency.count()).toBe(before)

      const created = await createDependency(
        { sourceType: 'WORKSTREAM', sourceId: workstreamA.id, targetType: 'WORKSTREAM', targetId: workstreamB.id, dependencyType: 'REQUIRES' },
        { viewer: viewerBoth },
      )
      expect(created.sourceId).toBe(workstreamA.id)
      expect(created.targetId).toBe(workstreamB.id)
      expect(await prisma.dependency.count()).toBe(before + 1)
    })

    it('refuses before the cycle scan runs — the authorization error, not a cycle error', async () => {
      // A→B already exists from the previous test. B→A would create a cycle.
      // If the cycle scan ran before authorization, an unauthorized caller
      // would learn "Dependency would create a cycle" — a fact about other
      // tenants' edges. It must instead be refused on authorization first.
      const error = await refusalFrom(() =>
        createDependency(
          { sourceType: 'WORKSTREAM', sourceId: workstreamB.id, targetType: 'WORKSTREAM', targetId: workstreamA.id, dependencyType: 'REQUIRES' },
          { viewer: viewerOnlyA },
        ),
      )
      expect(error.status).toBe(404)
      expect(error.message).not.toMatch(/cycle/i)
    })
  })

  describe('createDependency — oracle equality', () => {
    it('refuses an unowned real endpoint identically to a fabricated one (no oracle)', async () => {
      // The fabricated id hits assertEndpointExists's own pre-existing
      // not-found check (no explicit .status), while the real-but-unowned
      // source hits the guard's default message, which is the same text
      // (`Dependency endpoint not found: TYPE id`) for the same type/id. Both
      // map to HTTP 404 via handle(); the message is what an attacker sees.
      const real = await refusalFrom(() =>
        createDependency(
          { sourceType: 'WORKSTREAM', sourceId: workstreamB.id, targetType: 'WORKSTREAM', targetId: workstreamB2.id, dependencyType: 'BLOCKS' },
          { viewer: attacker },
        ),
      )
      const fabricated = await refusalFrom(() =>
        createDependency(
          { sourceType: 'WORKSTREAM', sourceId: 'no-such-workstream-id', targetType: 'WORKSTREAM', targetId: workstreamB2.id, dependencyType: 'BLOCKS' },
          { viewer: attacker },
        ),
      )
      expect(real.message).toBe(`Dependency endpoint not found: WORKSTREAM ${workstreamB.id}`)
      expect(fabricated.message).toBe('Dependency endpoint not found: WORKSTREAM no-such-workstream-id')
    })
  })

  describe('deleteDependency', () => {
    it('fails closed on a missing dependency instead of deleting without loading', async () => {
      const error = await refusalFrom(() => deleteDependency('no-such-dependency-id', { viewer: ownerB }))
      expect(error.status).toBe(404)
      expect(error.message).toBe('Dependency not found')
    })

    it('refuses the attacker (edge not deleted) and permits the owner of both endpoints', async () => {
      const dependency = await createDependency(
        { sourceType: 'WORKSTREAM', sourceId: workstreamB.id, targetType: 'WORKSTREAM', targetId: workstreamB2.id, dependencyType: 'REQUIRES' },
        { viewer: ownerB },
      )
      const before = await prisma.dependency.count()

      const error = await refusalFrom(() => deleteDependency(dependency.id, { viewer: attacker }))
      expect(error.status).toBe(404)
      expect(error.message).toBe('Dependency not found')
      expect(await prisma.dependency.count()).toBe(before)

      const deleted = await deleteDependency(dependency.id, { viewer: ownerB })
      expect(deleted.id).toBe(dependency.id)
      expect(await prisma.dependency.count()).toBe(before - 1)
    })

    it('requires BOTH endpoints on delete too — owning only A is refused for an A/B edge', async () => {
      const dependency = await createDependency(
        { sourceType: 'WORKSTREAM', sourceId: workstreamA.id, targetType: 'WORKSTREAM', targetId: workstreamB2.id, dependencyType: 'BLOCKS' },
        { viewer: viewerBoth },
      )
      const error = await refusalFrom(() => deleteDependency(dependency.id, { viewer: viewerOnlyA }))
      expect(error.status).toBe(404)
      expect(error.message).toBe('Dependency not found')

      const deleted = await deleteDependency(dependency.id, { viewer: viewerBoth })
      expect(deleted.id).toBe(dependency.id)
    })
  })
})
