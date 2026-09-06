// @req FR-001, FR-003, FR-004, FR-005, FR-006, FR-007, FR-037, FR-046
// @spec SEC-001, SEC-008 — mixed-method route files must guard their GET
// handlers independently of guarded POST/PATCH/DELETE handlers.
// @tested tests/unit/authorization-seam-list-routes.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeViewer } from '../factories/viewer'

const mocks = vi.hoisted(() => ({
  resolveRequestViewer: vi.fn(),
  listScope: vi.fn(),
  listProjects: vi.fn(),
  listProjectsForOverview: vi.fn(),
  listProjectsForTimeline: vi.fn(),
  listProjectsForWorkspace: vi.fn(),
  getProject: vi.fn(),
  listWorkstreams: vi.fn(),
  listWork: vi.fn(),
  listMilestonesAndGates: vi.fn(),
  listDependencies: vi.fn(),
  listProjectFiles: vi.fn(),
  createProjectFile: vi.fn(),
  prisma: {
    project: { findUnique: vi.fn() },
    workstream: { findUnique: vi.fn() },
  },
}))

vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer: mocks.resolveRequestViewer }))
vi.mock('@/modules/project-manager/application/scope-service', () => ({
  listScope: mocks.listScope,
  createPortfolio: vi.fn(),
  createTenant: vi.fn(),
  createBusiness: vi.fn(),
  createBusinessInGroup: vi.fn(),
  createWorkspace: vi.fn(),
  createLegalEntity: vi.fn(),
  createBranch: vi.fn(),
}))
vi.mock('@/modules/project-manager/application/project-service', () => ({
  listProjects: mocks.listProjects,
  listProjectsForOverview: mocks.listProjectsForOverview,
  listProjectsForTimeline: mocks.listProjectsForTimeline,
  listProjectsForWorkspace: mocks.listProjectsForWorkspace,
  getProject: mocks.getProject,
  listWorkstreams: mocks.listWorkstreams,
  createWorkstream: vi.fn(),
  updateProject: vi.fn(),
  archiveProject: vi.fn(),
}))
vi.mock('@/modules/project-manager/application/work-service', () => ({
  listWork: mocks.listWork,
  createItem: vi.fn(),
}))
vi.mock('@/modules/project-manager/application/milestone-gate-service', () => ({
  listMilestonesAndGates: mocks.listMilestonesAndGates,
  createMilestone: vi.fn(),
}))
vi.mock('@/modules/project-manager/application/dependency-service', () => ({
  listDependencies: mocks.listDependencies,
  createDependency: vi.fn(),
}))
vi.mock('@/modules/project-manager/application/project-file-service', () => ({
  listProjectFiles: mocks.listProjectFiles,
  createProjectFile: mocks.createProjectFile,
}))
vi.mock('@/lib/db', () => ({ default: mocks.prisma }))

const [scopeRoute, projectsRoute, projectRoute, workstreamsRoute, workRoute, milestonesRoute, dependenciesRoute, projectFilesRoute] =
  await Promise.all([
    import('@/app/api/scope/route'),
    import('@/app/api/projects/route'),
    import('@/app/api/projects/[id]/route'),
    import('@/app/api/workstreams/route'),
    import('@/app/api/work/route'),
    import('@/app/api/milestones/route'),
    import('@/app/api/dependencies/route'),
    import('@/app/api/projects/[id]/files/route'),
  ])

const viewerB = makeViewer({ visibleBusinessIds: ['business-b'], ownedBusinessIds: ['business-b'] })
const request = (url) => new Request(`http://localhost${url}`)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveRequestViewer.mockResolvedValue(viewerB)
  mocks.prisma.project.findUnique.mockResolvedValue({
    id: 'project-a',
    deletedAt: null,
    businessId: 'business-a',
    business: { tenantId: 'tenant-a' },
    workspace: { businessId: 'business-a', scopeType: 'BUSINESS', tenantId: 'tenant-a', portfolioId: 'portfolio-a' },
  })
  mocks.prisma.workstream.findUnique.mockResolvedValue({
    id: 'workstream-a',
    deletedAt: null,
    project: {
      deletedAt: null,
      businessId: 'business-a',
      business: { tenantId: 'tenant-a' },
      workspace: { businessId: 'business-a', scopeType: 'BUSINESS', tenantId: 'tenant-a', portfolioId: 'portfolio-a' },
    },
  })
  mocks.listScope.mockResolvedValue({
    portfolios: [{ id: 'portfolio-a' }, { id: 'portfolio-b' }],
    tenants: [
      { id: 'tenant-a', portfolioId: 'portfolio-a' },
      { id: 'tenant-b', portfolioId: 'portfolio-b' },
    ],
    businesses: [
      { id: 'business-a', tenantId: 'tenant-a' },
      { id: 'business-b', tenantId: 'tenant-b' },
    ],
    workspaces: [
      { id: 'workspace-a', businessId: 'business-a', scopeType: 'BUSINESS', tenantId: 'tenant-a', portfolioId: 'portfolio-a' },
      { id: 'workspace-b', businessId: 'business-b', scopeType: 'BUSINESS', tenantId: 'tenant-b', portfolioId: 'portfolio-b' },
      { id: 'workspace-group-b', businessId: null, scopeType: 'PORTFOLIO', tenantId: null, portfolioId: 'portfolio-b' },
    ],
    projects: [
      { id: 'project-a', businessId: 'business-a', workspaceId: 'workspace-a' },
      { id: 'project-b', businessId: 'business-b', workspaceId: 'workspace-b' },
      { id: 'project-group-b', businessId: null, workspaceId: 'workspace-group-b' },
    ],
  })
})

describe('mixed-method authorization seam routes', () => {
  it('filters the compatibility scope inventory to visible Businesses and shared group work', async () => {
    const response = await scopeRoute.GET(request('/api/scope'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.businesses.map((business) => business.id)).toEqual(['business-b'])
    expect(payload.tenants.map((tenant) => tenant.id)).toEqual(['tenant-b'])
    expect(payload.workspaces.map((workspace) => workspace.id)).toEqual(['workspace-b', 'workspace-group-b'])
    expect(payload.projects.map((project) => project.id)).toEqual(['project-b', 'project-group-b'])
    expect(payload.businesses).not.toContainEqual(expect.objectContaining({ id: 'business-a' }))
  })

  it('refuses a project list filtered to another Business', async () => {
    const response = await projectsRoute.GET(request('/api/projects?businessId=business-a'))

    expect(response.status).toBe(404)
    expect(mocks.listProjects).not.toHaveBeenCalled()
  })

  it('refuses a cross-business Project read before the relation-rich service', async () => {
    const response = await projectRoute.GET(request('/api/projects/project-a'), { params: { id: 'project-a' } })

    expect(response.status).toBe(404)
    expect(mocks.getProject).not.toHaveBeenCalled()
  })

  it('refuses a cross-business Workstream list before the service', async () => {
    const response = await workstreamsRoute.GET(request('/api/workstreams?projectId=project-a'))

    expect(response.status).toBe(404)
    expect(mocks.listWorkstreams).not.toHaveBeenCalled()
  })

  it('refuses a cross-business Work list before the service', async () => {
    const response = await workRoute.GET(request('/api/work?workstreamId=workstream-a'))

    expect(response.status).toBe(404)
    expect(mocks.listWork).not.toHaveBeenCalled()
  })

  it('refuses a cross-business milestone and gate list before the service', async () => {
    const response = await milestonesRoute.GET(request('/api/milestones?projectId=project-a'))

    expect(response.status).toBe(404)
    expect(mocks.listMilestonesAndGates).not.toHaveBeenCalled()
  })

  it('refuses an unscoped dependency list for an ordinary viewer', async () => {
    const response = await dependenciesRoute.GET(request('/api/dependencies'))

    expect(response.status).toBe(403)
    expect(mocks.listDependencies).not.toHaveBeenCalled()
  })

  it('allows a visible Business-scoped dependency list', async () => {
    mocks.listDependencies.mockResolvedValueOnce([])

    const response = await dependenciesRoute.GET(request('/api/dependencies?businessId=business-b'))

    expect(response.status).toBe(200)
    expect(mocks.listDependencies).toHaveBeenCalledWith({ businessId: 'business-b' })
  })

  it('refuses an invisible Business-scoped dependency list', async () => {
    const response = await dependenciesRoute.GET(request('/api/dependencies?businessId=business-a'))

    expect(response.status).toBe(404)
    expect(mocks.listDependencies).not.toHaveBeenCalled()
  })

  it('allows a visible Business-scoped milestone and gate list', async () => {
    mocks.listMilestonesAndGates.mockResolvedValueOnce({ milestones: [], gates: [] })

    const response = await milestonesRoute.GET(request('/api/milestones?businessId=business-b'))

    expect(response.status).toBe(200)
    expect(mocks.listMilestonesAndGates).toHaveBeenCalledWith({ businessId: 'business-b' })
  })

  it('refuses an invisible Business-scoped milestone and gate list', async () => {
    const response = await milestonesRoute.GET(request('/api/milestones?businessId=business-a'))

    expect(response.status).toBe(404)
    expect(mocks.listMilestonesAndGates).not.toHaveBeenCalled()
  })

  it('passes a visible Business scope to the global timeline read', async () => {
    mocks.listProjectsForTimeline.mockResolvedValueOnce([])

    const response = await projectsRoute.GET(request('/api/projects?view=timeline&businessId=business-b'))

    expect(response.status).toBe(200)
    expect(mocks.listProjectsForTimeline).toHaveBeenCalledWith({
      businessId: 'business-b',
      limit: 500,
    })
  })

  it('refuses a cross-business Project file list before the service', async () => {
    const response = await projectFilesRoute.GET(request('/api/projects/project-a/files'), { params: { id: 'project-a' } })

    expect(response.status).toBe(404)
    expect(mocks.listProjectFiles).not.toHaveBeenCalled()
  })
})
