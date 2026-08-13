// @req FR-040 - the Project Dependency Map API returns the contained graph DTO.
// @spec SDD-019, ADR-012
// @tested tests/unit/project-dependency-route.test.js
import { describe, expect, it, vi } from 'vitest'

const { getProjectDependencyGraph } = vi.hoisted(() => ({
  getProjectDependencyGraph: vi.fn(),
}))

vi.mock('@/modules/project-manager/application/dependency-service', () => ({ getProjectDependencyGraph }))

const { GET } = await import('@/app/api/projects/[id]/dependencies/route')

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
    getProjectDependencyGraph.mockRejectedValue(new Error('Project not found'))

    const response = await GET(new Request('http://localhost/api/projects/missing/dependencies'), {
      params: { id: 'missing' },
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Project not found' })
  })
})
