import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeViewer } from '../../factories/viewer'

const { resolveRequestViewer, listMarketingBroadcastIntents, createMarketingBroadcastIntent, getMarketingBroadcastIntent, updateMarketingBroadcastIntent, prismaClient } = vi.hoisted(() => ({
  resolveRequestViewer: vi.fn(), listMarketingBroadcastIntents: vi.fn(), createMarketingBroadcastIntent: vi.fn(), getMarketingBroadcastIntent: vi.fn(), updateMarketingBroadcastIntent: vi.fn(), prismaClient: { marker: 'broadcast' },
}))
vi.mock('@/lib/db', () => ({ default: prismaClient }))
vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer }))
vi.mock('@/modules/marketing/application/marketing-broadcast-service', () => ({ listMarketingBroadcastIntents, createMarketingBroadcastIntent, getMarketingBroadcastIntent, updateMarketingBroadcastIntent }))

const collection = await import('@/app/api/growth/broadcast-intents/route')
const detail = await import('@/app/api/growth/broadcast-intents/[id]/route')
const viewer = makeViewer({ principal: { id: 'route-owner' }, visibleBusinessIds: ['business-1'], ownedBusinessIds: ['business-1'], visibleDomains: ['growth'] })
const request = (url, init) => new Request(url, init)

beforeEach(() => {
  vi.clearAllMocks()
  resolveRequestViewer.mockResolvedValue(viewer)
  listMarketingBroadcastIntents.mockResolvedValue({ intents: [] })
  createMarketingBroadcastIntent.mockResolvedValue({ id: 'intent-1' })
  getMarketingBroadcastIntent.mockResolvedValue({ id: 'intent-1' })
  updateMarketingBroadcastIntent.mockResolvedValue({ id: 'intent-1' })
})

describe('Marketing broadcast API routes', () => {
  it('passes the trusted viewer and Business to the collection service', async () => {
    const response = await collection.GET(request('http://local/api/growth/broadcast-intents?businessId=business-1'))
    expect(response.status).toBe(200)
    expect(listMarketingBroadcastIntents).toHaveBeenCalledWith({ viewer, businessId: 'business-1' }, { db: prismaClient })
  })
  it('has no send route and maps detail reads and CAS actions to the service', async () => {
    await detail.GET(request('http://local/api/growth/broadcast-intents/intent-1?businessId=business-1'), { params: { id: 'intent-1' } })
    await detail.PATCH(request('http://local/api/growth/broadcast-intents/intent-1', { method: 'PATCH', body: JSON.stringify({ action: 'archive', businessId: 'business-1', expectedVersion: 1 }) }), { params: { id: 'intent-1' } })
    expect(getMarketingBroadcastIntent).toHaveBeenCalledWith({ viewer, businessId: 'business-1', id: 'intent-1' }, { db: prismaClient })
    expect(updateMarketingBroadcastIntent).toHaveBeenCalledWith('intent-1', { action: 'archive', businessId: 'business-1', expectedVersion: 1 }, { viewer, db: prismaClient })
  })
})

