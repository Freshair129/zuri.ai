import { describe, it, expect, vi } from 'vitest'
import { GET } from '@/app/api/line-oa/jobs/[id]/trace/route'
import { readLineConversationTrace } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { makeViewer } from '../factories/viewer'

// @req FR-171 — trace responses are private, authenticated and error-redacted.
// @spec SEC-001, SEC-009, ADR-070
vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer: vi.fn() }))
vi.mock('@/modules/line-oa-studio/application/line-conversation-jobs', () => ({ readLineConversationTrace: vi.fn() }))

describe('private trace HTTP boundary', () => {
  it('does not expose storage/provider diagnostics and prevents caching', async () => {
    resolveRequestViewer.mockResolvedValue(makeViewer())
    readLineConversationTrace.mockRejectedValue(new Error('private-sql-and-credentials'))
    const result = await GET(new Request('http://localhost/api/line-oa/jobs/id/trace'), { params: { id: 'id' } })
    expect(result.status).toBe(503)
    expect(await result.text()).not.toContain('private-sql-and-credentials')
    expect(result.headers.get('cache-control')).toBe('private, no-store')
  })
  it('refuses unauthenticated inspection before reading journal payloads', async () => {
    readLineConversationTrace.mockClear()
    resolveRequestViewer.mockRejectedValue(Object.assign(new Error('no session'), { status: 401 }))
    const result = await GET(new Request('http://localhost/api/line-oa/jobs/id/trace'), { params: { id: 'id' } })
    expect(result.status).toBe(401)
    expect(readLineConversationTrace).not.toHaveBeenCalled()
  })
})
