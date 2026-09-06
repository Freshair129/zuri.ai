import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeViewer } from '../../factories/viewer'

// @req FR-157 — the Content reference route uses trusted request identity and
// delegates list/read semantics to the owner-reference application port.
// @spec SDD-088, SEC-001, SEC-008
// @tested tests/unit/marketing/marketing-content-references-route.test.js

const {
  listMarketingContentReferences,
  resolveRequestViewer,
  prismaClient,
} = vi.hoisted(() => ({
  listMarketingContentReferences: vi.fn(),
  resolveRequestViewer: vi.fn(),
  prismaClient: { marker: 'content-reference-prisma' },
}))

vi.mock('@/lib/db', () => ({ default: prismaClient }))
vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer }))
vi.mock('@/modules/marketing/application/marketing-content-references', () => ({
  listMarketingContentReferences,
}))

const { GET } = await import('@/app/api/growth/content/references/route')

const viewer = makeViewer({
  principal: { id: 'content-route-owner' },
  visibleBusinessIds: ['business-1'],
  ownedBusinessIds: ['business-1'],
  visibleDomains: ['growth'],
})

function request(url) {
  return new Request(url)
}

beforeEach(() => {
  vi.clearAllMocks()
  resolveRequestViewer.mockResolvedValue(viewer)
  listMarketingContentReferences.mockResolvedValue({ files: [], projects: [], workItems: [], truncated: { files: false, projects: false, workItems: false } })
})

describe('Marketing Content reference API route', () => {
  it('delegates a bounded collection read with the trusted viewer and selected Project', async () => {
    const response = await GET(request('http://local/api/growth/content/references?businessId=business-1&projectId=project-1'))

    expect(listMarketingContentReferences).toHaveBeenCalledWith(
      { viewer, businessId: 'business-1', projectId: 'project-1' },
      { db: prismaClient },
    )
    expect(response.status).toBe(200)
  })

  it('returns the trusted authentication refusal before reaching the owner port', async () => {
    resolveRequestViewer.mockRejectedValue(Object.assign(new Error('AUTH_REQUIRED'), { status: 401 }))

    const response = await GET(request('http://local/api/growth/content/references?businessId=business-1'))

    expect(response.status).toBe(401)
    expect(listMarketingContentReferences).not.toHaveBeenCalled()
  })
})
