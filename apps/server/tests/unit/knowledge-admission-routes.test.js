// @req FR-172 — HTTP admission/list/status routes authenticate once and call
// the shared service; public responses keep admission and native run ids apart.
// @spec ADR-072, SEC-001, SEC-006, SEC-008
// @tested tests/unit/knowledge-admission-routes.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeViewer } from '../factories/viewer'

const { admitKnowledge, listKnowledgeIngestions, readKnowledgeIngestion, resolveViewer } = vi.hoisted(() => ({
  admitKnowledge: vi.fn(),
  listKnowledgeIngestions: vi.fn(),
  readKnowledgeIngestion: vi.fn(),
  resolveViewer: vi.fn(),
}))

vi.mock('@/modules/knowledge/knowledge-admission-service', () => ({ admitKnowledge, listKnowledgeIngestions, readKnowledgeIngestion }))
vi.mock('@/modules/knowledge/knowledge-http', () => ({ resolveKnowledgeRequestViewer: resolveViewer, readRouteParams: async (context) => context.params || {} }))

const { GET: LIST, POST: ADMIT } = await import('@/app/api/knowledge/ingestions/route')
const { GET: STATUS } = await import('@/app/api/knowledge/ingestions/[runId]/route')

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

describe('knowledge ingestion HTTP routes', () => {
  it('admits through the shared service with the authenticated viewer', async () => {
    const input = { businessId: 'b-1', idempotencyKey: 'req-1', source: { kind: 'TEXT', sourceKey: 'a', version: '1', content: 'text' } }
    admitKnowledge.mockResolvedValue({ id: 'admission-1', executionRunId: null, status: 'QUEUED' })
    const response = await ADMIT(request('http://local/api/knowledge/ingestions', 'POST', input))

    expect(admitKnowledge).toHaveBeenCalledWith(input, { viewer })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ id: 'admission-1', executionRunId: null, status: 'QUEUED' })
  })

  it('lists using query scope and does not let an unauthenticated request reach the service', async () => {
    listKnowledgeIngestions.mockResolvedValue({ corpus: null, items: [], count: 0, limit: 20 })
    const response = await LIST(request('http://local/api/knowledge/ingestions?businessId=b-1&projectId=p-1&limit=20'))

    expect(listKnowledgeIngestions).toHaveBeenCalledWith({ businessId: 'b-1', projectId: 'p-1', limit: 20 }, { viewer })
    expect(response.status).toBe(200)

    resolveViewer.mockRejectedValue(Object.assign(new Error('AUTH_REQUIRED'), { status: 401 }))
    const denied = await LIST(request('http://local/api/knowledge/ingestions?businessId=b-1'))
    expect(denied.status).toBe(401)
    expect(listKnowledgeIngestions).toHaveBeenCalledTimes(1)
  })

  it('reads an opaque admission id and preserves executionRunId as a separate field', async () => {
    readKnowledgeIngestion.mockResolvedValue({ id: 'admission-1', admissionId: 'admission-1', executionRunId: 'native-1', status: 'PUBLISHED' })
    const response = await STATUS(request('http://local/api/knowledge/ingestions/admission-1'), { params: { runId: 'admission-1' } })

    expect(readKnowledgeIngestion).toHaveBeenCalledWith('admission-1', { viewer })
    await expect(response.json()).resolves.toMatchObject({ id: 'admission-1', admissionId: 'admission-1', executionRunId: 'native-1' })
  })
})
