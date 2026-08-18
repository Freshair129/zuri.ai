import { describe, it, expect, beforeAll } from 'vitest'
import { makeViewer, ownsElsewhere, makeDevViewer } from '../factories/viewer'
import {
  createPortfolio,
  createTenant,
  createBusiness,
  createWorkspace,
} from '../factories/scope'
import { createProject } from '@/modules/project-manager/application/project-service'
import {
  createMilestone,
  updateMilestone,
  createGate,
  updateGate,
} from '@/modules/project-manager/application/milestone-gate-service'
import prisma from '@/lib/db'

// @req FR-072 — milestone/gate mutations refuse the write unless the viewer
// owns the Business governing the target Project.
// @spec SEC-001, SEC-008, BR-001
// @tested tests/integration/fr072-milestone-gate-authorization.test.js
//
// Every refusal here is paired with a control: the same call, the same
// target, an owner viewer — and it succeeds. Without the control a refusal
// proves only that something went wrong.

let business, otherBusiness, workspace, project
let sharedWorkspace, sharedProject
let owner, attacker, dev, ownsEverything

/** Grab the thrown error rather than asserting on a message substring. */
async function refusalFrom(fn) {
  try {
    await fn()
  } catch (error) {
    return error
  }
  throw new Error('expected the call to be refused, but it resolved')
}

describe('FR-072 milestone/gate authorization', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'MG Authz Group', code: 'PF-MGAUTHZ' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'MG Authz Tenant', code: 'TNT-MGAUTHZ' })
    business = await createBusiness({ tenantId: tenant.id, name: 'MG Authz Business', code: 'BUS-MGAUTHZ' })
    otherBusiness = await createBusiness({ tenantId: tenant.id, name: 'MG Other Business', code: 'BUS-MGAUTHZ-2' })

    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
    // The attacker shape from the RCAs: global role OWNER, target Business
    // visible, owned elsewhere.
    attacker = ownsElsewhere({ owns: otherBusiness.id, sees: business.id })
    dev = makeDevViewer({ visibleBusinessIds: [business.id, otherBusiness.id] })
    ownsEverything = makeViewer({
      visibleBusinessIds: [business.id, otherBusiness.id],
      ownedBusinessIds: [business.id, otherBusiness.id],
    })

    // createWorkspace is BLOCKED (route-viewer-plan.md §BLOCKED B1) and never
    // accepts a viewer — no options bag passed here.
    workspace = await createWorkspace({
      name: 'MG Authz WS', scopeType: 'BUSINESS', businessId: business.id, code: 'WS-MGAUTHZ',
    })
    project = await createProject({ workspaceId: workspace.id, name: 'MG Authz Project', code: 'PRJ-MGAUTHZ' }, { viewer: owner })

    // A Project in a PORTFOLIO-scoped Space: businessId is null all the way
    // down, so no Business governs it — the Tier B / FR-072(b) case.
    sharedWorkspace = await createWorkspace({
      name: 'MG Shared WS', scopeType: 'PORTFOLIO', portfolioId: portfolio.id, code: 'WS-MGAUTHZ-SHARED',
    })
    // FR-072(b): createProject now refuses this for every principal (a
    // PORTFOLIO-scoped Workspace is governed by no Business), so this fixture
    // — which exists only to give the Tier B tests below a shared Project to
    // authorize against — is built directly with Prisma instead of going
    // through the now-guarded service. Arrangement, not subject: production
    // has exactly this state, seeded as WS-PLATFORM.
    sharedProject = await prisma.project.create({
      data: { code: 'PRJ-MGAUTHZ-SHARED', workspaceId: sharedWorkspace.id, name: 'MG Shared Project' },
    })
  })

  describe('createMilestone', () => {
    it('refuses the attacker and permits the owner on the same target', async () => {
      const before = await prisma.milestone.count()
      const error = await refusalFrom(() =>
        createMilestone({ projectId: project.id, title: 'Attack MS', code: 'MS-ATTACK' }, { viewer: attacker }),
      )
      expect(error.status).toBe(404)
      expect(error.message).toBe('Project not found')
      expect(await prisma.milestone.count()).toBe(before)

      const milestone = await createMilestone(
        { projectId: project.id, title: 'Owner MS', code: 'MS-OWNER' },
        { viewer: owner },
      )
      expect(milestone.projectId).toBe(project.id)
    })

    it('refuses a platform DEV — seeing everything is not owning anything', async () => {
      const error = await refusalFrom(() =>
        createMilestone({ projectId: project.id, title: 'Dev MS', code: 'MS-DEV' }, { viewer: dev }),
      )
      expect(error.status).toBe(404)
    })

    it('refuses an unowned real project identically to a fabricated id (no oracle)', async () => {
      const real = await refusalFrom(() =>
        createMilestone({ projectId: project.id, title: 'Oracle MS', code: 'MS-ORACLE' }, { viewer: attacker }),
      )
      const fabricated = await refusalFrom(() =>
        createMilestone({ projectId: 'no-such-project-id', title: 'Oracle MS', code: 'MS-ORACLE-2' }, { viewer: attacker }),
      )
      // Byte-identical message either way. The raw `.status` differs at this
      // direct-call layer only because the pre-existing (unguarded, unchanged)
      // "Project not found" lookup throws before assertProjectWritable is ever
      // reached for a truly nonexistent id — handle()'s message-sniffing in
      // src/app/api/_helpers.js maps *both* to the same 404 at the API boundary,
      // which is the layer an attacker actually observes. Both statuses that are
      // present are 404; a fabricated id can never see a status other than 404.
      expect(real.status).toBe(404)
      expect([undefined, 404]).toContain(fabricated.status)
      expect(real.message).toBe(fabricated.message)
    })

    it('refuses a shared-Space Project even for a viewer owning every Business (Tier B)', async () => {
      const before = await prisma.milestone.count()
      const error = await refusalFrom(() =>
        createMilestone({ projectId: sharedProject.id, title: 'Shared MS', code: 'MS-SHARED' }, { viewer: ownsEverything }),
      )
      expect(error.status).toBe(403)
      expect(error.message).toMatch(/cannot be authorized for any principal/)
      expect(await prisma.milestone.count()).toBe(before)
    })

    it('throws a wiring error, not a 4xx, when the viewer is omitted', async () => {
      const error = await refusalFrom(() =>
        createMilestone({ projectId: project.id, title: 'No Viewer MS', code: 'MS-NOVIEWER' }),
      )
      expect(error.status).toBeUndefined()
      expect(error.message).toMatch(/viewer is required/)
    })
  })

  describe('updateMilestone', () => {
    let milestone

    beforeAll(async () => {
      milestone = await createMilestone(
        { projectId: project.id, title: 'Update Target', code: 'MS-UPDATE-TARGET' },
        { viewer: owner },
      )
    })

    it('refuses the attacker and permits the owner on the same target', async () => {
      const error = await refusalFrom(() =>
        updateMilestone(milestone.id, { title: 'Attacker Renamed' }, { viewer: attacker }),
      )
      expect(error.status).toBe(404)
      expect(error.message).toBe('Milestone not found')
      const unchanged = await prisma.milestone.findUnique({ where: { id: milestone.id } })
      expect(unchanged.title).toBe('Update Target')
      // Milestone carries no `version` counter (unlike Workspace); `updatedAt`
      // is its equivalent mutation witness — Prisma's `@updatedAt` only fires
      // on an actual `.update()` call, which the refused guard never reaches.
      expect(unchanged.updatedAt).toEqual(milestone.updatedAt)

      const updated = await updateMilestone(milestone.id, { title: 'Owner Renamed' }, { viewer: owner })
      expect(updated.title).toBe('Owner Renamed')
    })
  })

  describe('createGate', () => {
    it('refuses the attacker and permits the owner on the same target', async () => {
      const before = await prisma.gate.count()
      const error = await refusalFrom(() =>
        createGate({ projectId: project.id, title: 'Attack Gate', code: 'GATE-ATTACK' }, { viewer: attacker }),
      )
      expect(error.status).toBe(404)
      expect(error.message).toBe('Project not found')
      expect(await prisma.gate.count()).toBe(before)

      const gate = await createGate({ projectId: project.id, title: 'Owner Gate', code: 'GATE-OWNER' }, { viewer: owner })
      expect(gate.projectId).toBe(project.id)
    })

    it('refuses a shared-Space Project even for a viewer owning every Business (Tier B)', async () => {
      const before = await prisma.gate.count()
      const error = await refusalFrom(() =>
        createGate({ projectId: sharedProject.id, title: 'Shared Gate', code: 'GATE-SHARED' }, { viewer: ownsEverything }),
      )
      expect(error.status).toBe(403)
      expect(error.message).toMatch(/cannot be authorized for any principal/)
      expect(await prisma.gate.count()).toBe(before)
    })
  })

  describe('updateGate', () => {
    let gate

    beforeAll(async () => {
      gate = await createGate({ projectId: project.id, title: 'Update Gate Target', code: 'GATE-UPDATE-TARGET' }, { viewer: owner })
    })

    it('refuses the attacker and permits the owner on the same target', async () => {
      const error = await refusalFrom(() =>
        updateGate(gate.id, { title: 'Attacker Renamed Gate' }, { viewer: attacker }),
      )
      expect(error.status).toBe(404)
      expect(error.message).toBe('Gate not found')
      const unchanged = await prisma.gate.findUnique({ where: { id: gate.id } })
      expect(unchanged.title).toBe('Update Gate Target')
      // Gate carries no `version` counter (unlike Workspace); `updatedAt` is
      // its equivalent mutation witness — see the milestone test above.
      expect(unchanged.updatedAt).toEqual(gate.updatedAt)

      const updated = await updateGate(gate.id, { title: 'Owner Renamed Gate' }, { viewer: owner })
      expect(updated.title).toBe('Owner Renamed Gate')
    })

    it('refuses an unowned real gate identically to a fabricated id (no oracle)', async () => {
      const real = await refusalFrom(() => updateGate(gate.id, { title: 'x' }, { viewer: attacker }))
      const fabricated = await refusalFrom(() => updateGate('no-such-gate-id', { title: 'x' }, { viewer: attacker }))
      // See the equivalent comment on the milestone oracle test above: the raw
      // `.status` differs only because the pre-existing "Gate not found" lookup
      // (unchanged by this wave) throws before assertProjectWritable runs for a
      // truly nonexistent id; handle()'s message-sniffing maps both to 404 at
      // the API boundary an attacker actually observes.
      expect(real.status).toBe(404)
      expect([undefined, 404]).toContain(fabricated.status)
      expect(real.message).toBe(fabricated.message)
    })
  })
})
