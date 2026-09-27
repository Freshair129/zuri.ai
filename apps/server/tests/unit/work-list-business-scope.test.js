// @req FR-005, FR-046 — a work list narrowed by `businessId` must be a Business the viewer can see.
// @spec SEC-001, SEC-008
// @tested tests/unit/work-list-business-scope.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeOperatorViewer, makeViewer, ownsElsewhere } from '../factories/viewer'

const mocks = vi.hoisted(() => ({
  viewer: null,
  listWork: vi.fn(async () => []),
}))

vi.mock('@/modules/identity/request-viewer', () => ({
  resolveRequestViewer: vi.fn(async () => mocks.viewer),
}))
vi.mock('@/modules/project-manager/application/work-service', () => ({
  listWork: mocks.listWork,
  createItem: vi.fn(),
}))
vi.mock('@/modules/project-manager/application/work-read-service', () => ({
  assertProjectVisibleForWorkRead: vi.fn(async () => {}),
  assertWorkstreamVisibleForWorkRead: vi.fn(async () => {}),
}))

const { GET } = await import('@/app/api/work/route')
const list = (query) => GET(new Request(`http://localhost/api/work?${query}`))

describe('GET /api/work businessId scope', () => {
  beforeEach(() => { mocks.listWork.mockClear() })

  it('refuses a Business the viewer cannot see, without reading any WorkItem', async () => {
    mocks.viewer = makeViewer({ visibleBusinessIds: ['business-a'], ownedBusinessIds: ['business-a'] })
    const response = await list('businessId=business-b')
    expect(response.status).toBe(404)
    expect(mocks.listWork).not.toHaveBeenCalled()
  })

  it('refuses another Business even when combined with a visible project filter', async () => {
    mocks.viewer = makeViewer({ visibleBusinessIds: ['business-a'], ownedBusinessIds: ['business-a'] })
    const response = await list('projectId=prj-a&businessId=business-b')
    expect(response.status).toBe(404)
    expect(mocks.listWork).not.toHaveBeenCalled()
  })

  it('lists a Business the viewer merely sees (member elsewhere) and narrows to it', async () => {
    mocks.viewer = ownsElsewhere({ owns: 'business-a', sees: 'business-b' })
    const response = await list('businessId=business-b')
    expect(response.status).toBe(200)
    expect(mocks.listWork).toHaveBeenCalledWith(expect.objectContaining({ businessIds: ['business-b'] }))
  })

  it('keeps the installation operator able to narrow to any Business', async () => {
    mocks.viewer = makeOperatorViewer()
    const response = await list('businessId=business-z')
    expect(response.status).toBe(200)
    expect(mocks.listWork).toHaveBeenCalledWith(expect.objectContaining({ businessIds: ['business-z'] }))
  })
})
