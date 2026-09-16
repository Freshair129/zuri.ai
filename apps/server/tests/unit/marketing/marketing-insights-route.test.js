import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeViewer } from '../../factories/viewer'

const { resolveRequestViewer, getMarketingPaidMedia, askMarketing, prismaClient } = vi.hoisted(() => ({ resolveRequestViewer: vi.fn(), getMarketingPaidMedia: vi.fn(), askMarketing: vi.fn(), prismaClient: { marker: 'insights' } }))
vi.mock('@/lib/db', () => ({ default: prismaClient }))
vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer }))
vi.mock('@/modules/marketing/application/marketing-insights-service', () => ({ getMarketingPaidMedia, askMarketing }))

const paid = await import('@/app/api/growth/paid-media/route')
const ask = await import('@/app/api/growth/ask-marketing/route')
const viewer = makeViewer({ principal: { id: 'insights-route-owner' }, visibleBusinessIds: ['business-1'], ownedBusinessIds: ['business-1'], visibleDomains: ['growth'] })

beforeEach(() => {
  vi.clearAllMocks()
  resolveRequestViewer.mockResolvedValue(viewer)
  getMarketingPaidMedia.mockResolvedValue({ state: 'PARTIAL' })
  askMarketing.mockResolvedValue({ state: 'UNAVAILABLE' })
})

describe('Marketing insight routes', () => {
  it('delegates paid media with the requested measurement window', async () => {
    const response = await paid.GET(new Request('http://local/api/growth/paid-media?businessId=business-1&from=2026-09-01&to=2026-09-11'))
    expect(response.status).toBe(200)
    expect(getMarketingPaidMedia).toHaveBeenCalledWith({ businessId: 'business-1', viewer }, { db: prismaClient, from: '2026-09-01', to: '2026-09-11' })
  })
  it('delegates the read-only AskMarketing body', async () => {
    await ask.POST(new Request('http://local/api/growth/ask-marketing', { method: 'POST', body: JSON.stringify({ businessId: 'business-1', question: 'overview' }) }))
    expect(askMarketing).toHaveBeenCalledWith({ businessId: 'business-1', question: 'overview' }, { viewer, db: prismaClient })
  })
})

