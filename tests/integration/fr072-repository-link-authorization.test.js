import { describe, it, expect, beforeAll } from 'vitest'
import { makeViewer, ownsElsewhere, makeDevViewer } from '../factories/viewer'
import {
  createPortfolio,
  createTenant,
  createBusiness,
  createWorkspace,
} from '@/modules/project-manager/application/scope-service'
import { createProject } from '@/modules/project-manager/application/project-service'
import {
  createRepository,
  linkRepository,
  unlinkRepository,
} from '@/modules/project-manager/application/repository-service'
import prisma from '@/lib/db'

// @req FR-072 — repository link/unlink mutations refuse the write unless the
// viewer owns the Business governing the target Project. `createRepository`
// and `updateRepository` are BLOCKED (plan §BLOCKED B3/B4 — the Repository
// model carries no scope field at all) and are untouched by this wave; this
// file exercises only `linkRepository` and `unlinkRepository`.
// @spec SEC-001, SEC-008, BR-001
// @tested tests/integration/fr072-repository-link-authorization.test.js

let business, otherBusiness, workspace, project, repo
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

describe('FR-072 repository link authorization', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'Repo Authz Group', code: 'PF-REPOAUTHZ' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'Repo Authz Tenant', code: 'TNT-REPOAUTHZ' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Repo Authz Business', code: 'BUS-REPOAUTHZ' })
    otherBusiness = await createBusiness({ tenantId: tenant.id, name: 'Repo Other Business', code: 'BUS-REPOAUTHZ-2' })

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
      name: 'Repo Authz WS', scopeType: 'BUSINESS', businessId: business.id, code: 'WS-REPOAUTHZ',
    })
    project = await createProject({ workspaceId: workspace.id, name: 'Repo Authz Project', code: 'PRJ-REPOAUTHZ' }, { viewer: owner })

    // Repository records carry no scope at all — createRepository is BLOCKED
    // and stays unguarded; a repo is a plain fixture here.
    repo = await createRepository({ provider: 'github', repoName: 'authz-repo', code: 'REP-AUTHZ' })

    // A Project in a PORTFOLIO-scoped Space: businessId is null all the way
    // down, so no Business governs it — the Tier B / FR-072(b) case.
    sharedWorkspace = await createWorkspace({
      name: 'Repo Shared WS', scopeType: 'PORTFOLIO', portfolioId: portfolio.id, code: 'WS-REPOAUTHZ-SHARED',
    })
    // FR-072(b): createProject now refuses this for every principal (a
    // PORTFOLIO-scoped Workspace is governed by no Business), so this fixture
    // — which exists only to give the Tier B test below a shared Project to
    // authorize against — is built directly with Prisma instead of going
    // through the now-guarded service. Arrangement, not subject: production
    // has exactly this state, seeded as WS-PLATFORM.
    sharedProject = await prisma.project.create({
      data: { code: 'PRJ-REPOAUTHZ-SHARED', workspaceId: sharedWorkspace.id, name: 'Repo Shared Project' },
    })
  })

  describe('linkRepository', () => {
    it('refuses the attacker and permits the owner on the same target', async () => {
      const before = await prisma.projectRepository.count()
      const error = await refusalFrom(() =>
        linkRepository({ projectId: project.id, repoId: repo.id }, { viewer: attacker }),
      )
      expect(error.status).toBe(404)
      expect(error.message).toBe('Project not found')
      expect(await prisma.projectRepository.count()).toBe(before)

      const link = await linkRepository({ projectId: project.id, repoId: repo.id }, { viewer: owner })
      expect(link.projectId).toBe(project.id)
      expect(link.repoId).toBe(repo.id)
    })

    it('refuses a platform DEV — seeing everything is not owning anything', async () => {
      const error = await refusalFrom(() =>
        linkRepository({ projectId: project.id, repoId: repo.id }, { viewer: dev }),
      )
      expect(error.status).toBe(404)
    })

    it('refuses an unowned real project identically to a fabricated id (no oracle)', async () => {
      const real = await refusalFrom(() =>
        linkRepository({ projectId: project.id, repoId: repo.id }, { viewer: attacker }),
      )
      const fabricated = await refusalFrom(() =>
        linkRepository({ projectId: 'no-such-project-id', repoId: repo.id }, { viewer: attacker }),
      )
      // See the milestone/gate wave's equivalent test for why raw `.status` can
      // differ (undefined vs 404) between the two call shapes at this direct
      // layer while both messages — the actual disclosure — are identical, and
      // handle()'s message-sniffing in src/app/api/_helpers.js maps both to 404
      // at the API boundary an attacker actually observes.
      expect(real.status).toBe(404)
      expect([undefined, 404]).toContain(fabricated.status)
      expect(real.message).toBe(fabricated.message)
    })

    it('refuses a shared-Space Project even for a viewer owning every Business (Tier B)', async () => {
      const before = await prisma.projectRepository.count()
      const error = await refusalFrom(() =>
        linkRepository({ projectId: sharedProject.id, repoId: repo.id }, { viewer: ownsEverything }),
      )
      expect(error.status).toBe(403)
      expect(error.message).toMatch(/cannot be authorized for any principal/)
      expect(await prisma.projectRepository.count()).toBe(before)
    })

    it('throws a wiring error, not a 4xx, when the viewer is omitted', async () => {
      const error = await refusalFrom(() => linkRepository({ projectId: project.id, repoId: repo.id }))
      expect(error.status).toBeUndefined()
      expect(error.message).toMatch(/viewer is required/)
    })
  })

  describe('unlinkRepository', () => {
    let link

    beforeAll(async () => {
      // A distinct role from the linkRepository describe block above, which
      // already links project/repo with the default PRIMARY role — the
      // (projectId, repoId, role) tuple is unique.
      link = await linkRepository({ projectId: project.id, repoId: repo.id, role: 'REFERENCE' }, { viewer: owner })
    })

    it('refuses the attacker and permits the owner on the same target', async () => {
      const before = await prisma.projectRepository.count()
      const error = await refusalFrom(() => unlinkRepository(link.id, { viewer: attacker }))
      expect(error.status).toBe(404)
      expect(error.message).toBe('Repository link not found')
      expect(await prisma.projectRepository.count()).toBe(before)

      const unlinked = await unlinkRepository(link.id, { viewer: owner })
      expect(unlinked.id).toBe(link.id)
      expect(await prisma.projectRepository.findUnique({ where: { id: link.id } })).toBeNull()
    })

    it('fails closed 404 on a missing link id instead of a raw P2025 crash', async () => {
      const error = await refusalFrom(() => unlinkRepository('no-such-link-id', { viewer: owner }))
      expect(error.status).toBe(404)
      expect(error.message).toBe('Repository link not found')
    })
  })
})
