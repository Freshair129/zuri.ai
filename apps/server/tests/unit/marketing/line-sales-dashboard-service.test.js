import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeViewer } from '../../factories/viewer'

const { getRevenueSummary, getSalesTaskHealthSummary } = vi.hoisted(() => ({
  getRevenueSummary: vi.fn(),
  getSalesTaskHealthSummary: vi.fn(),
}))
vi.mock('@/modules/commerce/application/revenue-read-model', () => ({ getRevenueSummary }))
vi.mock('@/modules/crm/sales-task-service', () => ({ getSalesTaskHealthSummary }))

import { getLineSalesExecutiveDashboard } from '@/modules/marketing/application/line-sales-dashboard-service'

const NOW = new Date('2026-10-05T02:00:00.000Z') // Monday morning in Bangkok.
const viewer = makeViewer({
  principal: { id: 'executive-dashboard-owner' },
  visibleBusinessIds: ['business-1'],
  ownedBusinessIds: ['business-1'],
  visibleDomains: ['growth', 'commerce', 'customer'],
})
const db = { business: { findUnique: vi.fn(async () => ({ id: 'business-1', tenantId: 'tenant-1', status: 'ACTIVE' })) } }

describe('LINE OA executive dashboard projection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getRevenueSummary.mockResolvedValue({
      businessId: 'business-1', verifiedNet: 1200, refunded: 100,
      pending: { count: 2, amount: 300 }, orders: { open: 4, completed: 7 },
      byOrigin: { CHAT: 99 }, byDay: [{ day: '2026-09-28', net: 1200 }],
    })
    getSalesTaskHealthSummary.mockResolvedValue({
      businessId: 'business-1', summary: { open: 3, inProgress: 1, overdue: 1, dueToday: 1, unassigned: 2 },
      observedAt: '2026-10-05T02:00:00.000Z', tasks: [{ title: 'private task' }], customer: { displayName: 'private customer' },
    })
  })

  it('uses last completed Bangkok week, separate live task health, and omits ad attribution and CRM details', async () => {
    const result = await getLineSalesExecutiveDashboard({ businessId: 'business-1' }, { viewer, db, now: NOW })

    expect(result.window).toEqual({ from: '2026-09-28', to: '2026-10-04', toExclusive: '2026-10-05', timeZone: 'Asia/Bangkok' })
    expect(getRevenueSummary).toHaveBeenCalledWith(
      { businessId: 'business-1', from: '2026-09-28', to: '2026-10-04' }, { viewer, db },
    )
    expect(getSalesTaskHealthSummary).toHaveBeenCalledWith(
      { businessId: 'business-1' }, { viewer, db, now: NOW },
    )
    expect(result.sections.commerce).toMatchObject({ state: 'READY', verifiedNet: 1200, refunded: 100, pending: { count: 2, amount: 300 }, orders: { open: 4, completed: 7 } })
    expect(result.sections.commerce).not.toHaveProperty('byOrigin')
    expect(result.sections.followUp.summary).toEqual({ open: 3, inProgress: 1, overdue: 1, dueToday: 1, unassigned: 2 })
    expect(result.sections.followUp).not.toHaveProperty('tasks')
    expect(result.sections.followUp).not.toHaveProperty('customer')
    expect(result.sections.paidMedia).toMatchObject({ state: 'UNAVAILABLE', metrics: { spend: null, impressions: null, clicks: null, abTestResults: null, attributedRevenue: null, roas: null } })
    expect(result.sections.leadAttribution).toMatchObject({ state: 'UNAVAILABLE', metrics: { aiReplies: null, answeredConversations: null, leadHandoffs: null } })
    expect(result.sections.leadAttribution).toMatchObject({ state: 'UNAVAILABLE', metrics: { leads: null, readiness: null, permissionToCall: null } })
    expect(result.sections.callOutcomes).toMatchObject({ state: 'UNAVAILABLE', metrics: { attempts: null, outcomes: null } })
    expect(result.state).toBe('PARTIAL')
  })

  it('keeps denied and failed owner reads null instead of converting them to zero', async () => {
    getRevenueSummary.mockRejectedValueOnce(Object.assign(new Error('not visible'), { status: 404 }))
    getSalesTaskHealthSummary.mockRejectedValueOnce(new Error('database unavailable'))

    const result = await getLineSalesExecutiveDashboard({ businessId: 'business-1', weekOf: '2026-09-28' }, { viewer, db, now: NOW })

    expect(result.state).toBe('UNKNOWN')
    expect(result.sections.commerce).toMatchObject({ state: 'UNAVAILABLE', verifiedNet: null, refunded: null, pending: null, orders: null })
    expect(result.sections.followUp).toMatchObject({ state: 'UNKNOWN', summary: null, observedAt: null })
    expect(result.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'VERIFIED_REVENUE', state: 'UNAVAILABLE', reasonCode: 'VERIFIED_REVENUE_UNAVAILABLE' }),
      expect.objectContaining({ source: 'SALES_TASK_HEALTH', state: 'UNKNOWN', reasonCode: 'SALES_TASK_HEALTH_READ_UNKNOWN' }),
    ]))
  })

  it('rejects non-Monday explicit week anchors', async () => {
    await expect(getLineSalesExecutiveDashboard({ businessId: 'business-1', weekOf: '2026-09-29' }, { viewer, db, now: NOW }))
      .rejects.toThrow('weekOf must be a valid Monday in Asia/Bangkok')
    expect(getRevenueSummary).not.toHaveBeenCalled()
  })

  it('requires Marketing visibility before calling either owner read', async () => {
    const viewerWithoutMarketing = makeViewer({
      role: 'MEMBER', visibleBusinessIds: ['business-1'], ownedBusinessIds: [],
      visibleDomains: ['commerce', 'customer'],
      domainsByBusinessId: { 'business-1': ['commerce', 'customer'] },
    })
    await expect(getLineSalesExecutiveDashboard({ businessId: 'business-1' }, { viewer: viewerWithoutMarketing, db, now: NOW }))
      .rejects.toMatchObject({ status: 404 })
    expect(getRevenueSummary).not.toHaveBeenCalled()
    expect(getSalesTaskHealthSummary).not.toHaveBeenCalled()
  })
})
