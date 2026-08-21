// @req FR-024 — Unit tests for GenesisBlockDB RAG service.
// @spec ADR-007 §P5 — Verify hybrid retrieval, live-fact assertion, and agent prompt formatting.
// @tested src/modules/knowledge/gbdb-rag-service.js

import { describe, expect, it, vi } from 'vitest'
import { createGenesisBlockDbRagService } from '../../src/modules/knowledge/gbdb-rag-service.js'

describe('createGenesisBlockDbRagService', () => {
  const createMockDb = () => ({
    addNode: vi.fn().mockResolvedValue({ status: 'ok' }),
    addEdge: vi.fn().mockResolvedValue({ status: 'ok' }),
    flushIndex: vi.fn().mockResolvedValue({ status: 'ok' }),
    hybridSearch: vi.fn().mockResolvedValue([
      {
        node: {
          id: 'doc:faq_1',
          labels: ['FAQ'],
          props: { title: 'FAQ 1', text: 'Return allowed within 7 days.' },
          impact: 0.8,
        },
        score: 0.95,
      },
    ]),
  })

  it('throws an error if an invalid DB client is passed', () => {
    expect(() => createGenesisBlockDbRagService({})).toThrow('createGenesisBlockDbRagService requires a valid GenesisDatabase client instance')
  })

  it('ingests knowledge items correctly and guards against live facts', async () => {
    const db = createMockDb()
    const embeddingProvider = vi.fn().mockResolvedValue([0.1, 0.2, 0.3, 0.4])
    const service = createGenesisBlockDbRagService({ db, embeddingProvider })

    await service.ingestKnowledgeItem({
      id: 'doc:policy_1',
      labels: ['Policy'],
      properties: { title: 'Policy 1', text: 'Store policy details.' },
      embeddingText: 'Store policy details.',
    })

    expect(embeddingProvider).toHaveBeenCalledWith('Store policy details.')
    expect(db.addNode).toHaveBeenCalledWith({
      id: 'doc:policy_1',
      labels: ['Policy'],
      props: { title: 'Policy 1', text: 'Store policy details.' },
      embedding: [0.1, 0.2, 0.3, 0.4],
    })
    expect(db.flushIndex).toHaveBeenCalled()

    // Test live fact guard (price is forbidden in graph)
    await expect(
      service.ingestKnowledgeItem({
        id: 'doc:live_price',
        labels: ['Invoice'],
        properties: { price: 500 },
      }),
    ).rejects.toThrow()
  })

  it('queries hybrid context and formats hits properly', async () => {
    const db = createMockDb()
    const embeddingProvider = vi.fn().mockResolvedValue([0.9, 0.1, 0.0, 0.0])
    const service = createGenesisBlockDbRagService({ db, embeddingProvider })

    const result = await service.queryHybridContext({
      queryText: 'เงื่อนไขการคืนสินค้า',
      topK: 3,
      alpha: 0.5,
    })

    expect(embeddingProvider).toHaveBeenCalledWith('เงื่อนไขการคืนสินค้า')
    expect(db.hybridSearch).toHaveBeenCalledWith({
      queryVector: [0.9, 0.1, 0.0, 0.0],
      k: 3,
      alpha: 0.5,
    })

    expect(result.hitCount).toBe(1)
    expect(result.combinedContextText).toContain('FAQ 1')
    expect(result.combinedContextText).toContain('Return allowed within 7 days.')
  })

  it('executes end-to-end agent turns with LLM provider', async () => {
    const db = createMockDb()
    const embeddingProvider = vi.fn().mockResolvedValue([0.9, 0.1, 0.0, 0.0])
    const llmProvider = vi.fn().mockResolvedValue('สามารถคืนสินค้าได้ภายใน 7 วันครับ')
    const service = createGenesisBlockDbRagService({ db, embeddingProvider, llmProvider })

    const turnResult = await service.executeAgentTurnWithRag({
      queryText: 'ขอคืนเงินได้ไหม?',
    })

    expect(llmProvider).toHaveBeenCalledWith({
      prompt: expect.stringContaining('[Context from Knowledge Graph]:'),
      systemPrompt: expect.stringContaining('ตอบคำถามธุรกิจ'),
    })
    expect(turnResult.responseText).toBe('สามารถคืนสินค้าได้ภายใน 7 วันครับ')
    expect(turnResult.hitCount).toBe(1)
  })
})
