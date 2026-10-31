// @req FR-046, FR-072 — Workstream reads with a Business selector must be
// narrowed server-side to a Business the viewer can see.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeOperatorViewer, makeViewer } from '../factories/viewer'

const mocks = vi.hoisted(() => ({
  viewer: null,
  listWorkstreams: vi.fn(async () => []),
  findProject: vi.fn(),
  assertProjectReadable: vi.fn(async () => {}),
}))

vi.mock('@/modules/identity/request-viewer', () => ({
  resolveRequestViewer: vi.fn(async () => mocks.viewer),
}))
vi.mock('@/modules/project-manager/application/project-service', () => ({
  listWorkstreams: mocks.listWorkstreams,
  createWorkstream: vi.fn(),
}))
vi.mock('@/modules/project-manager/application/project-inventory-read-model', () => ({
  assertProjectReadable: mocks.assertProjectReadable,
}))
vi.mock('@/lib/db', () => ({
  default: { project: { findUnique: mocks.findProject } },
}))
vi.mock('@/modules/identity/viewer-authority', () => ({
  isInstallationOperator: viewer => viewer?.isOperator === true,
  seesBusiness: (viewer, businessId) => (viewer?.visibleBusinessIds || []).includes(businessId),
}))

const { GET } = await import('@/app/api/workstreams/route')
const get = query => GET(new Request(`http://localhost/api/workstreams?${query}`))

describe('GET /api/workstreams exact Business scope', () => {
  beforeEach(() => {
    mocks.listWorkstreams.mockClear()
    mocks.findProject.mockReset()
    mocks.assertProjectReadable.mockClear()
  })

  it('filters to the selected Business and requested Operations mode', async () => {
    mocks.viewer = makeViewer({ visibleBusinessIds: ['business-a', 'business-b'] })
    const response = await get('businessId=business-b&executionMode=OPERATIONS')
    expect(response.status).toBe(200)
    expect(mocks.listWorkstreams).toHaveBeenCalledWith(expect.objectContaining({
      executionMode: 'OPERATIONS',
      businessIds: ['business-b'],
    }))
  })

  it('refuses a Business outside the viewer scope before querying Workstreams', async () => {
    mocks.viewer = makeViewer({ visibleBusinessIds: ['business-a'] })
    const response = await get('businessId=business-b&executionMode=OPERATIONS')
    expect(response.status).toBe(404)
    expect(mocks.listWorkstreams).not.toHaveBeenCalled()
  })

  it('rejects a Business selector that conflicts with an authorized Project selector', async () => {
    mocks.viewer = makeViewer({ visibleBusinessIds: ['business-a', 'business-b'] })
    mocks.findProject.mockResolvedValue({ id: 'project-a', businessId: 'business-a' })
    const response = await get('projectId=project-a&businessId=business-b&executionMode=OPERATIONS')
    expect(response.status).toBe(404)
    expect(mocks.listWorkstreams).not.toHaveBeenCalled()
  })

  it('keeps installation-operator reads narrowed when an explicit Business is requested', async () => {
    mocks.viewer = makeOperatorViewer()
    const response = await get('businessId=business-z&executionMode=OPERATIONS')
    expect(response.status).toBe(200)
    expect(mocks.listWorkstreams).toHaveBeenCalledWith(expect.objectContaining({ businessIds: ['business-z'] }))
  })
})
