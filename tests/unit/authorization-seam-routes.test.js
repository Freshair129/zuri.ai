// @req FR-010, FR-011, FR-013, FR-014, FR-017, FR-019, FR-020, FR-040
// @spec SEC-001, SEC-008 — protected reads resolve one trusted viewer and fail
// closed before an unscoped read model is allowed to run.
// @tested tests/unit/authorization-seam-routes.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeOperatorViewer, makeViewer } from '../factories/viewer'

const mocks = vi.hoisted(() => ({
  resolveRequestViewer: vi.fn(),
  listAudit: vi.fn(),
  exportSnapshot: vi.fn(),
  computePortfolioProgress: vi.fn(),
  computeProjectProgress: vi.fn(),
  computeWorkstreamProgress: vi.fn(),
  getProjectDependencyGraph: vi.fn(),
  lookupExternalRef: vi.fn(),
  listExternalRefs: vi.fn(),
  prisma: {
    project: { findUnique: vi.fn() },
    workstream: { findUnique: vi.fn() },
  },
}))

vi.mock('@/modules/identity/request-viewer', () => ({
  resolveRequestViewer: mocks.resolveRequestViewer,
}))
vi.mock('@/modules/project-manager/application/audit', () => ({
  listAudit: mocks.listAudit,
}))
vi.mock('@/modules/project-manager/application/backup-service', () => ({
  exportSnapshot: mocks.exportSnapshot,
}))
vi.mock('@/modules/project-manager/application/progress-service', () => ({
  computePortfolioProgress: mocks.computePortfolioProgress,
  computeProjectProgress: mocks.computeProjectProgress,
  computeWorkstreamProgress: mocks.computeWorkstreamProgress,
}))
vi.mock('@/modules/project-manager/application/dependency-service', () => ({
  getProjectDependencyGraph: mocks.getProjectDependencyGraph,
}))
vi.mock('@/modules/project-manager/import/external-ref', () => ({
  lookupExternalRef: mocks.lookupExternalRef,
  listExternalRefs: mocks.listExternalRefs,
}))
vi.mock('@/lib/db', () => ({ default: mocks.prisma }))

const [auditRoute, backupRoute, portfolioRoute, projectProgressRoute, workstreamProgressRoute, dependencyRoute, treeRoute, resolveRoute] =
  await Promise.all([
    import('@/app/api/audit/route'),
    import('@/app/api/backup/export/route'),
    import('@/app/api/progress/portfolio/route'),
    import('@/app/api/progress/project/[id]/route'),
    import('@/app/api/progress/workstream/[id]/route'),
    import('@/app/api/projects/[id]/dependencies/route'),
    import('@/app/api/projects/[id]/tree/route'),
    import('@/app/api/resolve/route'),
  ])

const viewerA = makeViewer({ visibleBusinessIds: ['business-a'], ownedBusinessIds: ['business-a'] })
const viewerB = makeViewer({ visibleBusinessIds: ['business-b'], ownedBusinessIds: ['business-b'] })
const operator = makeOperatorViewer({ visibleBusinessIds: [], ownedBusinessIds: [] })
const request = (url) => new Request(`http://localhost${url}`)

const businessProject = (businessId = 'business-a') => ({
  id: 'project-a',
  code: 'PRJ-A',
  deletedAt: null,
  businessId,
  business: { tenantId: 'tenant-a' },
  workspace: { businessId, scopeType: 'BUSINESS', tenantId: 'tenant-a', portfolioId: 'portfolio-a' },
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listAudit.mockResolvedValue([])
  mocks.exportSnapshot.mockResolvedValue({ schemaVersion: '1.0', tables: {} })
  mocks.computePortfolioProgress.mockResolvedValue({ businesses: [], group: null, total: {} })
  mocks.computeProjectProgress.mockResolvedValue({ projectId: 'project-a' })
  mocks.computeWorkstreamProgress.mockResolvedValue({ workstreamId: 'workstream-a' })
  mocks.getProjectDependencyGraph.mockResolvedValue({ projectId: 'project-a', nodes: [], edges: [] })
  mocks.listExternalRefs.mockResolvedValue([])
  mocks.lookupExternalRef.mockResolvedValue(null)
  mocks.prisma.project.findUnique.mockResolvedValue(businessProject())
  mocks.prisma.workstream.findUnique.mockResolvedValue({
    id: 'workstream-a',
    deletedAt: null,
    project: businessProject(),
  })
})

describe('authorization seam route guards', () => {
  it('denies an ordinary viewer before installation-wide audit reads', async () => {
    mocks.resolveRequestViewer.mockResolvedValue(viewerA)

    const response = await auditRoute.GET(request('/api/audit'))

    expect(response.status).toBe(403)
    expect(mocks.listAudit).not.toHaveBeenCalled()
  })

  it('allows the installation operator to read audit events', async () => {
    mocks.resolveRequestViewer.mockResolvedValue(operator)

    const response = await auditRoute.GET(request('/api/audit'))

    expect(response.status).toBe(200)
    expect(mocks.listAudit).toHaveBeenCalledOnce()
  })

  it('denies an ordinary viewer before whole-installation backup export', async () => {
    mocks.resolveRequestViewer.mockResolvedValue(viewerA)

    const response = await backupRoute.GET(request('/api/backup/export'))

    expect(response.status).toBe(403)
    expect(mocks.exportSnapshot).not.toHaveBeenCalled()
  })

  it('denies an ordinary viewer before the whole-portfolio progress read', async () => {
    mocks.resolveRequestViewer.mockResolvedValue(viewerA)

    const response = await portfolioRoute.GET(request('/api/progress/portfolio'))

    expect(response.status).toBe(403)
    expect(mocks.computePortfolioProgress).not.toHaveBeenCalled()
  })

  it('denies a cross-business project progress read before computation', async () => {
    mocks.resolveRequestViewer.mockResolvedValue(viewerB)
    mocks.prisma.project.findUnique.mockResolvedValue(businessProject())

    const response = await projectProgressRoute.GET(request('/api/progress/project/project-a'), {
      params: { id: 'project-a' },
    })

    expect(response.status).toBe(404)
    expect(mocks.computeProjectProgress).not.toHaveBeenCalled()
  })

  it('denies a cross-business workstream progress read before computation', async () => {
    mocks.resolveRequestViewer.mockResolvedValue(viewerB)

    const response = await workstreamProgressRoute.GET(request('/api/progress/workstream/workstream-a'), {
      params: { id: 'workstream-a' },
    })

    expect(response.status).toBe(404)
    expect(mocks.computeWorkstreamProgress).not.toHaveBeenCalled()
  })

  it('denies a cross-business dependency graph read before graph traversal', async () => {
    mocks.resolveRequestViewer.mockResolvedValue(viewerB)

    const response = await dependencyRoute.GET(request('/api/projects/project-a/dependencies'), {
      params: { id: 'project-a' },
    })

    expect(response.status).toBe(404)
    expect(mocks.getProjectDependencyGraph).not.toHaveBeenCalled()
  })

  it('denies a cross-business project tree read before loading its children', async () => {
    mocks.resolveRequestViewer.mockResolvedValue(viewerB)

    const response = await treeRoute.GET(request('/api/projects/project-a/tree'), {
      params: { id: 'project-a' },
    })

    expect(response.status).toBe(404)
    expect(mocks.prisma.project.findUnique).toHaveBeenCalledOnce()
  })

  it('denies a cross-business human-code resolve before listing external refs', async () => {
    mocks.resolveRequestViewer.mockResolvedValue(viewerB)

    const response = await resolveRoute.GET(request('/api/resolve?type=PROJECT&code=PRJ-A'))

    expect(response.status).toBe(404)
    expect(mocks.listExternalRefs).not.toHaveBeenCalled()
  })

  it('allows an owner to read a project progress result after scope verification', async () => {
    mocks.resolveRequestViewer.mockResolvedValue(viewerA)

    const response = await projectProgressRoute.GET(request('/api/progress/project/project-a'), {
      params: { id: 'project-a' },
    })

    expect(response.status).toBe(200)
    expect(mocks.computeProjectProgress).toHaveBeenCalledWith('project-a')
  })
})
