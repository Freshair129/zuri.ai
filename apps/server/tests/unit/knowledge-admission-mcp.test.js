// @req FR-173 — MCP knowledge tools use the same admission/list/status service
// and reject caller-supplied executable or authority fields.
// @spec ADR-072, SEC-001, SEC-008
// @tested tests/unit/knowledge-admission-mcp.test.js
import { describe, expect, it, vi } from 'vitest'
import { makeViewer } from '../factories/viewer'
import { createProjectManagerMcpTransport } from '@/modules/project-manager/mcp/transport'

const viewer = makeViewer({ role: 'OWNER', visibleBusinessIds: ['b-1'], ownedBusinessIds: ['b-1'] })

async function session(transport) {
  const initialized = await transport.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }, { viewer })
  await transport.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, { viewer, sessionId: initialized.sessionId })
  return initialized.sessionId
}

describe('knowledge MCP transport', () => {
  it('lists and dispatches admission/list/status tools through injected services', async () => {
    const knowledge = {
      admitKnowledge: vi.fn(async (input) => ({ id: 'admission-1', input, status: 'QUEUED', executionRunId: null })),
      listKnowledgeIngestions: vi.fn(async () => ({ items: [] })),
      readKnowledgeIngestion: vi.fn(async (id) => ({ id, status: 'RUNNING', executionRunId: 'native-1' })),
    }
    const transport = createProjectManagerMcpTransport({ knowledge })
    const sessionId = await session(transport)
    const listed = await transport.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, { viewer, sessionId })
    expect(listed.body.result.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'knowledge.ingestion_create', 'knowledge.ingestion_list', 'knowledge.ingestion_status',
    ]))

    const input = { businessId: 'b-1', idempotencyKey: 'mcp-1', source: { kind: 'TEXT', sourceKey: 'a', version: '1', content: 'hello' } }
    const created = await transport.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'knowledge.ingestion_create', arguments: input } }, { viewer, sessionId })
    expect(created.body.result.structuredContent).toMatchObject({ id: 'admission-1', status: 'QUEUED' })
    expect(knowledge.admitKnowledge).toHaveBeenCalledWith(input, { viewer })

    const status = await transport.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'knowledge.ingestion_status', arguments: { runId: 'admission-1' } } }, { viewer, sessionId })
    expect(status.body.result.structuredContent).toMatchObject({ id: 'admission-1', executionRunId: 'native-1' })
    expect(knowledge.readKnowledgeIngestion).toHaveBeenCalledWith('admission-1', { viewer })
  })

  it('passes request-scoped current-viewer resolution only to query and citation handlers', async () => {
    const resolveCurrentViewer = vi.fn(async () => viewer)
    const knowledge = {
      queryKnowledgeCorpus: vi.fn(async () => ({ corpusGeneration: 1, results: [] })),
      resolveKnowledgeCitation: vi.fn(async () => ({ citationId: 'citation-1', text: 'evidence' })),
    }
    const transport = createProjectManagerMcpTransport({ knowledge })
    const sessionId = await session(transport)
    await transport.handle({
      jsonrpc: '2.0', id: 6, method: 'tools/call',
      params: { name: 'knowledge.query', arguments: { businessId: 'b-1', query: 'hello' } },
    }, { viewer, sessionId, resolveCurrentViewer })
    await transport.handle({
      jsonrpc: '2.0', id: 7, method: 'tools/call',
      params: { name: 'knowledge.citation', arguments: { citationId: 'citation-1' } },
    }, { viewer, sessionId, resolveCurrentViewer })

    expect(knowledge.queryKnowledgeCorpus).toHaveBeenCalledWith(
      { businessId: 'b-1', query: 'hello' },
      { viewer, resolveCurrentViewer },
    )
    expect(knowledge.resolveKnowledgeCitation).toHaveBeenCalledWith(
      'citation-1',
      { viewer, resolveCurrentViewer },
    )
  })

  it('does not accept scope, policy, credential or executable fields', async () => {
    const transport = createProjectManagerMcpTransport({ knowledge: { admitKnowledge: vi.fn() } })
    const sessionId = await session(transport)
    const response = await transport.handle({
      jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: {
        name: 'knowledge.ingestion_create',
        arguments: {
          businessId: 'b-1', idempotencyKey: 'mcp-2',
          scope: {},
          source: { kind: 'TEXT', sourceKey: 'a', version: '1', content: 'hello', execute: 'bad' },
        },
      },
    }, { viewer, sessionId })
    expect(response.body.error.code).toBe(-32602)
  })
})
