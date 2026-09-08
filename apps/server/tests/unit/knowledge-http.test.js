// @req FR-172 — HTTP knowledge query bodies reject caller-supplied authority,
// runtime and implementation fields before corpus dispatch.
// @spec ADR-072, SEC-001, SEC-006
// @tested tests/unit/knowledge-http.test.js
import { describe, expect, it } from 'vitest'
import { strictKnowledgeBody } from '@/modules/knowledge/knowledge-http'

describe('knowledge HTTP request boundary', () => {
  it('accepts only the query contract fields', () => {
    const body = { businessId: 'b-1', projectId: null, query: 'hello', topK: 5 }
    expect(strictKnowledgeBody(body, ['businessId', 'projectId', 'query', 'topK'])).toBe(body)
  })

  it('rejects caller-selected scope or runtime policy fields', () => {
    expect(() => strictKnowledgeBody({ businessId: 'b-1', query: 'hello', scope: {} }, ['businessId', 'query']))
      .toThrowError(/Unsupported knowledge request field: scope/)
  })
})
