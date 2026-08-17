import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { makeViewer, ownsElsewhere } from '../factories/viewer'
import {
  createPortfolio,
  createTenant,
  createBusiness,
  createWorkspace,
} from '@/modules/project-manager/application/scope-service'
import { createProject, createWorkstream } from '@/modules/project-manager/application/project-service'
import {
  createContainer,
  updateContainer,
  createItem,
  updateItem,
  deleteItem,
} from '@/modules/project-manager/application/work-service'

// @req FR-072 — work-service mutations refuse the write unless the viewer owns
// the Business governing the target Workstream's Project.
// @spec SEC-001, SEC-008, BR-001
//
// Every refusal is paired with a control on the same call and target, and every
// refusal asserts nothing was written (the relevant count() unchanged).

let business, otherBusiness, workspace, project, workstream
let sharedWorkspace, sharedProject, sharedWorkstream
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

describe('FR-072 work-service authorization', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'Work Authz Group', code: 'PF-WORKAUTHZ' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'Work Authz Tenant', code: 'TNT-WORKAUTHZ' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Work Authz Business', code: 'BUS-WORKAUTHZ' })
    otherBusiness = await createBusiness({ tenantId: tenant.id, name: 'Other Business', code: 'BUS-WORKAUTHZ-2' })

    // Built before the fixtures below, not beside their first assertion: Wave 1
    // landed after this file and guarded createProject/createWorkstream, so
    // this suite's own fixture-building calls now need a viewer too.
    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
    attacker = ownsElsewhere({ owns: otherBusiness.id, sees: business.id })
    ownsEverything = makeViewer({
      visibleBusinessIds: [business.id, otherBusiness.id],
      ownedBusinessIds: [business.id, otherBusiness.id],
    })

    workspace = await createWorkspace({
      name: 'Work Authz WS', scopeType: 'BUSINESS', businessId: business.id, code: 'WS-WORKAUTHZ',
    })
    project = await createProject({ workspaceId: workspace.id, name: 'Work Authz Project', code: 'PRJ-WORKAUTHZ' }, { viewer: owner })
    workstream = await createWorkstream({
      projectId: project.id, name: 'Work Authz Stream', executionMode: 'SOFTWARE_SPRINT', code: 'WST-WORKAUTHZ',
    }, { viewer: owner })

    // A shared-Space Project (Tier B — no Business governs it).
    sharedWorkspace = await createWorkspace({
      name: 'Work Authz Shared WS', scopeType: 'PORTFOLIO', portfolioId: portfolio.id, code: 'WS-WORKAUTHZ-SHARED',
    })
    // FR-072(b): createProject now refuses a PORTFOLIO-scoped destination for
    // every principal, so this fixture — which exists only to prove Tier B
    // refuses createContainer under it — is planted directly with Prisma
    // instead of going through the now-guarded service. Arrangement, not
    // guard-dodging: production has exactly this state (WS-PLATFORM).
    sharedProject = await prisma.project.create({
      data: { code: 'PRJ-WORKAUTHZ-SHARED', workspaceId: sharedWorkspace.id, name: 'Shared Project' },
    })
    // Same reasoning one level down: createWorkstream now guards via
    // assertProjectWritable(viewer, projectId), and sharedProject is
    // Business-governed by nobody, so no viewer — not even ownsEverything —
    // could create this through the service either.
    sharedWorkstream = await prisma.workstream.create({
      data: {
        code: 'WST-WORKAUTHZ-SHARED',
        projectId: sharedProject.id,
        name: 'Shared Stream',
        executionMode: 'SOFTWARE_SPRINT',
        progressStrategy: 'TASK_WEIGHT',
      },
    })
  })

  describe('createContainer', () => {
    it('refuses the attacker and permits the owner on the same target', async () => {
      const before = await prisma.workContainer.count()
      const error = await refusalFrom(() =>
        createContainer({ workstreamId: workstream.id, subtype: 'SPRINT', title: 'Attacker Sprint' }, { viewer: attacker }),
      )
      expect(error.status).toBe(404)
      expect(error.message).toBe('Workstream not found')
      expect(await prisma.workContainer.count()).toBe(before)

      const created = await createContainer(
        { workstreamId: workstream.id, subtype: 'SPRINT', title: 'Owner Sprint', code: 'WC-WORKAUTHZ-1' },
        { viewer: owner },
      )
      expect(created.workstreamId).toBe(workstream.id)
      expect(await prisma.workContainer.count()).toBe(before + 1)
    })

    it('refuses an unowned real workstream identically to a fabricated id (no oracle)', async () => {
      // The fabricated id hits the pre-existing not-found check (no explicit
      // .status, mapped to 404 by handle()'s message sniffing) rather than the
      // guard; the byte-identical message is what actually proves an attacker
      // cannot tell "unowned" from "nonexistent" over the wire.
      const real = await refusalFrom(() =>
        createContainer({ workstreamId: workstream.id, subtype: 'SPRINT', title: 'X' }, { viewer: attacker }),
      )
      const fabricated = await refusalFrom(() =>
        createContainer({ workstreamId: 'no-such-workstream-id', subtype: 'SPRINT', title: 'X' }, { viewer: attacker }),
      )
      expect(real.message).toBe(fabricated.message)
    })

    it('refuses a container under a shared-Space Project for every principal (Tier B)', async () => {
      const error = await refusalFrom(() =>
        createContainer({ workstreamId: sharedWorkstream.id, subtype: 'SPRINT', title: 'Shared' }, { viewer: ownsEverything }),
      )
      expect(error.status).toBe(403)
      expect(error.message).toMatch(/cannot be authorized for any principal/)
    })
  })

  describe('updateContainer', () => {
    let container

    beforeAll(async () => {
      container = await createContainer(
        { workstreamId: workstream.id, subtype: 'SPRINT', title: 'Original Title', code: 'WC-WORKAUTHZ-2' },
        { viewer: owner },
      )
    })

    it('refuses the attacker (record unchanged) and permits the owner on the same target', async () => {
      const error = await refusalFrom(() =>
        updateContainer(container.id, { title: 'Hacked' }, { viewer: attacker }),
      )
      expect(error.status).toBe(404)
      expect(error.message).toBe('Container not found')
      const unchanged = await prisma.workContainer.findUnique({ where: { id: container.id } })
      expect(unchanged.title).toBe('Original Title')
      expect(unchanged.version).toBe(container.version)

      const updated = await updateContainer(container.id, { title: 'Renamed' }, { viewer: owner })
      expect(updated.title).toBe('Renamed')
    })
  })

  describe('createItem', () => {
    it('refuses the attacker and permits the owner on the same target', async () => {
      const before = await prisma.workItem.count()
      const error = await refusalFrom(() =>
        createItem({ workstreamId: workstream.id, subtype: 'TASK', title: 'Attacker Item' }, { viewer: attacker }),
      )
      expect(error.status).toBe(404)
      expect(error.message).toBe('Workstream not found')
      expect(await prisma.workItem.count()).toBe(before)

      const created = await createItem(
        { workstreamId: workstream.id, subtype: 'TASK', title: 'Owner Item', code: 'WI-WORKAUTHZ-1' },
        { viewer: owner },
      )
      expect(created.workstreamId).toBe(workstream.id)
      expect(await prisma.workItem.count()).toBe(before + 1)
    })

    it('refuses an unowned real workstream identically to a fabricated id (no oracle)', async () => {
      // Same reasoning as the createContainer oracle test above: the fabricated
      // id hits the pre-existing not-found check, not the guard, so only the
      // message (what an attacker actually sees) is compared.
      const real = await refusalFrom(() =>
        createItem({ workstreamId: workstream.id, subtype: 'TASK', title: 'X' }, { viewer: attacker }),
      )
      const fabricated = await refusalFrom(() =>
        createItem({ workstreamId: 'no-such-workstream-id', subtype: 'TASK', title: 'X' }, { viewer: attacker }),
      )
      expect(real.message).toBe(fabricated.message)
    })
  })

  describe('updateItem', () => {
    let item

    beforeAll(async () => {
      item = await createItem(
        { workstreamId: workstream.id, subtype: 'TASK', title: 'Original Item', code: 'WI-WORKAUTHZ-2' },
        { viewer: owner },
      )
    })

    it('refuses the attacker (record unchanged) and permits the owner on the same target', async () => {
      const error = await refusalFrom(() =>
        updateItem(item.id, { title: 'Hacked' }, { viewer: attacker }),
      )
      expect(error.status).toBe(404)
      expect(error.message).toBe('Work item not found')
      const unchanged = await prisma.workItem.findUnique({ where: { id: item.id } })
      expect(unchanged.title).toBe('Original Item')
      expect(unchanged.version).toBe(item.version)

      const updated = await updateItem(item.id, { title: 'Renamed Item' }, { viewer: owner })
      expect(updated.title).toBe('Renamed Item')
    })
  })

  describe('deleteItem', () => {
    let item

    beforeAll(async () => {
      item = await createItem(
        { workstreamId: workstream.id, subtype: 'TASK', title: 'Deletable Item', code: 'WI-WORKAUTHZ-3' },
        { viewer: owner },
      )
    })

    it('fails closed on a missing/deleted item instead of writing without loading', async () => {
      const error = await refusalFrom(() => deleteItem('no-such-item-id', { viewer: owner }))
      expect(error.status).toBe(404)
      expect(error.message).toBe('Work item not found')
    })

    it('refuses the attacker (item not deleted) and permits the owner on the same target', async () => {
      const error = await refusalFrom(() => deleteItem(item.id, { viewer: attacker }))
      expect(error.status).toBe(404)
      expect(error.message).toBe('Work item not found')
      const stillThere = await prisma.workItem.findUnique({ where: { id: item.id } })
      expect(stillThere.deletedAt).toBeNull()

      const deleted = await deleteItem(item.id, { viewer: owner })
      expect(deleted.deletedAt).not.toBeNull()
      expect(deleted.status).toBe('CANCELLED')
    })
  })
})
