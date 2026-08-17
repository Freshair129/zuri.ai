// @req FR-072 — project-service mutations refuse the write unless the viewer
// owns the governing Business, derived from the target's Space.
// @spec SEC-001, SEC-008, BR-001
// @tested tests/integration/fr072-project-service-authorization.test.js
import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { makeViewer, ownsElsewhere } from '../factories/viewer'
import {
  createPortfolio,
  createTenant,
  createBusiness,
  createWorkspace,
} from '@/modules/project-manager/application/scope-service'
import {
  createProject,
  updateProject,
  archiveProject,
  createWorkstream,
  updateWorkstream,
  archiveWorkstream,
} from '@/modules/project-manager/application/project-service'

// Every refusal below is paired with a control: the same call, the same
// target, an owner viewer — and it succeeds. Without the control a refusal
// proves only that something went wrong, not that the guard works.

let business, otherBusiness
let workspace, workspaceSecondary, otherWorkspace, sharedWorkspace
let owner, attacker, ownsEverything

/** Grab the thrown error rather than asserting on a message substring. */
async function refusalFrom(fn) {
  try {
    await fn()
  } catch (error) {
    return error
  }
  throw new Error('expected the call to be refused, but it resolved')
}

describe('FR-072 project-service authorization', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'W1 Authz Group', code: 'PF-W1AUTHZ' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'W1 Authz Tenant', code: 'TNT-W1AUTHZ' })
    business = await createBusiness({ tenantId: tenant.id, name: 'W1 Authz Business', code: 'BUS-W1AUTHZ' })
    otherBusiness = await createBusiness({ tenantId: tenant.id, name: 'W1 Other Business', code: 'BUS-W1AUTHZ-2' })

    workspace = await createWorkspace({
      name: 'W1 Authz WS', scopeType: 'BUSINESS', businessId: business.id, code: 'WS-W1AUTHZ',
    })
    workspaceSecondary = await createWorkspace({
      name: 'W1 Authz WS2', scopeType: 'BUSINESS', businessId: business.id, code: 'WS-W1AUTHZ-2',
    })
    otherWorkspace = await createWorkspace({
      name: 'W1 Other WS', scopeType: 'BUSINESS', businessId: otherBusiness.id, code: 'WS-W1AUTHZ-OTHER',
    })
    sharedWorkspace = await createWorkspace({
      name: 'W1 Shared WS', scopeType: 'PORTFOLIO', portfolioId: portfolio.id, code: 'WS-W1AUTHZ-SHARED',
    })

    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
    // The attacker shape from the RCAs: global role OWNER, target Business
    // visible, owned elsewhere.
    attacker = ownsElsewhere({ owns: otherBusiness.id, sees: business.id })
    ownsEverything = makeViewer({
      visibleBusinessIds: [business.id, otherBusiness.id],
      ownedBusinessIds: [business.id, otherBusiness.id],
    })
  })

  describe('createProject', () => {
    it('refuses the attacker and permits the owner on the same Workspace', async () => {
      const before = await prisma.project.count()
      const error = await refusalFrom(() =>
        createProject({ workspaceId: workspace.id, name: 'W1 Attacker Project', code: 'PRJ-W1-ATTACK' }, { viewer: attacker }),
      )
      expect(error.status).toBe(404)
      expect(error.message).toBe('Workspace not found')
      expect(await prisma.project.count()).toBe(before)

      const project = await createProject(
        { workspaceId: workspace.id, name: 'W1 Owner Project', code: 'PRJ-W1-OWNER' },
        { viewer: owner },
      )
      expect(project.id).toBeTruthy()
    })
  })

  describe('updateProject', () => {
    let project

    beforeAll(async () => {
      project = await createProject({ workspaceId: workspace.id, name: 'W1 Update Project', code: 'PRJ-W1-UPDATE' }, { viewer: owner })
    })

    it('refuses the attacker and permits the owner on the same target', async () => {
      const error = await refusalFrom(() => updateProject(project.id, { name: 'Hijacked' }, { viewer: attacker }))
      expect(error.status).toBe(404)
      expect(error.message).toBe('Project not found')
      const untouched = await prisma.project.findUnique({ where: { id: project.id } })
      expect(untouched.name).toBe('W1 Update Project')
      expect(untouched.version).toBe(project.version)

      const updated = await updateProject(project.id, { name: 'W1 Update Project v2' }, { viewer: owner })
      expect(updated.name).toBe('W1 Update Project v2')
    })

    it('refuses an unowned real target identically to a fabricated id (no oracle)', async () => {
      const real = await refusalFrom(() => updateProject(project.id, { name: 'Nope' }, { viewer: attacker }))
      const fabricated = await refusalFrom(() => updateProject('no-such-project-id', { name: 'Nope' }, { viewer: attacker }))
      expect(real.status).toBe(fabricated.status)
      expect(real.message).toBe(fabricated.message)
    })

    it('move: owner moving the Project to a Workspace of an unowned Business is refused 404 Workspace not found', async () => {
      const error = await refusalFrom(() => updateProject(project.id, { workspaceId: otherWorkspace.id }, { viewer: owner }))
      expect(error.status).toBe(404)
      expect(error.message).toBe('Workspace not found')
      const untouched = await prisma.project.findUnique({ where: { id: project.id } })
      expect(untouched.workspaceId).toBe(workspace.id)
    })

    it('move: the same owner moving between two Workspaces of the same owned Business succeeds', async () => {
      const moved = await updateProject(project.id, { workspaceId: workspaceSecondary.id }, { viewer: owner })
      expect(moved.workspaceId).toBe(workspaceSecondary.id)
    })

    it('move: any viewer, even one owning every Business, moving a Project into a PORTFOLIO Space is refused 403', async () => {
      const error = await refusalFrom(() => updateProject(project.id, { workspaceId: sharedWorkspace.id }, { viewer: ownsEverything }))
      expect(error.status).toBe(403)
      expect(error.message).toMatch(/cannot be authorized for any principal/)
    })
  })

  describe('archiveProject', () => {
    let project

    beforeAll(async () => {
      project = await createProject({ workspaceId: workspace.id, name: 'W1 Archive Project', code: 'PRJ-W1-ARCHIVE' }, { viewer: owner })
    })

    it('refuses the attacker (fails closed, load-then-authorize) and permits the owner', async () => {
      const error = await refusalFrom(() => archiveProject(project.id, { viewer: attacker }))
      expect(error.status).toBe(404)
      expect(error.message).toBe('Project not found')
      const untouched = await prisma.project.findUnique({ where: { id: project.id } })
      expect(untouched.deletedAt).toBeNull()

      const archived = await archiveProject(project.id, { viewer: owner })
      expect(archived.status).toBe('ARCHIVED')
      expect(archived.deletedAt).toBeTruthy()
    })

    it('refuses a missing project id with 404 instead of a raw write failure', async () => {
      const error = await refusalFrom(() => archiveProject('no-such-project-id', { viewer: owner }))
      expect(error.status).toBe(404)
      expect(error.message).toBe('Project not found')
    })
  })

  describe('createWorkstream', () => {
    let project

    beforeAll(async () => {
      project = await createProject({ workspaceId: workspace.id, name: 'W1 WS Host Project', code: 'PRJ-W1-WSHOST' }, { viewer: owner })
    })

    it('refuses the attacker and permits the owner on the same Project', async () => {
      const before = await prisma.workstream.count()
      const error = await refusalFrom(() =>
        createWorkstream(
          { projectId: project.id, name: 'Attacker Stream', executionMode: 'SOFTWARE_SPRINT', code: 'WST-W1-ATTACK' },
          { viewer: attacker },
        ),
      )
      expect(error.status).toBe(404)
      expect(error.message).toBe('Project not found')
      expect(await prisma.workstream.count()).toBe(before)

      const workstream = await createWorkstream(
        { projectId: project.id, name: 'Owner Stream', executionMode: 'SOFTWARE_SPRINT', code: 'WST-W1-OWNER' },
        { viewer: owner },
      )
      expect(workstream.id).toBeTruthy()
    })
  })

  describe('updateWorkstream', () => {
    let project, workstream

    beforeAll(async () => {
      project = await createProject({ workspaceId: workspace.id, name: 'W1 WS Update Project', code: 'PRJ-W1-WSUPD' }, { viewer: owner })
      workstream = await createWorkstream(
        { projectId: project.id, name: 'Update Stream', executionMode: 'SOFTWARE_SPRINT', code: 'WST-W1-UPDATE' },
        { viewer: owner },
      )
    })

    it('refuses the attacker and permits the owner on the same target', async () => {
      const error = await refusalFrom(() => updateWorkstream(workstream.id, { name: 'Hijacked' }, { viewer: attacker }))
      expect(error.status).toBe(404)
      expect(error.message).toBe('Workstream not found')
      const untouched = await prisma.workstream.findUnique({ where: { id: workstream.id } })
      expect(untouched.name).toBe('Update Stream')
      expect(untouched.version).toBe(workstream.version)

      const updated = await updateWorkstream(workstream.id, { name: 'Update Stream v2' }, { viewer: owner })
      expect(updated.name).toBe('Update Stream v2')
    })
  })

  describe('archiveWorkstream', () => {
    let project, workstream

    beforeAll(async () => {
      project = await createProject({ workspaceId: workspace.id, name: 'W1 WS Archive Project', code: 'PRJ-W1-WSARCH' }, { viewer: owner })
      workstream = await createWorkstream(
        { projectId: project.id, name: 'Archive Stream', executionMode: 'SOFTWARE_SPRINT', code: 'WST-W1-ARCHIVE' },
        { viewer: owner },
      )
    })

    it('refuses the attacker (fails closed, load-then-authorize) and permits the owner', async () => {
      const error = await refusalFrom(() => archiveWorkstream(workstream.id, { viewer: attacker }))
      expect(error.status).toBe(404)
      expect(error.message).toBe('Workstream not found')
      const untouched = await prisma.workstream.findUnique({ where: { id: workstream.id } })
      expect(untouched.deletedAt).toBeNull()

      const archived = await archiveWorkstream(workstream.id, { viewer: owner })
      expect(archived.status).toBe('ARCHIVED')
      expect(archived.deletedAt).toBeTruthy()
    })

    it('refuses a missing workstream id with 404 instead of a raw write failure', async () => {
      const error = await refusalFrom(() => archiveWorkstream('no-such-workstream-id', { viewer: owner }))
      expect(error.status).toBe(404)
      expect(error.message).toBe('Workstream not found')
    })
  })
})
