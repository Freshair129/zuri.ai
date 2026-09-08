// @req FR-173 — query, citation and source withdrawal HTTP routes dispatch only
// through the corpus service after the trusted viewer/API boundary.
// @spec ADR-072, SEC-001, SEC-006, SEC-008
// @tested tests/unit/knowledge-corpus-routes.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeViewer } from '../factories/viewer'

const { resolveViewer, resolveService, queryKnowledgeCorpus, resolveKnowledgeCitation, withdrawKnowledgeSource } = vi.hoisted(() => {
  const queryKnowledgeCorpus = vi.fn()
  const resolveKnowledgeCitation = vi.fn()
  const withdrawKnowledgeSource = vi.fn()
  return {
    resolveViewer: vi.fn(),
    resolveService: vi.fn(async () => ({ queryKnowledgeCorpus, resolveKnowledgeCitation, withdrawKnowledgeSource })),
    queryKnowledgeCorpus,
    resolveKnowledgeCitation,
    withdrawKnowledgeSource,
  }
})

vi.mock('@/modules/knowledge/knowledge-http', () => ({
  resolveKnowledgeRequestViewer: resolveViewer,
  resolveKnowledgeCorpusService: resolveService,
  readRouteParams: async (context) => context.params || {},
  strictKnowledgeBody: (value) => value,
}))

const { POST: QUERY } = await import('@/app/api/knowledge/queries/route')
const { GET: CITATION } = await import('@/app/api/knowledge/citations/[citationId]/route')
const { DELETE: WITHDRAW } = await import('@/app/api/knowledge/sources/[sourceId]/route')

const viewer = makeViewer({ role: 'OWNER', visibleBusinessIds: ['b-1'], ownedBusinessIds: ['b-1'] })
const request = (url, method = 'GET', body) => new Request(url, {
  method,
  headers: { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})

beforeEach(() => {
  vi.clearAllMocks()
  resolveViewer.mockResolvedValue(viewer)
})

describe('knowledge corpus HTTP routes', () => {
  it('dispatches an authorized query without changing the request contract', async () => {
    const body = { businessId: 'b-1', projectId: null, query: 'hello', topK: 5 }
    queryKnowledgeCorpus.mockResolvedValue({ corpusGeneration: 1, results: [] })
    const sourceRequest = request('http://local/api/knowledge/queries', 'POST', body)
    const response = await QUERY(sourceRequest)

    expect(queryKnowledgeCorpus).toHaveBeenCalledWith(body, {
      viewer,
      resolveCurrentViewer: expect.any(Function),
    })
    expect(response.status).toBe(200)
  })

  it('resolves a citation by path id and passes the viewer', async () => {
    resolveKnowledgeCitation.mockResolvedValue({ citationId: 'cit-1', text: 'evidence' })
    const sourceRequest = request('http://local/api/knowledge/citations/cit-1')
    const response = await CITATION(sourceRequest, { params: { citationId: 'cit-1' } })

    expect(resolveKnowledgeCitation).toHaveBeenCalledWith('cit-1', {
      viewer,
      resolveCurrentViewer: expect.any(Function),
    })
    await expect(response.json()).resolves.toMatchObject({ citationId: 'cit-1' })
  })

  it('withdraws by source id with the explicit expected version', async () => {
    withdrawKnowledgeSource.mockResolvedValue({ sourceId: 'source-1', status: 'WITHDRAWN' })
    const response = await WITHDRAW(request('http://local/api/knowledge/sources/source-1', 'DELETE', { expectedVersion: 4 }), { params: { sourceId: 'source-1' } })

    expect(withdrawKnowledgeSource).toHaveBeenCalledWith('source-1', { expectedVersion: 4 }, { viewer })
    expect(response.status).toBe(200)
  })
})
