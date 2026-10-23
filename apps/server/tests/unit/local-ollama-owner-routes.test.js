import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assertAvailable: vi.fn(),
  listModels: vi.fn(),
  selectModel: vi.fn(),
  resolveViewer: vi.fn(),
}))

vi.mock('@/modules/integration/application/local-ollama-selection-service', () => ({
  assertMainDevLocalOllamaAvailable: mocks.assertAvailable,
  listMainDevLocalOllamaModels: mocks.listModels,
  selectMainDevLocalOllamaModel: mocks.selectModel,
}))
vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer: mocks.resolveViewer }))

import { GET } from '@/app/api/integration/local-ollama/models/route'
import { POST } from '@/app/api/integration/local-ollama/selection/route'
import { makeViewer } from '../factories/viewer'

const viewer = makeViewer({
  visibleBusinessIds: ['business-1'],
  ownedBusinessIds: ['business-1'],
  visibleDomains: ['line-oa'],
})

describe('main-dev local Ollama owner routes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.resolveViewer.mockResolvedValue(viewer)
    mocks.assertAvailable.mockReturnValue({ enabled: true })
    mocks.listModels.mockResolvedValue({ businessId: 'business-1', accountId: 'account-1', models: ['mellum:latest'] })
    mocks.selectModel.mockResolvedValue({ businessId: 'business-1', accountId: 'account-1', modelId: 'mellum:latest', selected: true })
  })

  it('derives model inventory scope from the authenticated viewer and never caches it', async () => {
    const response = await GET(new Request('http://localhost/api/integration/local-ollama/models'))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toMatchObject({ businessId: 'business-1', accountId: 'account-1' })
    expect(mocks.resolveViewer).toHaveBeenCalledTimes(1)
    expect(mocks.assertAvailable).toHaveBeenCalledTimes(1)
    expect(mocks.listModels).toHaveBeenCalledWith({ viewer })
  })

  it('refuses an unavailable profile before inventory or request-body parsing', async () => {
    mocks.assertAvailable.mockImplementation(() => { throw Object.assign(new Error('Business not found'), { status: 404 }) })
    const request = new Request('http://localhost/api/integration/local-ollama/selection', { method: 'POST' })
    const readBody = vi.spyOn(request, 'text')

    const response = await POST(request)

    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(readBody).not.toHaveBeenCalled()
    expect(mocks.selectModel).not.toHaveBeenCalled()
  })

  it('authenticates before parsing, bounds the body, and forwards only the parsed selection', async () => {
    const request = new Request('http://localhost/api/integration/local-ollama/selection', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: 'mellum:latest' }),
    })
    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.selectModel).toHaveBeenCalledWith({ modelId: 'mellum:latest' }, { viewer })
    expect(await response.json()).toMatchObject({ selected: true, modelId: 'mellum:latest' })
  })

  it('returns no-store validation errors for malformed or oversized bodies without writing', async () => {
    const malformed = await POST(new Request('http://localhost/api/integration/local-ollama/selection', {
      method: 'POST', body: '{',
    }))
    const oversized = await POST(new Request('http://localhost/api/integration/local-ollama/selection', {
      method: 'POST', body: JSON.stringify({ modelId: 'mellum:latest', extra: 'x'.repeat(17 * 1024) }),
    }))

    expect(malformed.status).toBe(400)
    expect(oversized.status).toBe(413)
    expect(malformed.headers.get('cache-control')).toBe('no-store')
    expect(oversized.headers.get('cache-control')).toBe('no-store')
    expect(mocks.selectModel).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', undefined],
    ['understated', '1'],
  ])('enforces the body limit while streaming when Content-Length is %s', async (_label, contentLength) => {
    const streamState = { pulls: 0, canceled: false }
    const body = new ReadableStream({
      pull(controller) {
        streamState.pulls += 1
        controller.enqueue(new TextEncoder().encode('x'.repeat(1024)))
        if (streamState.pulls === 20) controller.close()
      },
      cancel() { streamState.canceled = true },
    })
    const headers = contentLength === undefined ? {} : { 'content-length': contentLength }
    const request = new Request('http://localhost/api/integration/local-ollama/selection', {
      method: 'POST', headers, body, duplex: 'half',
    })

    const response = await POST(request)

    expect(response.status).toBe(413)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(streamState.canceled).toBe(true)
    expect(streamState.pulls).toBeLessThan(20)
    expect(mocks.selectModel).not.toHaveBeenCalled()
  })

  it('does not reach profile or business services when authentication fails', async () => {
    mocks.resolveViewer.mockRejectedValue(Object.assign(new Error('AUTH_REQUIRED'), { status: 401 }))
    const response = await GET(new Request('http://localhost/api/integration/local-ollama/models'))

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.assertAvailable).not.toHaveBeenCalled()
    expect(mocks.listModels).not.toHaveBeenCalled()
  })
})
