// @req FR-040 - the Project Dependency Map API returns the contained graph DTO.
// @spec SDD-019, ADR-012
// @tested tests/unit/project-dependency-route.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeViewer } from '../factories/viewer'

const { getProjectDependencyGraph, resolveRequestViewer, findProject } = vi.hoisted(() => ({
  getProjectDependencyGraph: vi.fn(),
  resolveRequestViewer: vi.fn(),
  findProject: vi.fn(),
}))

vi.mock('@/modules/project-manager/application/dependency-service', () => ({ getProjectDependencyGraph }))
vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer }))
vi.mock('@/lib/db', () => ({ default: { project: { findUnique: findProject } } }))

const { GET } = await import('@/app/api/projects/[id]/dependencies/route')

beforeEach(() => {
  vi.clearAllMocks()
  resolveRequestViewer.mockResolvedValue(makeViewer({ visibleBusinessIds: ['business-a'], ownedBusinessIds: ['business-a'] }))
  findProject.mockResolvedValue({
    id: 'project-a',
    deletedAt: null,
    businessId: 'business-a',
    business: { tenantId: 'tenant-a' },
    workspace: { businessId: 'business-a', scopeType: 'BUSINESS', tenantId: 'tenant-a', portfolioId: 'portfolio-a' },
  })
})

describe('GET /api/projects/:id/dependencies', () => {
  it('delegates to the project-contained read model and returns its DTO', async () => {
    const graph = { version: '1.0', projectId: 'project-a', nodes: [], edges: [] }
    getProjectDependencyGraph.mockResolvedValue(graph)

    const response = await GET(new Request('http://localhost/api/projects/project-a/dependencies'), {
      params: { id: 'project-a' },
    })

    expect(getProjectDependencyGraph).toHaveBeenCalledWith('project-a')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(graph)
  })

  it('maps a missing project to a not-found response', async () => {
    findProject.mockResolvedValue(null)

    const response = await GET(new Request('http://localhost/api/projects/missing/dependencies'), {
      params: { id: 'missing' },
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Project not found' })
  })
})
