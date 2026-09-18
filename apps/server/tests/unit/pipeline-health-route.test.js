import { describe, it, expect, vi } from 'vitest'
import { GET } from '@/app/api/pipelines/health/route'
import { getLivePipelineHealth } from '@/modules/knowledge/pipeline-map/pipeline-health-service'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { makeViewer } from '../factories/viewer'

// @req FR-215 — route stays thin and delegates to getLivePipelineHealth.
// @spec ADR-085 D5, SEC-001, SEC-008
// @tested tests/unit/pipeline-health-route.test.js

vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer: vi.fn() }))
vi.mock('@/modules/knowledge/pipeline-map/pipeline-health-service', () => ({ getLivePipelineHealth: vi.fn() }))

describe('GET /api/pipelines/health', () => {
  it('rejects with 400 when businessId is missing', async () => {
    const result = await GET(new Request('http://localhost/api/pipelines/health'))
    expect(result.status).toBe(400)
    expect(getLivePipelineHealth).not.toHaveBeenCalled()
  })

  it('resolves viewer, calls getLivePipelineHealth with businessId, and returns 200 JSON', async () => {
    const viewer = makeViewer({ visibleDomains: ['knowledge'] })
    resolveRequestViewer.mockResolvedValue(viewer)
    const payload = {
      businessId: 'biz-1',
      asOf: '2026-09-14T08:00:00.000Z',
      summary: { totalTracked: 10, totalFailures: 0, hasFailures: false, backedEdgeCount: 17 },
      edges: {},
    }
    getLivePipelineHealth.mockResolvedValue(payload)

    const response = await GET(new Request('http://localhost/api/pipelines/health?businessId=biz-1'))
    expect(resolveRequestViewer).toHaveBeenCalled()
    expect(getLivePipelineHealth).toHaveBeenCalledWith({ businessId: 'biz-1', viewer })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(payload)
  })

  it('surfaces service refusal status', async () => {
    const viewer = makeViewer({ visibleDomains: ['knowledge'] })
    resolveRequestViewer.mockResolvedValue(viewer)
    getLivePipelineHealth.mockRejectedValue(Object.assign(new Error('BUSINESS_NOT_FOUND'), { status: 404 }))

    const response = await GET(new Request('http://localhost/api/pipelines/health?businessId=biz-unknown'))
    expect(response.status).toBe(404)
  })
})
