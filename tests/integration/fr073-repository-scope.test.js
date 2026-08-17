import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { makeViewer, ownsElsewhere, makeDevViewer } from '../factories/viewer'
import {
  createPortfolio,
  createTenant,
  createBusiness,
  createWorkspace,
} from '@/modules/project-manager/application/scope-service'
import { createProject } from '@/modules/project-manager/application/project-service'
import {
  listRepositories,
  createRepository,
  updateRepository,
  linkRepository,
} from '@/modules/project-manager/application/repository-service'

// @req FR-073 — a Repository is owned by one Business.
// @spec SEC-001, SEC-008, BR-001
//
// This is the field whose absence kept `/api/repositories` and
// `/api/repositories/[id]` on the route-viewer baseline. With no scope on the
// model there was no argument to give `ownsBusiness`, and the one derivation
// available — the repo's Project links — fails **open**: a freshly created
// Repository has no links, so a links-conjunction is vacuously true, which is
// "any authenticated caller" wearing a predicate's clothes.
//
// Every refusal below is paired with its control: the same call, the same
// target, a viewer who does own it, and it succeeds.

let businessA, businessB, projectA, projectB
let repoA, repoB, ownerlessRepo
let ownerA, ownerB, attacker, ownsBoth, dev

async function refusalFrom(fn) {
  try {
    await fn()
  } catch (error) {
    return error
  }
  throw new Error('expected the call to be refused, but it resolved')
}

describe('FR-073 Repository is owned by a Business', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'Repo Group', code: 'PF-REPO' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'Repo Tenant', code: 'TNT-REPO' })
    businessA = await createBusiness({ tenantId: tenant.id, name: 'Repo Business A', code: 'BUS-REPO-A' })
    businessB = await createBusiness({ tenantId: tenant.id, name: 'Repo Business B', code: 'BUS-REPO-B' })

    ownerA = makeViewer({ visibleBusinessIds: [businessA.id], ownedBusinessIds: [businessA.id] })
    ownerB = makeViewer({ visibleBusinessIds: [businessB.id], ownedBusinessIds: [businessB.id] })
    attacker = ownsElsewhere({ owns: businessB.id, sees: businessA.id })
    ownsBoth = makeViewer({
      visibleBusinessIds: [businessA.id, businessB.id],
      ownedBusinessIds: [businessA.id, businessB.id],
    })
    dev = makeDevViewer({ visibleBusinessIds: [businessA.id, businessB.id] })

    const wsA = await createWorkspace({
      name: 'Repo WS A', scopeType: 'BUSINESS', businessId: businessA.id, code: 'WS-REPO-A',
    })
    const wsB = await createWorkspace({
      name: 'Repo WS B', scopeType: 'BUSINESS', businessId: businessB.id, code: 'WS-REPO-B',
    })
    projectA = await createProject({ workspaceId: wsA.id, name: 'Repo Project A', code: 'PRJ-REPO-A' }, { viewer: ownerA })
    projectB = await createProject({ workspaceId: wsB.id, name: 'Repo Project B', code: 'PRJ-REPO-B' }, { viewer: ownerB })

    repoA = await createRepository(
      { businessId: businessA.id, provider: 'github', fullName: 'a/repo', code: 'REP-A' }, { viewer: ownerA },
    )
    repoB = await createRepository(
      { businessId: businessB.id, provider: 'github', fullName: 'b/repo', code: 'REP-B' }, { viewer: ownerB },
    )
    // A row from before the column existed. Planted directly because the service
    // can no longer produce one — which is the point of the field.
    ownerlessRepo = await prisma.repository.create({
      data: { code: 'REP-LEGACY', provider: 'github', fullName: 'legacy/repo' },
    })
  })

  describe('creating', () => {
    it('demands a Business at the boundary', async () => {
      await expect(
        createRepository({ provider: 'github', fullName: 'x/y', code: 'REP-NOBIZ' }, { viewer: ownerA }),
      ).rejects.toThrow(/businessId/i)
    })

    it('refuses a viewer who does not own the named Business, and permits one who does', async () => {
      const before = await prisma.repository.count()
      const error = await refusalFrom(() =>
        createRepository({ businessId: businessA.id, provider: 'github', fullName: 'x/y', code: 'REP-X' }, { viewer: attacker }),
      )
      expect(error.status).toBe(404)
      expect(await prisma.repository.count()).toBe(before)

      // The control: identical call, a viewer who owns that Business.
      const created = await createRepository(
        { businessId: businessA.id, provider: 'github', fullName: 'x/y', code: 'REP-X' }, { viewer: ownerA },
      )
      expect(created.businessId).toBe(businessA.id)
    })

    it('refuses a platform DEV — seeing every Business is not owning one', async () => {
      const error = await refusalFrom(() =>
        createRepository({ businessId: businessA.id, provider: 'github', fullName: 'd/d', code: 'REP-DEV' }, { viewer: dev }),
      )
      expect(error.status).toBe(404)
    })

    it('throws when no viewer is passed at all', async () => {
      await expect(
        createRepository({ businessId: businessA.id, provider: 'github', fullName: 'n/n', code: 'REP-NOV' }),
      ).rejects.toThrow()
    })
  })

  describe('updating', () => {
    it('refuses the attacker and permits the owner on the same repository', async () => {
      const error = await refusalFrom(() => updateRepository(repoA.id, { defaultBranch: 'hacked' }, { viewer: attacker }))
      expect(error.status).toBe(404)
      expect(error.message).toBe('Repository not found')
      const unchanged = await prisma.repository.findUnique({ where: { id: repoA.id } })
      expect(unchanged.defaultBranch).toBe(repoA.defaultBranch)

      const updated = await updateRepository(repoA.id, { defaultBranch: 'trunk' }, { viewer: ownerA })
      expect(updated.defaultBranch).toBe('trunk')
    })

    it('answers for an unowned repository exactly as for one that does not exist', async () => {
      const real = await refusalFrom(() => updateRepository(repoA.id, { defaultBranch: 'x' }, { viewer: attacker }))
      const fabricated = await refusalFrom(() => updateRepository('no-such-repo', { defaultBranch: 'x' }, { viewer: attacker }))
      expect(real.status).toBe(fabricated.status)
      expect(real.message).toBe(fabricated.message)
    })

    it('refuses an ownerless repository for every principal, naming what is missing', async () => {
      const error = await refusalFrom(() =>
        updateRepository(ownerlessRepo.id, { defaultBranch: 'x' }, { viewer: ownsBoth }),
      )
      // Not 404: this is a statement about the system, not about the caller —
      // the most privileged viewer constructible gets the same answer.
      expect(error.status).toBe(403)
      expect(error.message).toMatch(/no owning Business/)
      expect(error.message).toMatch(/backfill/)
    })
  })

  describe('listing is scoped to what the viewer may see', () => {
    it('shows a viewer their own Business only', async () => {
      const codes = (await listRepositories({ viewer: ownerA })).map((r) => r.code)
      expect(codes).toContain('REP-A')
      expect(codes).not.toContain('REP-B')
      // Ownerless is visible to nobody — the same fail-closed answer the write
      // path gives it.
      expect(codes).not.toContain('REP-LEGACY')
    })

    it('shows both to a viewer who can see both', async () => {
      const codes = (await listRepositories({ viewer: ownsBoth })).map((r) => r.code)
      expect(codes).toEqual(expect.arrayContaining(['REP-A', 'REP-B']))
    })

    it('shows nothing to a viewer with no visible Business, rather than everything', async () => {
      // The pre-FR-073 behaviour returned every Repository in the installation
      // across every tenant. A viewer scoped elsewhere is the regression probe.
      const elsewhere = makeViewer({ visibleBusinessIds: ['b-unrelated'], ownedBusinessIds: ['b-unrelated'] })
      expect(await listRepositories({ viewer: elsewhere })).toEqual([])
    })
  })

  describe('linking composes both scopes', () => {
    it('refuses a Project owner who does not own the Repository', async () => {
      const before = await prisma.projectRepository.count()
      // ownerB owns projectB, but repoA belongs to Business A.
      const error = await refusalFrom(() =>
        linkRepository({ projectId: projectB.id, repoId: repoA.id, role: 'PRIMARY' }, { viewer: ownerB }),
      )
      expect(error.status).toBe(404)
      expect(await prisma.projectRepository.count()).toBe(before)

      // The control: the same link, a viewer owning both Businesses.
      const link = await linkRepository(
        { projectId: projectB.id, repoId: repoA.id, role: 'PRIMARY' }, { viewer: ownsBoth },
      )
      expect(link.repoId).toBe(repoA.id)
    })

    it('still permits the ordinary same-Business link', async () => {
      const link = await linkRepository(
        { projectId: projectA.id, repoId: repoA.id, role: 'REFERENCE' }, { viewer: ownerA },
      )
      expect(link.projectId).toBe(projectA.id)
    })

    it('refuses linking an ownerless repository, for every principal', async () => {
      const error = await refusalFrom(() =>
        linkRepository({ projectId: projectA.id, repoId: ownerlessRepo.id, role: 'PRIMARY' }, { viewer: ownsBoth }),
      )
      expect(error.status).toBe(403)
      expect(error.message).toMatch(/no owning Business/)
    })
  })
})
