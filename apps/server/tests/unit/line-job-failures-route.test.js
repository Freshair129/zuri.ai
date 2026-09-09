import { describe, it, expect, vi } from 'vitest'
import { GET } from '@/app/api/line-oa/jobs/failures/route'
import { summarizeLineConversationJobFailures } from '@/modules/line-oa-studio/application/line-job-failures'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { makeViewer } from '../factories/viewer'

// @req FR-149 — the route stays thin: it resolves a trusted viewer and hands
//   the client-supplied businessId to the service as a selector, never as scope.
// @spec ADR-061, SEC-001
// @tested this file

vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer: vi.fn() }))
vi.mock('@/modules/line-oa-studio/application/line-job-failures', () => ({ summarizeLineConversationJobFailures: vi.fn() }))

describe('GET /api/line-oa/jobs/failures', () => {
  it('resolves the viewer, passes businessId through, and returns the service result', async () => {
    const viewer = makeViewer()
    resolveRequestViewer.mockResolvedValue(viewer)
    const summary = { businessId: 'biz-1', total: 2, byErrorCode: [{ errorCode: 'LOCAL_POLICY_UNAVAILABLE', count: 2 }], failures: [] }
    summarizeLineConversationJobFailures.mockResolvedValue(summary)

    const result = await GET(new Request('http://localhost/api/line-oa/jobs/failures?businessId=biz-1'))

    expect(summarizeLineConversationJobFailures).toHaveBeenCalledWith({ businessId: 'biz-1', viewer })
    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual(summary)
  })

  it('surfaces the service refusal status instead of masking it as 500', async () => {
    resolveRequestViewer.mockResolvedValue(makeViewer())
    summarizeLineConversationJobFailures.mockRejectedValue(Object.assign(new Error('Business not found'), { status: 404 }))

    const result = await GET(new Request('http://localhost/api/line-oa/jobs/failures?businessId=biz-missing'))

    expect(result.status).toBe(404)
  })

  it('refuses unauthenticated requests before the service runs', async () => {
    resolveRequestViewer.mockRejectedValue(Object.assign(new Error('no session'), { status: 401 }))
    summarizeLineConversationJobFailures.mockClear()

    const result = await GET(new Request('http://localhost/api/line-oa/jobs/failures?businessId=biz-1'))

    expect(result.status).toBe(401)
    expect(summarizeLineConversationJobFailures).not.toHaveBeenCalled()
  })
})
