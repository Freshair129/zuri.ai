// @req FR-289 — verify operator authorization and fail-closed behavior.
import { describe, expect, it, vi } from 'vitest'
import { requireKnowledgeStudioOperator } from '@/modules/platform-control/knowledge-studio/authorization'

describe('Knowledge Studio API authorization', () => {
  it('resolves the viewer for each request and returns an installation operator', async () => {
    const request = new Request('http://zuri.local/api/control/knowledge-studio/graph')
    const viewer = { id: 'operator' }
    const resolveViewer = vi.fn().mockResolvedValue(viewer)
    const isOperator = vi.fn().mockReturnValue(true)

    await expect(requireKnowledgeStudioOperator(request, { resolveViewer, isOperator })).resolves.toBe(viewer)
    expect(resolveViewer).toHaveBeenCalledOnce()
    expect(resolveViewer).toHaveBeenCalledWith(request)
    expect(isOperator).toHaveBeenCalledWith(viewer)
  })

  it('denies a non-operator before any document data can be returned', async () => {
    const resolveViewer = vi.fn().mockResolvedValue({ id: 'member' })
    await expect(requireKnowledgeStudioOperator(new Request('http://zuri.local'), {
      resolveViewer,
      isOperator: () => false,
    })).rejects.toMatchObject({ status: 403 })
  })

  it('preserves viewer resolution failures instead of treating them as authorization', async () => {
    const outage = Object.assign(new Error('session unavailable'), { status: 503 })
    await expect(requireKnowledgeStudioOperator(new Request('http://zuri.local'), {
      resolveViewer: async () => { throw outage },
      isOperator: () => true,
    })).rejects.toBe(outage)
  })
})
