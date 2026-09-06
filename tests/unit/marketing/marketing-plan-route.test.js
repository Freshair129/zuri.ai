import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeViewer } from '../../factories/viewer'

// @req FR-159 — route handlers resolve the trusted viewer, preserve the strict
// request contract and delegate all persistence/authorization to the service.
// @spec SDD-086, BR-001, SEC-001, SEC-008
// @tested tests/unit/marketing/marketing-plan-route.test.js

const {
  archiveMarketingPlan,
  createMarketingPlan,
  decideMarketingPlan,
  getMarketingPlan,
  listMarketingPlans,
  reviseMarketingPlan,
  reviewMarketingPlan,
  resolveRequestViewer,
  createMarketingPlanRepository,
  prismaClient,
} = vi.hoisted(() => ({
  archiveMarketingPlan: vi.fn(),
  createMarketingPlan: vi.fn(),
  decideMarketingPlan: vi.fn(),
  getMarketingPlan: vi.fn(),
  listMarketingPlans: vi.fn(),
  reviseMarketingPlan: vi.fn(),
  reviewMarketingPlan: vi.fn(),
  resolveRequestViewer: vi.fn(),
  createMarketingPlanRepository: vi.fn(),
  prismaClient: { marker: 'marketing-prisma' },
}))

vi.mock('@/lib/db', () => ({ default: prismaClient }))
vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer }))
vi.mock('@/modules/marketing/infrastructure/marketing-plan-repository', () => ({
  createMarketingPlanRepository,
}))
vi.mock('@/modules/marketing/application/marketing-plan-service', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    archiveMarketingPlan,
    createMarketingPlan,
    decideMarketingPlan,
    getMarketingPlan,
    listMarketingPlans,
    reviseMarketingPlan,
    reviewMarketingPlan,
  }
})

const { GET: listRoute, POST: createRoute } = await import('@/app/api/growth/plans/route')
const { GET: detailRoute, PATCH: patchRoute } = await import('@/app/api/growth/plans/[id]/route')

const viewer = makeViewer({
  principal: { id: 'route-owner' },
  visibleBusinessIds: ['b-1'],
  ownedBusinessIds: ['b-1'],
  visibleDomains: ['projects', 'people', 'platform', 'growth'],
})

const payload = {
  objective: 'Objective',
  situation: 'Situation',
  audience: 'Audience',
  channels: ['SEO'],
  budget: 1,
  currency: 'THB',
  successMetric: 'Leads',
  actions: [{ title: 'Action' }],
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
  listMarketingPlans.mockResolvedValue({ plans: [], canWrite: true })
  createMarketingPlan.mockResolvedValue({ id: 'plan-1' })
  getMarketingPlan.mockResolvedValue({ id: 'plan-1', canWrite: true })
  reviseMarketingPlan.mockResolvedValue({ id: 'plan-1', currentRevision: 2 })
  reviewMarketingPlan.mockResolvedValue({ id: 'plan-1', reviews: [] })
  decideMarketingPlan.mockResolvedValue({ id: 'plan-1', decisions: [] })
  archiveMarketingPlan.mockResolvedValue({ id: 'plan-1', status: 'ARCHIVED' })
})

describe('Marketing plan API routes', () => {
  it('passes the resolved viewer and Business query to the collection reader', async () => {
    const response = await listRoute(request('http://local/api/growth/plans?businessId=b-1'))
    expect(listMarketingPlans).toHaveBeenCalledWith(
      { viewer, businessId: 'b-1' },
      { db: prismaClient, createRepository: createMarketingPlanRepository },
    )
    expect(response.status).toBe(200)
  })

  it('passes the strict create body to the application service', async () => {
    const body = { businessId: 'b-1', title: 'Plan', payload }
    const response = await createRoute(request('http://local/api/growth/plans', { method: 'POST', body }))
    expect(createMarketingPlan).toHaveBeenCalledWith(body, {
      db: prismaClient,
      viewer,
      createRepository: createMarketingPlanRepository,
    })
    expect(response.status).toBe(200)
  })

  it('re-resolves Business scope for detail reads', async () => {
    const response = await detailRoute(
      request('http://local/api/growth/plans/plan-1?businessId=b-1'),
      { params: { id: 'plan-1' } },
    )
    expect(getMarketingPlan).toHaveBeenCalledWith(
      { viewer, businessId: 'b-1', planId: 'plan-1' },
      { db: prismaClient, createRepository: createMarketingPlanRepository },
    )
    expect(response.status).toBe(200)
  })

  it('dispatches every PATCH action without creating another writer', async () => {
    const base = { businessId: 'b-1', expectedVersion: 1 }
    await patchRoute(
      request('http://local/api/growth/plans/plan-1', {
        method: 'PATCH', body: { ...base, action: 'revise', title: 'v2', payload },
      }),
      { params: { id: 'plan-1' } },
    )
    await patchRoute(
      request('http://local/api/growth/plans/plan-1', {
        method: 'PATCH', body: {
          ...base, action: 'review', planVersionId: 'version-1', payloadHash: 'a'.repeat(64),
          verdict: 'PASS', rationale: 'Looks good',
        },
      }),
      { params: { id: 'plan-1' } },
    )
    await patchRoute(
      request('http://local/api/growth/plans/plan-1', {
        method: 'PATCH', body: {
          ...base, action: 'decide', planVersionId: 'version-1', payloadHash: 'a'.repeat(64),
          reviewId: 'review-1', verdict: 'REJECT', rationale: 'Needs more evidence',
        },
      }),
      { params: { id: 'plan-1' } },
    )
    await patchRoute(
      request('http://local/api/growth/plans/plan-1', {
        method: 'PATCH', body: { ...base, action: 'archive' },
      }),
      { params: { id: 'plan-1' } },
    )

    expect(reviseMarketingPlan).toHaveBeenCalledTimes(1)
    expect(reviewMarketingPlan).toHaveBeenCalledTimes(1)
    expect(decideMarketingPlan).toHaveBeenCalledTimes(1)
    expect(archiveMarketingPlan).toHaveBeenCalledTimes(1)
    expect(archiveMarketingPlan).toHaveBeenCalledWith('plan-1', { ...base, action: 'archive' }, expect.any(Object))
  })

  it('returns the trusted authentication refusal before reaching the service', async () => {
    resolveRequestViewer.mockRejectedValue(Object.assign(new Error('AUTH_REQUIRED'), { status: 401 }))
    const response = await listRoute(request('http://local/api/growth/plans?businessId=b-1'))
    expect(response.status).toBe(401)
    expect(listMarketingPlans).not.toHaveBeenCalled()
  })
})

