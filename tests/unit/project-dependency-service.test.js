// @req FR-040 - the Project Dependency Map is contained by both endpoints.
// @spec SDD-019, ADR-012
// @tested tests/unit/project-dependency-service.test.js
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { PROJECT_A, PROJECT_DEPENDENCY_FIXTURES } from '../fixtures/project-dependency-map'

const { prisma } = vi.hoisted(() => ({
  prisma: {
    project: { findUnique: vi.fn(), findMany: vi.fn() },
    dependency: { findMany: vi.fn() },
    workstream: { findMany: vi.fn(), findUnique: vi.fn() },
    milestone: { findMany: vi.fn(), findUnique: vi.fn() },
    gate: { findMany: vi.fn(), findUnique: vi.fn() },
    workContainer: { findMany: vi.fn(), findUnique: vi.fn() },
    workItem: { findMany: vi.fn(), findUnique: vi.fn() },
  },
}))

vi.mock('@/lib/db', () => ({ default: prisma }))

const { getProjectDependencyGraph, listDependencies } = await import(
  '@/modules/project-manager/application/dependency-service'
)

describe('project dependency read service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prisma.project.findUnique.mockResolvedValue({ id: PROJECT_A.id })
    prisma.dependency.findMany.mockResolvedValue(PROJECT_DEPENDENCY_FIXTURES)
    prisma.workstream.findMany.mockResolvedValue([{ id: 'stream-a' }])
    prisma.milestone.findMany.mockResolvedValue([])
    prisma.gate.findMany.mockResolvedValue([])
    prisma.workContainer.findMany.mockResolvedValue([])
    prisma.workItem.findMany.mockResolvedValue([{ id: 'item-a-1' }, { id: 'item-a-2' }])
    prisma.workstream.findUnique.mockImplementation(async ({ where }) => {
      if (where.id === 'stream-a') return { id: 'stream-a', code: 'WS-A', title: 'Project A delivery' }
      if (where.id === 'stream-b') return { id: 'stream-b', code: 'WS-B', title: 'Project B delivery' }
      return null
    })
    prisma.workItem.findUnique.mockImplementation(async ({ where }) => {
      const item = {
        'item-a-1': { id: 'item-a-1', code: 'WI-A1', title: 'Design', status: 'DONE' },
        'item-a-2': { id: 'item-a-2', code: 'WI-A2', title: 'Build', status: 'IN_PROGRESS' },
      }
      return item[where.id] || null
    })
  })

  it('returns only edges whose source and target belong to the opened project', async () => {
    const graph = await getProjectDependencyGraph(PROJECT_A.id)

    expect(graph).toEqual({
      version: '1.0',
      projectId: 'project-a',
      nodes: [
        { id: 'WORK_ITEM:item-a-1', type: 'WORK_ITEM', code: 'WI-A1', title: 'Design', status: 'DONE' },
        { id: 'WORK_ITEM:item-a-2', type: 'WORK_ITEM', code: 'WI-A2', title: 'Build', status: 'IN_PROGRESS' },
      ],
      edges: [
        {
          id: 'dep-a-internal',
          source: 'WORK_ITEM:item-a-1',
          target: 'WORK_ITEM:item-a-2',
          dependencyType: 'BLOCKS',
          label: 'BLOCKS',
        },
      ],
    })
  })

  it('keeps the existing global project filter semantics unchanged', async () => {
    const dependencies = await listDependencies({ projectId: PROJECT_A.id })

    expect(dependencies.map((dependency) => dependency.id)).toEqual(['dep-a-internal', 'dep-cross-project'])
  })

  it('keeps only dependencies whose two endpoints are inside the Business scope', async () => {
    prisma.project.findMany.mockResolvedValue([{ id: PROJECT_A.id }])

    const dependencies = await listDependencies({ businessId: 'business-a' })

    expect(dependencies.map((dependency) => dependency.id)).toEqual(['dep-a-internal'])
  })

  it('rejects an unknown project before projecting dependencies', async () => {
    prisma.project.findUnique.mockResolvedValue(null)

    await expect(getProjectDependencyGraph('missing-project')).rejects.toThrow('Project not found')
    expect(prisma.dependency.findMany).not.toHaveBeenCalled()
  })
})
