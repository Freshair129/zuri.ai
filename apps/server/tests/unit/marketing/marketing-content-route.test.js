import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeViewer } from '../../factories/viewer'

// @req FR-157 — Content routes resolve the trusted viewer, preserve strict
// action bodies and delegate persistence/authorization to the owner service.
// @spec SDD-088, SEC-001, SEC-008
// @tested tests/unit/marketing/marketing-content-route.test.js

const {
  createMarketingContent,
  getMarketingContent,
  getMarketingContentAsset,
  listMarketingContent,
  updateMarketingContent,
  resolveRequestViewer,
  createMarketingContentRepository,
  prismaClient,
} = vi.hoisted(() => ({
  createMarketingContent: vi.fn(),
  getMarketingContent: vi.fn(),
  getMarketingContentAsset: vi.fn(),
  listMarketingContent: vi.fn(),
  updateMarketingContent: vi.fn(),
  resolveRequestViewer: vi.fn(),
  createMarketingContentRepository: vi.fn(),
  prismaClient: { marker: 'marketing-content-prisma' },
}))

vi.mock('@/lib/db', () => ({ default: prismaClient }))
vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer }))
vi.mock('@/modules/marketing/infrastructure/marketing-content-repository', () => ({ createMarketingContentRepository }))
vi.mock('@/modules/marketing/application/marketing-content-service', () => ({
  createMarketingContent,
  getMarketingContent,
  getMarketingContentAsset,
  listMarketingContent,
  updateMarketingContent,
}))

const { GET: listRoute, POST: createRoute } = await import('@/app/api/growth/content/route')
const { GET: detailRoute, PATCH: patchRoute } = await import('@/app/api/growth/content/briefs/[id]/route')
const { GET: assetRoute } = await import('@/app/api/growth/content/assets/[id]/route')

const viewer = makeViewer({
  principal: { id: 'content-route-owner' },
  visibleBusinessIds: ['b-1'],
  ownedBusinessIds: ['b-1'],
  visibleDomains: ['projects', 'people', 'platform', 'growth'],
})

const payload = {
  objective: 'Objective',
  audience: 'Audience',
  message: 'Message',
  claims: 'Claims',
  shotList: 'Shot list',
  acceptanceCriteria: 'Acceptance',
  evidenceReference: 'Evidence',
  format: 'IMAGE',
  initiativeId: null,
  channels: ['SEO'],
  asset: null,
  rights: null,
  production: null,
}

function request(url, { method = 'GET', body } = {}) {
  return new Request(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resolveRequestViewer.mockResolvedValue(viewer)
  listMarketingContent.mockResolvedValue({ briefs: [], canWrite: true, truncated: false })
  createMarketingContent.mockResolvedValue({ id: 'brief-1' })
  getMarketingContent.mockResolvedValue({ id: 'brief-1', canWrite: true })
  getMarketingContentAsset.mockResolvedValue({ assetVersion: { id: 'version-1' }, usable: false })
  updateMarketingContent.mockResolvedValue({ id: 'brief-1', phase: 'DRAFT' })
})

describe('Marketing Content API routes', () => {
  it('passes the resolved viewer and Business query to the collection reader', async () => {
    const response = await listRoute(request('http://local/api/growth/content?businessId=b-1'))
    expect(listMarketingContent).toHaveBeenCalledWith(
      { viewer, businessId: 'b-1' },
      { db: prismaClient, createRepository: createMarketingContentRepository },
    )
    expect(response.status).toBe(200)
  })

  it('passes the create body to the strict application service', async () => {
    const body = { businessId: 'b-1', title: 'Creative brief', payload }
    const response = await createRoute(request('http://local/api/growth/content', { method: 'POST', body }))
    expect(createMarketingContent).toHaveBeenCalledWith(body, {
      db: prismaClient,
      viewer,
      createRepository: createMarketingContentRepository,
    })
    expect(response.status).toBe(200)
  })

  it('re-resolves Business scope for detail and immutable asset reads', async () => {
    const response = await detailRoute(
      request('http://local/api/growth/content/briefs/brief-1?businessId=b-1'),
      { params: { id: 'brief-1' } },
    )
    expect(getMarketingContent).toHaveBeenCalledWith(
      { viewer, businessId: 'b-1', briefId: 'brief-1' },
      { db: prismaClient, createRepository: createMarketingContentRepository },
    )
    expect(response.status).toBe(200)

    const assetResponse = await assetRoute(
      request('http://local/api/growth/content/assets/version-1?businessId=b-1'),
      { params: { id: 'version-1' } },
    )
    expect(getMarketingContentAsset).toHaveBeenCalledWith(
      { viewer, businessId: 'b-1', assetId: 'version-1' },
      { db: prismaClient, createRepository: createMarketingContentRepository },
    )
    expect(assetResponse.status).toBe(200)
  })

  it('dispatches revise, review, decide and archive actions through one updater', async () => {
    const base = { businessId: 'b-1', expectedVersion: 1 }
    await patchRoute(request('http://local/api/growth/content/briefs/brief-1', {
      method: 'PATCH', body: { ...base, action: 'revise', title: 'v2', payload },
    }), { params: { id: 'brief-1' } })
    await patchRoute(request('http://local/api/growth/content/briefs/brief-1', {
      method: 'PATCH', body: {
        ...base, action: 'review', contentVersionId: 'version-1', payloadHash: 'a'.repeat(64),
        verdict: 'PASS', rationale: 'Looks good', rightsConfirmed: true, brandConfirmed: true,
      },
    }), { params: { id: 'brief-1' } })
    await patchRoute(request('http://local/api/growth/content/briefs/brief-1', {
      method: 'PATCH', body: {
        ...base, action: 'decide', contentVersionId: 'version-1', payloadHash: 'a'.repeat(64),
        reviewId: 'review-1', verdict: 'REJECT', rationale: 'Needs evidence',
      },
    }), { params: { id: 'brief-1' } })
    await patchRoute(request('http://local/api/growth/content/briefs/brief-1', {
      method: 'PATCH', body: { ...base, action: 'archive' },
    }), { params: { id: 'brief-1' } })
    expect(updateMarketingContent).toHaveBeenCalledTimes(4)
    expect(updateMarketingContent).toHaveBeenLastCalledWith('brief-1', { ...base, action: 'archive' }, expect.any(Object))
  })

  it('returns 400 for actor fields before reaching the updater', async () => {
    const response = await patchRoute(request('http://local/api/growth/content/briefs/brief-1', {
      method: 'PATCH', body: { action: 'archive', businessId: 'b-1', expectedVersion: 1, actorId: 'forged' },
    }), { params: { id: 'brief-1' } })
    expect(response.status).toBe(400)
    expect(updateMarketingContent).not.toHaveBeenCalled()
  })
})
