import { describe, expect, it, vi } from 'vitest'
import { makeViewer } from '../../factories/viewer'

const { listMarketingCampaigns, listMarketingOperations, listPhase1Integrations, getRevenueSummary } = vi.hoisted(() => ({
  listMarketingCampaigns: vi.fn(),
  listMarketingOperations: vi.fn(),
  listPhase1Integrations: vi.fn(),
  getRevenueSummary: vi.fn(),
}))

vi.mock('@/modules/marketing/application/marketing-campaign-service', () => ({ listMarketingCampaigns }))
vi.mock('@/modules/marketing/application/marketing-operations-service', () => ({ listMarketingOperations }))
vi.mock('@/modules/integration/application/integration-management-service', () => ({ listPhase1Integrations }))
vi.mock('@/modules/commerce/application/revenue-read-model', () => ({ getRevenueSummary }))

import { getMarketingPaidMedia, askMarketing } from '@/modules/marketing/application/marketing-insights-service'

const viewer = makeViewer({
  principal: { id: 'insights-owner' },
  visibleBusinessIds: ['business-1'],
  ownedBusinessIds: ['business-1'],
  visibleDomains: ['growth'],
})

function dbFor() {
  return { business: { findUnique: vi.fn(async () => ({ id: 'business-1', tenantId: 'tenant-1', status: 'ACTIVE' })) } }
}

describe('Marketing P5 owner projections', () => {
  it('propagates partial owner section state and does not invent an operations count', async () => {
    listMarketingCampaigns.mockResolvedValue({ campaigns: [] })
    listMarketingOperations.mockResolvedValue({ intake: [{ id: 'hidden-intake' }], sections: { intake: { state: 'UNAVAILABLE' } } })
    listPhase1Integrations.mockResolvedValue([])
    getRevenueSummary.mockResolvedValue({ businessId: 'business-1', from: null, to: null, verifiedNet: 0, refunded: 0, byOrigin: {}, byDay: [], pending: { count: 0, amount: 0 }, orders: { open: 0, completed: 0 } })
    const result = await askMarketing({ businessId: 'business-1', question: 'overview' }, { viewer, db: dbFor() })
    expect(result.state).toBe('PARTIAL')
    expect(result.answer.sections).toContainEqual(expect.objectContaining({ key: 'operations', count: null, state: 'UNAVAILABLE' }))
  })

  it('keeps paid metrics null and adds an explicit unavailable source', async () => {
    const db = dbFor()
    const result = await getMarketingPaidMedia({ businessId: 'business-1', viewer }, {
      db,
      // The owner readers are replaceable only for the source test; no metric
      // reader is supplied, so the paid source remains unavailable.
    })
    expect(result.metrics.every((metric) => metric.value === null && metric.state === 'UNAVAILABLE')).toBe(true)
    expect(result.sources).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'PAID_MEDIA_METRICS', state: 'UNAVAILABLE' })]))
  })

  it('classifies unsupported questions without reading CRM or calling a model', async () => {
    const result = await askMarketing({ businessId: 'business-1', question: 'invent a campaign' }, { viewer, db: dbFor() })
    expect(result).toMatchObject({ intentType: 'UNSUPPORTED', state: 'UNAVAILABLE', answer: null })
    expect(result.unavailable).toContainEqual({ source: 'ASK_MARKETING', reasonCode: 'QUESTION_UNSUPPORTED' })
  })
})
