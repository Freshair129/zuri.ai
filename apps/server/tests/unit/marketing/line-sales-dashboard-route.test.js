import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeViewer } from '../../factories/viewer'

const { getLineSalesExecutiveDashboard, resolveRequestViewer, prismaClient } = vi.hoisted(() => ({
  getLineSalesExecutiveDashboard: vi.fn(),
  resolveRequestViewer: vi.fn(),
  prismaClient: { marker: 'line-sales-dashboard' },
}))
vi.mock('@/lib/db', () => ({ default: prismaClient }))
vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer }))
vi.mock('@/modules/marketing/application/line-sales-dashboard-service', () => ({ getLineSalesExecutiveDashboard }))

const route = await import('@/app/api/growth/line-sales/route')
const viewer = makeViewer({
  principal: { id: 'line-sales-owner' },
  visibleBusinessIds: ['business-1'],
  ownedBusinessIds: ['business-1'],
  visibleDomains: ['growth', 'commerce', 'customer'],
})

describe('executive LINE sales dashboard route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveRequestViewer.mockResolvedValue(viewer)
    getLineSalesExecutiveDashboard.mockResolvedValue({ state: 'PARTIAL' })
  })

  it('passes Business scope and the requested Monday week to the read-only projection', async () => {
    const response = await route.GET(new Request('http://local/api/growth/line-sales?businessId=business-1&weekOf=2026-09-28'))
    expect(response.status).toBe(200)
    expect(getLineSalesExecutiveDashboard).toHaveBeenCalledWith(
      { businessId: 'business-1', weekOf: '2026-09-28' },
      { viewer, db: prismaClient },
    )
  })

  it('lets the projection choose the default completed week when weekOf is absent', async () => {
    await route.GET(new Request('http://local/api/growth/line-sales?businessId=business-1'))
    expect(getLineSalesExecutiveDashboard).toHaveBeenCalledWith(
      { businessId: 'business-1' },
      { viewer, db: prismaClient },
    )
  })
})
