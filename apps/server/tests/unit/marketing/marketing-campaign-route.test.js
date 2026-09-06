import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeViewer } from '../../factories/viewer'

// @req FR-160 — Campaign routes resolve the trusted viewer and delegate strict
// input and Business authorization to the application service.
// @spec SDD-087, SEC-001, SEC-008
// @tested tests/unit/marketing/marketing-campaign-route.test.js

const {
  createMarketingCampaign,
  getMarketingCampaign,
  listMarketingCampaigns,
  updateMarketingCampaign,
  resolveRequestViewer,
  createMarketingCampaignRepository,
  prismaClient,
} = vi.hoisted(() => ({
  createMarketingCampaign: vi.fn(),
  getMarketingCampaign: vi.fn(),
  listMarketingCampaigns: vi.fn(),
  updateMarketingCampaign: vi.fn(),
  resolveRequestViewer: vi.fn(),
  createMarketingCampaignRepository: vi.fn(),
  prismaClient: { marker: 'campaign-prisma' },
}))

vi.mock('@/lib/db', () => ({ default: prismaClient }))
vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer }))
vi.mock('@/modules/marketing/infrastructure/marketing-campaign-repository', () => ({ createMarketingCampaignRepository }))
vi.mock('@/modules/marketing/application/marketing-campaign-service', () => ({
  createMarketingCampaign,
  getMarketingCampaign,
  listMarketingCampaigns,
  updateMarketingCampaign,
}))

const { GET: listRoute, POST: createRoute } = await import('@/app/api/growth/campaigns/route')
const { GET: detailRoute, PATCH: patchRoute } = await import('@/app/api/growth/campaigns/[id]/route')

const viewer = makeViewer({
  principal: { id: 'campaign-route-owner' },
  visibleBusinessIds: ['b-1'],
  ownedBusinessIds: ['b-1'],
  visibleDomains: ['growth'],
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
  campaignBrief: {
    startDate: '2026-09-10',
    endDate: '2026-09-11',
    offer: 'Offer',
    conditions: 'Conditions',
  },
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
  listMarketingCampaigns.mockResolvedValue({ campaigns: [], canWrite: true, truncated: false })
  createMarketingCampaign.mockResolvedValue({ id: 'campaign-1' })
  getMarketingCampaign.mockResolvedValue({ id: 'campaign-1', canWrite: true })
  updateMarketingCampaign.mockResolvedValue({ id: 'campaign-1', phase: 'DRAFT' })
})

describe('Marketing Campaign API routes', () => {
  it('passes the resolved viewer and Business query to the collection reader', async () => {
    const response = await listRoute(request('http://local/api/growth/campaigns?businessId=b-1'))
    expect(listMarketingCampaigns).toHaveBeenCalledWith(
      { viewer, businessId: 'b-1' },
      { db: prismaClient, createRepository: createMarketingCampaignRepository },
    )
    expect(response.status).toBe(200)
  })

  it('passes the strict create body to the Campaign service', async () => {
    const body = { businessId: 'b-1', title: 'Campaign', payload }
    const response = await createRoute(request('http://local/api/growth/campaigns', { method: 'POST', body }))
    expect(createMarketingCampaign).toHaveBeenCalledWith(body, {
      db: prismaClient,
      viewer,
      createRepository: createMarketingCampaignRepository,
    })
    expect(response.status).toBe(200)
  })

  it('re-resolves Business scope for detail and dispatches strict PATCH actions', async () => {
    const response = await detailRoute(
      request('http://local/api/growth/campaigns/campaign-1?businessId=b-1'),
      { params: { id: 'campaign-1' } },
    )
    expect(getMarketingCampaign).toHaveBeenCalledWith(
      { viewer, businessId: 'b-1', initiativeId: 'campaign-1' },
      { db: prismaClient, createRepository: createMarketingCampaignRepository },
    )
    expect(response.status).toBe(200)

    const action = { action: 'close', businessId: 'b-1', expectedVersion: 1, reason: 'Debrief' }
    const patchResponse = await patchRoute(
      request('http://local/api/growth/campaigns/campaign-1', { method: 'PATCH', body: action }),
      { params: { id: 'campaign-1' } },
    )
    expect(updateMarketingCampaign).toHaveBeenCalledWith('campaign-1', action, {
      db: prismaClient,
      viewer,
      createRepository: createMarketingCampaignRepository,
    })
    expect(patchResponse.status).toBe(200)
  })

  it('returns 400 for unknown PATCH keys before reaching the service', async () => {
    const response = await patchRoute(
      request('http://local/api/growth/campaigns/campaign-1', {
        method: 'PATCH',
        body: { action: 'close', businessId: 'b-1', expectedVersion: 1, reason: 'Debrief', actorId: 'forged' },
      }),
      { params: { id: 'campaign-1' } },
    )
    expect(response.status).toBe(400)
    expect(updateMarketingCampaign).not.toHaveBeenCalled()
  })
})

