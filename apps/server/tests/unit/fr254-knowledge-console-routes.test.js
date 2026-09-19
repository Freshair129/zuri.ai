// @req FR-254 — authenticated console routes preserve opaque IDs and hide denied resources.
// @spec ADR-072, SEC-001, SEC-008
// @tested tests/unit/fr254-knowledge-console-routes.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeViewer } from '../factories/viewer'

const mocks = vi.hoisted(() => Object.fromEntries([
  'viewer', 'listConsoleSources', 'readConsoleSource', 'listConsoleRuns', 'readConsoleRun',
  'listConsoleCorpora', 'listConsoleGenerations', 'readConsoleCitationArtifact',
].map((name) => [name, vi.fn()])))
vi.mock('@/modules/knowledge/knowledge-http', () => ({
  resolveKnowledgeRequestViewer: mocks.viewer,
  readRouteParams: async (context) => await context.params,
  resolveKnowledgeCorpusService: vi.fn(),
  strictKnowledgeBody: (value) => value,
}))
vi.mock('@/modules/knowledge/knowledge-console-service', () => mocks)

const routes = [
  ['sources', 'listConsoleSources', (await import('@/app/api/knowledge/sources/route')).GET, null],
  ['sources/source-a', 'readConsoleSource', (await import('@/app/api/knowledge/sources/[sourceId]/route')).GET, { sourceId: 'source-a' }],
  ['console/runs', 'listConsoleRuns', (await import('@/app/api/knowledge/console/runs/route')).GET, null],
  ['console/runs/run-a', 'readConsoleRun', (await import('@/app/api/knowledge/console/runs/[executionRunId]/route')).GET, { executionRunId: 'run-a' }],
  ['corpora', 'listConsoleCorpora', (await import('@/app/api/knowledge/corpora/route')).GET, null],
  ['corpora/corpus-a/generations', 'listConsoleGenerations', (await import('@/app/api/knowledge/corpora/[corpusId]/generations/route')).GET, { corpusId: 'corpus-a' }],
]
const artifact = (await import('@/app/api/knowledge/citations/[citationId]/artifact/route')).GET
const viewer = makeViewer({ role: 'OWNER', visibleBusinessIds: ['business-a'], ownedBusinessIds: ['business-a'] })
beforeEach(() => { vi.resetAllMocks(); mocks.viewer.mockResolvedValue(viewer) })
const request = (url) => new Request('http://local/api/knowledge/' + url)

describe('FR-254 console HTTP boundary', () => {
  it.each(routes)('%s resolves trusted current authority and disables caching', async (path, service, get, params) => {
    mocks[service].mockResolvedValue({ items: [], nextCursor: null })
    const req = request(path + (params ? '' : '?businessId=business-a&limit=7'))
    const response = await get(req, { params: Promise.resolve(params || {}) })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const args = mocks[service].mock.calls[0]
    expect(args.at(-1).viewer).toBe(viewer)
    if (params) expect(args[0]).toBe(Object.values(params)[0])
    else expect(args[0]).toEqual({ businessId: 'business-a', limit: '7' })
    await args.at(-1).resolveCurrentViewer()
    expect(mocks.viewer).toHaveBeenCalledTimes(2)
  })

  it('rejects unauthenticated reads before dispatch and normalizes forbidden IDs to missing', async () => {
    mocks.viewer.mockRejectedValueOnce(Object.assign(new Error('Sign in required'), { status: 401 }))
    expect((await routes[0][2](request('sources?businessId=business-a'))).status).toBe(401)
    expect(mocks.listConsoleSources).not.toHaveBeenCalled()
    for (const status of [403, 404]) {
      mocks.readConsoleSource.mockRejectedValueOnce(Object.assign(new Error('secret source title'), { status }))
      const response = await routes[1][2](request('sources/source-a'), { params: { sourceId: 'source-a' } })
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: 'Knowledge resource not found' })
    }
  })

  it('shows unavailable data as an error without leaking the storage exception', async () => {
    mocks.listConsoleSources.mockRejectedValue(new Error('private database path'))
    const response = await routes[0][2](request('sources?businessId=business-a'))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Knowledge data is temporarily unavailable. Retry the request.' })
  })

  it('downloads only resolved retained text with a fixed safe attachment name', async () => {
    const text = '<script>alert(1)</script>\nหลักฐาน'
    mocks.readConsoleCitationArtifact.mockResolvedValue({ content: text })
    const response = await artifact(request('citations/kc1.id/artifact?kind=raw&download=true'), { params: Promise.resolve({ citationId: 'kc1.id' }) })
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="knowledge-raw.txt"')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await response.text()).toBe(text)
    expect(mocks.readConsoleCitationArtifact).toHaveBeenCalledWith('kc1.id', { kind: 'raw', download: true }, expect.objectContaining({ viewer }))
  })

  it.each(['kind=path', 'kind=raw&path=C:/secret', 'download=yes'])('rejects invalid artifact parameters %s', async (query) => {
    const response = await artifact(request('citations/id/artifact?' + query), { params: { citationId: 'id' } })
    expect(response.status).toBe(400)
    expect(mocks.readConsoleCitationArtifact).not.toHaveBeenCalled()
  })
})
