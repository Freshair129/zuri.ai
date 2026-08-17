import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { handle } from '@/app/api/_helpers'
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
} from '@/modules/project-manager/application/project-service'
import {
  createContainer,
  createItem,
  updateContainer,
  updateItem,
  deleteItem,
} from '@/modules/project-manager/application/work-service'
import { createDependency, deleteDependency } from '@/modules/project-manager/application/dependency-service'
import { createProjectFile, deleteProjectFile } from '@/modules/project-manager/application/project-file-service'
import {
  createMilestone,
  updateMilestone,
  createGate,
  updateGate,
} from '@/modules/project-manager/application/milestone-gate-service'
import {
  createRepository,
  linkRepository,
  unlinkRepository,
} from '@/modules/project-manager/application/repository-service'
import { updateWorkspace } from '@/modules/project-manager/application/scope-service'

// @req FR-072 — clause (a): a Business-governed target that is not owned answers
// exactly as a nonexistent one.
// @spec SEC-001, SEC-008
//
// **Why this file exists, and why it is one file rather than six.**
//
// Each wave asserts its own Tier A refusal locally. None of them asserted the
// thing those assertions actually depend on. The no-oracle guarantee is not a
// property of any single service — it is a property of the *boundary*:
//
//   unowned real target → refusal(404, 'X not found')      — explicit .status
//   fabricated id       → new Error('X not found')          — NO .status, from a
//                                                             pre-existing check
//
// Those are different objects. They become indistinguishable only because
// `handle()` maps both to 404, the second via its `/not found/i` message sniff.
// So the guarantee rests on a *substring in a legacy message* — and `_helpers.js`
// documents an active migration away from message sniffing toward explicit
// statuses. Complete that migration, or merely reword one legacy message to
// "no such project", and the fabricated-id path becomes 500 while the unowned
// path stays 404: a live enumeration oracle over other tenants' ids.
//
// This was not hypothetical. A verify gate planted exactly that regression
// (`const notFound = false`) and **all 26 of one worker's wave tests stayed
// green**. The property was asserted nowhere.
//
// Writing this assertion into each wave's file instead would be the disease this
// whole effort exists to cure: a rule applied by hand at each site, correct at
// the sites someone remembered. It is asserted once, here, at the boundary where
// it is actually true or false — and `disclosureFires` below proves the
// assertion can fail, per mission rule 8.

let business, workspace, project, workstream, container, item, dependency, projectFile
let milestone, gate, repositoryLink
let owner, attacker

/**
 * What a caller actually observes: the HTTP status and body `handle()` produces.
 *
 * Deliberately not the thrown error's `.status`. The raw errors legitimately
 * differ; the question is whether the *answers* do.
 */
async function observed(fn) {
  const response = await handle(fn)
  return { status: response.status, body: await response.json() }
}

/**
 * The claim, for one target kind: refusing an unowned real target is
 * indistinguishable from refusing an id that never existed.
 */
async function assertIndistinguishable(name, callWith) {
  const real = await observed(() => callWith(attacker, 'REAL'))
  const fabricated = await observed(() => callWith(attacker, 'no-such-id-at-all'))
  expect(real, `${name}: an unowned real target must not answer differently`).toEqual(fabricated)
  // And both must be the refusal, not an accidental success or a 500.
  expect(real.status, `${name}: expected a 404-shaped refusal`).toBe(404)
}

describe('FR-072(a) refusals disclose nothing at the boundary', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'Disclosure Group', code: 'PF-DISC' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'Disclosure Tenant', code: 'TNT-DISC' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Disclosure Business', code: 'BUS-DISC' })
    const elsewhere = await createBusiness({ tenantId: tenant.id, name: 'Elsewhere', code: 'BUS-DISC-2' })

    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
    attacker = ownsElsewhere({ owns: elsewhere.id, sees: business.id })

    workspace = await createWorkspace({
      name: 'Disclosure WS', scopeType: 'BUSINESS', businessId: business.id, code: 'WS-DISC',
    })
    project = await createProject(
      { workspaceId: workspace.id, name: 'Disclosure Project', code: 'PRJ-DISC' }, { viewer: owner },
    )
    workstream = await createWorkstream(
      { projectId: project.id, name: 'Disclosure Stream', executionMode: 'SOFTWARE_SPRINT', code: 'WST-DISC' },
      { viewer: owner },
    )
    container = await createContainer(
      { workstreamId: workstream.id, subtype: 'SPRINT', title: 'Disclosure Cont', code: 'WC-DISC' },
      { viewer: owner },
    )
    item = await createItem(
      { workstreamId: workstream.id, subtype: 'TASK', title: 'Disclosure Item', code: 'WI-DISC' },
      { viewer: owner },
    )
    const other = await createItem(
      { workstreamId: workstream.id, subtype: 'TASK', title: 'Disclosure Item 2', code: 'WI-DISC-2' },
      { viewer: owner },
    )
    dependency = await createDependency(
      {
        sourceType: 'WORK_ITEM', sourceId: item.id,
        targetType: 'WORK_ITEM', targetId: other.id,
        dependencyType: 'BLOCKS',
      },
      { viewer: owner },
    )
    projectFile = await createProjectFile(
      project.id,
      { name: 'disclosure.txt', mime: 'text/plain', size: 12, url: 'https://example.test/d.txt' },
      { viewer: owner },
    )
    milestone = await createMilestone(
      { projectId: project.id, title: 'Disclosure MS', code: 'MS-DISC' }, { viewer: owner },
    )
    gate = await createGate(
      { projectId: project.id, title: 'Disclosure Gate', code: 'GATE-DISC' }, { viewer: owner },
    )
    // createRepository is BLOCKED (no scope field on Repository, so no predicate
    // can govern it) and takes no viewer — only the *link* is repaid.
    const repository = await createRepository({ provider: 'github', fullName: 'org/disc', code: 'REP-DISC' })
    repositoryLink = await linkRepository(
      { projectId: project.id, repoId: repository.id, role: 'PRIMARY' }, { viewer: owner },
    )
  })

  // One case per repaid target kind. Each passes the *same* viewer to both calls,
  // so the only difference is whether the target exists — which is precisely the
  // bit an attacker is trying to learn.
  it('a Project answers the same whether unowned or absent', async () => {
    await assertIndistinguishable('updateProject', (viewer, which) =>
      updateProject(which === 'REAL' ? project.id : which, { name: 'x' }, { viewer }))
    await assertIndistinguishable('archiveProject', (viewer, which) =>
      archiveProject(which === 'REAL' ? project.id : which, { viewer }))
  })

  it('a Workstream answers the same whether unowned or absent', async () => {
    await assertIndistinguishable('updateWorkstream', (viewer, which) =>
      updateWorkstream(which === 'REAL' ? workstream.id : which, { progressWeight: 2 }, { viewer }))
  })

  it('a Work Item answers the same whether unowned or absent', async () => {
    await assertIndistinguishable('updateItem', (viewer, which) =>
      updateItem(which === 'REAL' ? item.id : which, { status: 'DONE' }, { viewer }))
    await assertIndistinguishable('deleteItem', (viewer, which) =>
      deleteItem(which === 'REAL' ? item.id : which, { viewer }))
  })

  it('a Container answers the same whether unowned or absent', async () => {
    await assertIndistinguishable('updateContainer', (viewer, which) =>
      updateContainer(which === 'REAL' ? container.id : which, { title: 'x' }, { viewer }))
  })

  it('a Dependency answers the same whether unowned or absent', async () => {
    await assertIndistinguishable('deleteDependency', (viewer, which) =>
      deleteDependency(which === 'REAL' ? dependency.id : which, { viewer }))
  })

  it('a Project file answers the same whether unowned or absent', async () => {
    await assertIndistinguishable('deleteProjectFile', (viewer, which) =>
      deleteProjectFile(project.id, which === 'REAL' ? projectFile.id : which, { viewer }))
  })

  it('a Milestone and a Gate answer the same whether unowned or absent', async () => {
    await assertIndistinguishable('updateMilestone', (viewer, which) =>
      updateMilestone(which === 'REAL' ? milestone.id : which, { title: 'x' }, { viewer }))
    await assertIndistinguishable('updateGate', (viewer, which) =>
      updateGate(which === 'REAL' ? gate.id : which, { status: 'PASSED' }, { viewer }))
  })

  it('a Repository link answers the same whether unowned or absent', async () => {
    await assertIndistinguishable('unlinkRepository', (viewer, which) =>
      unlinkRepository(which === 'REAL' ? repositoryLink.id : which, { viewer }))
  })

  it('a Workspace answers the same whether unowned or absent', async () => {
    await assertIndistinguishable('updateWorkspace', (viewer, which) =>
      updateWorkspace(which === 'REAL' ? workspace.id : which, { name: 'x' }, { viewer }))
  })

  // Rule 8: a loosening — or an equality — must be proven in both directions.
  // Without this, every assertion above could pass because the comparison is
  // incapable of failing.
  describe('the comparison above is capable of failing', () => {
    it('detects divergence, and shows the exact regression that would cause it', async () => {
      // Left: what a guard throws today — explicit status.
      const explicit = await observed(() => {
        throw Object.assign(new Error('Project not found'), { status: 404 })
      })
      // Right: the same refusal after someone rewords a legacy message, or
      // finishes the migration away from message sniffing that _helpers.js
      // describes. No status, and no longer matching /not found/i.
      const reworded = await observed(() => {
        throw new Error('no such project')
      })

      expect(explicit).not.toEqual(reworded)
      expect(explicit.status).toBe(404)
      // 500 vs 404 is the oracle: the attacker now distinguishes a real target
      // they may not touch from one that does not exist.
      expect(reworded.status).toBe(500)
    })

    it('is satisfied by the sniff today, which is what the cases above rely on', async () => {
      const statusless = await observed(() => {
        throw new Error('Project not found')
      })
      const explicit = await observed(() => {
        throw Object.assign(new Error('Project not found'), { status: 404 })
      })
      // The load-bearing equivalence, asserted rather than assumed. If this ever
      // goes red, every Tier A assertion in every wave has quietly stopped
      // meaning what it says.
      expect(statusless).toEqual(explicit)
    })
  })
})
