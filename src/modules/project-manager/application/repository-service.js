import prisma from '@/lib/db'
import { uniqueHumanCode } from '@/lib/ids'
import { zRepositoryInput, zProjectRepositoryInput } from '@/lib/validation/entities'
import { recordAudit } from './audit'
import { assertProjectWritable, assertRepositoryWritable } from './project-authorization'
import { ownsBusiness, seesBusiness } from '@/modules/identity/viewer-authority'

// @req FR-008 — repository records + many-to-many project links
// @req FR-072 — linkRepository/unlinkRepository refuse the write unless the
// viewer owns the Business governing the Project.
// @req FR-073 — a Repository is owned by one Business. That answered the
// question that kept createRepository/updateRepository on the route-viewer
// baseline: with no scope field there was no argument to give `ownsBusiness`,
// and deriving authority from the repo's *links* fails open — a fresh
// Repository has no links, so a links-conjunction is vacuously true, i.e.
// "any authenticated caller".
// @spec BR-002 — externalRepoId is an external identifier, never an internal PK
// @spec SEC-001, SEC-008, BR-001
// @tested tests/integration/project-core.test.js
// @tested tests/integration/fr072-repository-link-authorization.test.js
// @tested tests/integration/fr073-repository-scope.test.js
// Repository tracking is local metadata only in MVP — no GitHub API access.

const codeExists = async (code) => Boolean(await prisma.repository.findUnique({ where: { code } }))

/**
 * Repositories the viewer may see.
 *
 * @req FR-073 — previously this returned every Repository in the installation,
 * across every tenant, with each one's project links attached: a cross-tenant
 * read with no scope at all. It is the read half of the same missing field.
 *
 * `seesBusiness`, not `ownsBusiness` — deciding what may be *shown* is strictly
 * weaker than deciding what may be *changed*. A Repository with no owning
 * Business is visible to nobody, which is the same fail-closed answer the write
 * path gives it.
 */
export async function listRepositories({ viewer } = {}) {
  const repositories = await prisma.repository.findMany({
    orderBy: { code: 'asc' },
    include: { projects: { include: { project: { select: { id: true, code: true, name: true } } } } },
  })
  return repositories.filter((repo) => seesBusiness(viewer, repo.businessId))
}

export async function createRepository(input, { viewer } = {}) {
  const data = zRepositoryInput.parse(input)
  // The Business is required on the way in, so every Repository created from
  // here forward is governed. Only rows predating FR-073 can be ownerless.
  if (!ownsBusiness(viewer, data.businessId)) {
    // Same answer an unknown Business would give: naming which Businesses exist
    // is not this endpoint's job.
    const error = new Error('Business not found')
    error.status = 404
    throw error
  }
  const code = data.code || (await uniqueHumanCode('REP', data.repoName || data.fullName || data.provider, codeExists))
  const repo = await prisma.repository.create({
    data: {
      code,
      businessId: data.businessId,
      provider: data.provider,
      externalRepoId: data.externalRepoId ?? null,
      ownerName: data.ownerName ?? null,
      repoName: data.repoName ?? null,
      fullName: data.fullName ?? null,
      url: data.url ?? null,
      defaultBranch: data.defaultBranch ?? null,
      status: data.status || 'ACTIVE',
    },
  })
  await recordAudit(prisma, { entityType: 'REPOSITORY', entityId: repo.id, action: 'CREATED', payload: { code } })
  return repo
}

export async function updateRepository(id, patch, { viewer } = {}) {
  // Load-then-authorize through the shared helper: it resolves the record,
  // refuses an unowned one exactly as it refuses an absent one, and refuses an
  // ownerless one for everybody with the reason named.
  const existing = await assertRepositoryWritable(viewer, id)
  const repo = await prisma.repository.update({
    where: { id },
    data: {
      provider: patch.provider ?? existing.provider,
      externalRepoId: patch.externalRepoId === undefined ? existing.externalRepoId : patch.externalRepoId,
      ownerName: patch.ownerName === undefined ? existing.ownerName : patch.ownerName,
      repoName: patch.repoName === undefined ? existing.repoName : patch.repoName,
      fullName: patch.fullName === undefined ? existing.fullName : patch.fullName,
      url: patch.url === undefined ? existing.url : patch.url,
      defaultBranch: patch.defaultBranch === undefined ? existing.defaultBranch : patch.defaultBranch,
      status: patch.status ?? existing.status,
    },
  })
  await recordAudit(prisma, { entityType: 'REPOSITORY', entityId: id, action: 'UPDATED', payload: patch })
  return repo
}

export async function linkRepository(input, { viewer } = {}) {
  const data = zProjectRepositoryInput.parse(input)
  const [project, repo] = await Promise.all([
    prisma.project.findUnique({ where: { id: data.projectId } }),
    prisma.repository.findUnique({ where: { id: data.repoId } }),
  ])
  if (!project || project.deletedAt) throw new Error('Project not found')
  if (!repo) throw new Error('Repository not found')
  // @req FR-073 — a link touches two governed scopes, so it takes the declared
  // authority over both. Same fail-closed composition FR-072 applies to a
  // Dependency edge; before Repository had an owner, only the Project half was
  // checkable, which let an owner of one Business attach another Business's
  // Repository to their Project.
  await assertProjectWritable(viewer, data.projectId)
  await assertRepositoryWritable(viewer, data.repoId)
  const link = await prisma.projectRepository.create({
    data: {
      projectId: data.projectId,
      repoId: data.repoId,
      role: data.role || 'PRIMARY',
      pathScope: data.pathScope ?? null,
      branch: data.branch ?? null,
    },
  })
  await recordAudit(prisma, {
    entityType: 'PROJECT_REPOSITORY',
    entityId: link.id,
    action: 'LINKED',
    payload: { projectId: data.projectId, repoId: data.repoId, role: data.role },
  })
  return link
}

export async function unlinkRepository(linkId, { viewer } = {}) {
  const existing = await prisma.projectRepository.findUnique({ where: { id: linkId } })
  if (!existing) {
    // Today a missing id reaches prisma.delete() and crashes on P2025 —
    // effectively a 500. Loading first and failing closed here is the fix;
    // explicit status (not message-sniffing) matches the not-found-refusal
    // shape already used for a resolved-but-unauthorized target below.
    const error = new Error('Repository link not found')
    error.status = 404
    throw error
  }
  await assertProjectWritable(viewer, existing.projectId, { notFoundMessage: 'Repository link not found' })
  const link = await prisma.projectRepository.delete({ where: { id: linkId } })
  await recordAudit(prisma, { entityType: 'PROJECT_REPOSITORY', entityId: linkId, action: 'UNLINKED' })
  return link
}
