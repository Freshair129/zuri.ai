import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { makeViewer, ownsElsewhere, makeDevViewer } from '../factories/viewer'
import {
  createPortfolio,
  createTenant,
  createBusiness,
  createWorkspace,
} from '@/modules/project-manager/application/scope-service'
import { createProject, createWorkstream } from '@/modules/project-manager/application/project-service'
import { createMilestone } from '@/modules/project-manager/application/milestone-gate-service'
import { createContainer, createItem } from '@/modules/project-manager/application/work-service'
import {
  requireViewer,
  assertWorkspaceWritable,
  assertProjectWritable,
  assertWorkstreamWritable,
  assertEndpointWritable,
} from '@/modules/project-manager/application/project-authorization'

// @req FR-072 — the one authorizer behind 19 repaid mutating routes.
// @spec SEC-001, SEC-008, BR-001
//
// Every refusal here is paired with a control: the same call, the same target, a
// viewer who *does* own it, and it succeeds. Without the control a refusal proves
// only that something went wrong — a malformed fixture and a working guard are
// indistinguishable from a red test alone.

let business, otherBusiness, workspace, project, workstream, milestone, container, item
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

describe('FR-072 project authorization', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'Authz Group', code: 'PF-AUTHZ' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'Authz Tenant', code: 'TNT-AUTHZ' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Authz Business', code: 'BUS-AUTHZ' })
    otherBusiness = await createBusiness({ tenantId: tenant.id, name: 'Other Business', code: 'BUS-AUTHZ-2' })

    // Built here (rather than with the other viewers below) because Wave 2
    // guarded createContainer/createItem after this file was written — its own
    // fixture-building calls to them below now need a viewer. Narrow fix, per
    // the design's residual-risk fallback (route-viewer-design.md §5): the
    // wave that broke a call site fixes exactly that call site and reports it.
    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })

    workspace = await createWorkspace({
      name: 'Authz WS', scopeType: 'BUSINESS', businessId: business.id, code: 'WS-AUTHZ',
    })
    project = await createProject({ workspaceId: workspace.id, name: 'Authz Project', code: 'PRJ-AUTHZ' })
    workstream = await createWorkstream({
      projectId: project.id, name: 'Authz Stream', executionMode: 'SOFTWARE_SPRINT', code: 'WST-AUTHZ',
    })
    milestone = await createMilestone({ projectId: project.id, title: 'Authz MS', code: 'MS-AUTHZ' })
    container = await createContainer({
      workstreamId: workstream.id, subtype: 'SPRINT', title: 'Authz Cont', code: 'WC-AUTHZ',
    }, { viewer: owner })
    item = await createItem({
      workstreamId: workstream.id, subtype: 'TASK', title: 'Authz Item', code: 'WI-AUTHZ',
    }, { viewer: owner })

    // A Project in a PORTFOLIO-scoped Space: businessId is null all the way
    // down, so no Business governs it — the Tier B / FR-072(b) case.
    sharedWorkspace = await createWorkspace({
      name: 'Shared WS', scopeType: 'PORTFOLIO', portfolioId: portfolio.id, code: 'WS-AUTHZ-SHARED',
    })
    sharedProject = await createProject({
      workspaceId: sharedWorkspace.id, name: 'Shared Project', code: 'PRJ-AUTHZ-SHARED',
    })

    // The attacker shape from the RCAs: global role OWNER, target Business
    // visible, owned elsewhere.
    attacker = ownsElsewhere({ owns: otherBusiness.id, sees: business.id })
    dev = makeDevViewer({ visibleBusinessIds: [business.id, otherBusiness.id] })
    ownsEverything = makeViewer({
      visibleBusinessIds: [business.id, otherBusiness.id],
      ownedBusinessIds: [business.id, otherBusiness.id],
    })
  })

  describe('the viewer is a required argument, and its absence is a crash', () => {
    // Not a 4xx: a missing viewer is a wiring bug in the caller. The next
    // surface wired without authorization must crash loudly, not write quietly.
    it('throws a statusless Error when the viewer is omitted or null', async () => {
      expect(() => requireViewer(undefined, 'ctx')).toThrow(/viewer is required/)
      expect(() => requireViewer(null, 'ctx')).toThrow(/viewer is required/)

      for (const call of [
        () => assertWorkspaceWritable(undefined, workspace),
        () => assertProjectWritable(null, project.id),
        () => assertWorkstreamWritable(undefined, workstream.id),
        () => assertEndpointWritable(null, { type: 'PROJECT', id: project.id }),
      ]) {
        const error = await refusalFrom(call)
        expect(error.message).toMatch(/viewer is required/)
        // No status → handle() maps it to 500, which is the contract.
        expect(error.status).toBeUndefined()
      }
    })

    it('requires a resolved workspace record, not a request body', async () => {
      const error = await refusalFrom(() => assertWorkspaceWritable(owner, undefined))
      expect(error.message).toMatch(/workspace is required/)
      expect(error.status).toBeUndefined()
    })
  })

  describe('Tier A — an unowned Business-governed target answers as an absent one', () => {
    it('refuses the attacker and permits the owner on the same target', async () => {
      const error = await refusalFrom(() => assertProjectWritable(attacker, project.id))
      expect(error.status).toBe(404)
      expect(error.message).toBe('Project not found')

      // The control: same call, same target, a viewer who owns the Business.
      await expect(assertProjectWritable(owner, project.id)).resolves.toMatchObject({ id: project.id })
    })

    it('refuses a platform DEV — seeing everything is not owning anything', async () => {
      const error = await refusalFrom(() => assertProjectWritable(dev, project.id))
      expect(error.status).toBe(404)
    })

    it('refuses an unowned real target identically to a fabricated id (no oracle)', async () => {
      const real = await refusalFrom(() => assertProjectWritable(attacker, project.id))
      const fabricated = await refusalFrom(() => assertProjectWritable(attacker, 'no-such-project-id'))
      // Byte-identical, so a refusal cannot be used to enumerate ids that exist.
      expect(real.status).toBe(fabricated.status)
      expect(real.message).toBe(fabricated.message)
    })

    it('propagates the target kind message down a chain so depth does not leak', async () => {
      const error = await refusalFrom(() =>
        assertWorkstreamWritable(attacker, workstream.id, { notFoundMessage: 'Work item not found' }),
      )
      expect(error.status).toBe(404)
      expect(error.message).toBe('Work item not found')
      await expect(
        assertWorkstreamWritable(owner, workstream.id, { notFoundMessage: 'Work item not found' }),
      ).resolves.toMatchObject({ id: workstream.id })
    })

    it('refuses an unowned Workspace record and permits its owner', async () => {
      const error = await refusalFrom(() => assertWorkspaceWritable(attacker, workspace))
      expect(error.status).toBe(404)
      expect(error.message).toBe('Workspace not found')
      expect(() => assertWorkspaceWritable(owner, workspace)).not.toThrow()
    })
  })

  describe('Tier B — a target no Business governs is refused for everyone', () => {
    it('refuses a shared-Space Project even for a viewer owning every Business', async () => {
      const error = await refusalFrom(() => assertProjectWritable(ownsEverything, sharedProject.id))
      expect(error.status).toBe(403)
      expect(error.message).toMatch(/cannot be authorized for any principal/)
      // The refusal is a statement about the system, not about the caller: the
      // most privileged viewer constructible gets the same answer.
      const asOwner = await refusalFrom(() => assertProjectWritable(owner, sharedProject.id))
      expect(asOwner.status).toBe(403)
      expect(asOwner.message).toBe(error.message)
    })

    it('refuses a PORTFOLIO-scoped Workspace and names the missing authority', async () => {
      const error = await refusalFrom(() => assertWorkspaceWritable(ownsEverything, sharedWorkspace))
      expect(error.status).toBe(403)
      expect(error.message).toMatch(/no authority above Business/)
      expect(error.message).toMatch(/cannot be authorized for any principal/)
    })

    it('refuses a scope type nobody declared an authorizer for (deny by default)', async () => {
      // A planted control for the lookup: the guard must deny an unrecognised
      // scope type rather than fall through. If someone adds a value to
      // WORKSPACE_SCOPE_TYPES, this is the arm that keeps it refused until an
      // authorizer is declared for it.
      const error = await refusalFrom(() =>
        assertWorkspaceWritable(ownsEverything, { code: 'WS-GALAXY', scopeType: 'GALAXY', businessId: business.id }),
      )
      expect(error.status).toBe(403)
      expect(error.message).toMatch(/unrecognised scope type "GALAXY"/)
    })
  })

  describe('dependency endpoints resolve through the shared table, not per caller', () => {
    it('authorizes each chain shape for the owner and refuses the attacker', async () => {
      const endpoints = [
        { type: 'PROJECT', id: () => project.id },
        { type: 'WORKSTREAM', id: () => workstream.id },
        { type: 'MILESTONE', id: () => milestone.id },
        { type: 'WORK_CONTAINER', id: () => container.id },
        { type: 'WORK_ITEM', id: () => item.id },
      ]
      for (const endpoint of endpoints) {
        const target = { type: endpoint.type, id: endpoint.id() }
        await expect(assertEndpointWritable(owner, target)).resolves.toBeDefined()
        const error = await refusalFrom(() => assertEndpointWritable(attacker, target))
        expect(error.status, `${endpoint.type} must refuse the attacker`).toBe(404)
      }
    })

    it('refuses an endpoint type nobody declared a chain for', async () => {
      const error = await refusalFrom(() => assertEndpointWritable(owner, { type: 'INVOICE', id: 'x' }))
      expect(error.message).toBe('Unsupported dependency endpoint type: INVOICE')
    })

    it('fails closed when the chain dangles instead of authorizing against nothing', async () => {
      const orphanProject = await createProject({
        workspaceId: workspace.id, name: 'Orphan', code: 'PRJ-AUTHZ-ORPHAN',
      })
      const orphanStream = await createWorkstream({
        projectId: orphanProject.id, name: 'Orphan Stream', executionMode: 'SOFTWARE_SPRINT', code: 'WST-AUTHZ-ORPHAN',
      })
      // The owner could write here a moment ago — the control for what follows.
      await expect(assertWorkstreamWritable(owner, orphanStream.id)).resolves.toBeDefined()

      // Now the Project the chain depends on is gone.
      await prisma.project.update({ where: { id: orphanProject.id }, data: { deletedAt: new Date() } })

      const error = await refusalFrom(() => assertWorkstreamWritable(owner, orphanStream.id))
      expect(error.status).toBe(404)
      expect(error.message).toBe('Workstream not found')
    })
  })
})
