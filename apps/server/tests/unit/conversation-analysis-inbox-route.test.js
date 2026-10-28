import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeViewer } from '../factories/viewer'

const { getConversationAnalyses, resolveRequestViewer } = vi.hoisted(() => ({
  getConversationAnalyses: vi.fn(),
  resolveRequestViewer: vi.fn(),
}))

vi.mock('@/modules/crm/conversation-analysis-service', () => ({ getConversationAnalyses }))
vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer }))

const { GET } = await import('@/app/api/crm/conversations/[id]/analysis/route')
const viewer = makeViewer({ ownedBusinessIds: ['b-1'], visibleBusinessIds: ['b-1'] })

function get(url, id = 'c-1') {
  return GET(new Request(url), { params: { id } })
}

beforeEach(() => {
  vi.clearAllMocks()
  resolveRequestViewer.mockResolvedValue(viewer)
  getConversationAnalyses.mockResolvedValue({ version: '1.0', conversationId: 'c-1', analyses: [] })
})

describe('GET /api/crm/conversations/:id/analysis', () => {
  it('requires and forwards explicit Business scope and the internal path id', async () => {
    const response = await get('http://local/api/crm/conversations/c-1/analysis?businessId=b-1')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ version: '1.0', conversationId: 'c-1', analyses: [] })
    expect(getConversationAnalyses).toHaveBeenCalledWith({ viewer, businessId: 'b-1', conversationId: 'c-1' })
  })

  it('refuses a missing or broadened scope before calling the read service', async () => {
    const missing = await get('http://local/api/crm/conversations/c-1/analysis')
    const broadened = await get('http://local/api/crm/conversations/c-1/analysis?businessId=b-1&tenantId=t-1')
    expect(missing.status).toBe(400)
    expect(broadened.status).toBe(400)
    expect(getConversationAnalyses).not.toHaveBeenCalled()
  })

  it('does not call the analysis reader when authentication fails', async () => {
    resolveRequestViewer.mockRejectedValue(Object.assign(new Error('AUTH_REQUIRED'), { status: 401 }))
    const response = await get('http://local/api/crm/conversations/c-1/analysis?businessId=b-1')
    expect(response.status).toBe(401)
    expect(getConversationAnalyses).not.toHaveBeenCalled()
  })
})
