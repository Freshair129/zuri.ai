import prisma from '@/lib/db'
import { uniqueHumanCode } from '@/lib/ids'
import { zRepositoryInput, zProjectRepositoryInput } from '@/lib/validation/entities'
import { recordAudit } from './audit'
import { assertProjectWritable } from './project-authorization'

// @req FR-008 — repository records + many-to-many project links
// @req FR-072 — linkRepository/unlinkRepository refuse the write unless the
// viewer owns the Business governing the Project. createRepository and
// updateRepository are BLOCKED (route-viewer-plan.md §BLOCKED B3/B4 — the
// Repository model carries no scope field at all, so no predicate can govern
// them without inventing authority) and are deliberately untouched here.
// @spec BR-002 — externalRepoId is an external identifier, never an internal PK
// @spec SEC-001, SEC-008, BR-001
// @tested tests/integration/project-core.test.js
// @tested tests/integration/fr072-repository-link-authorization.test.js
// Repository tracking is local metadata only in MVP — no GitHub API access.

const codeExists = async (code) => Boolean(await prisma.repository.findUnique({ where: { code } }))

export async function listRepositories() {
  return prisma.repository.findMany({
    orderBy: { code: 'asc' },
    include: { projects: { include: { project: { select: { id: true, code: true, name: true } } } } },
  })
}

export async function createRepository(input) {
  const data = zRepositoryInput.parse(input)
  const code = data.code || (await uniqueHumanCode('REP', data.repoName || data.fullName || data.provider, codeExists))
  const repo = await prisma.repository.create({
    data: {
      code,
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

export async function updateRepository(id, patch) {
  const existing = await prisma.repository.findUnique({ where: { id } })
  if (!existing) throw new Error('Repository not found')
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
  await assertProjectWritable(viewer, data.projectId)
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
