// @req FR-024 — Unit tests for SmartGift Domain RAG Pipeline.
// @spec ADR-007 §P5 — Verify SmartGift catalog seeding, collection isolation, and LINE prompt assembly.
// @tested src/modules/knowledge/smartgift-rag-pipeline.js

import { describe, expect, it, vi } from 'vitest'
import {
  seedSmartGiftKnowledge,
  searchSmartGiftKnowledge,
  handleSmartGiftCustomerTurn,
  SMARTGIFT_COLLECTION,
} from '../../src/modules/knowledge/smartgift-rag-pipeline.js'

describe('smartgift-rag-pipeline', () => {
  const createMockDb = () => ({
    addNode: vi.fn().mockResolvedValue({ status: 'ok' }),
    addEdge: vi.fn().mockResolvedValue({ status: 'ok' }),
    flushIndex: vi.fn().mockResolvedValue({ status: 'ok' }),
    hybridSearch: vi.fn().mockResolvedValue([
      {
        node: {
          id: 'prod:sg-tumbler-500',
          labels: ['Product', 'SmartGift'],
          props: {
            title: 'กระบอกน้ำสุญญากาศสแตนเลส 304 ขนาด 500ml',
            text: 'กระบอกน้ำเก็บอุณหภูมิร้อน-เย็นได้ 12-24 ชั่วโมง รองรับสกรีนโลโก้ UV',
            code: 'SG-TM-500',
            moq: 50,
            printingMethods: 'Laser Engraving, UV Color Print, Silkscreen',
          },
        },
        score: 0.94,
      },
      {
        node: {
          id: 'policy:sg-sample-mockup',
          labels: ['Policy', 'SmartGift'],
          props: {
            title: 'นโยบายการขึ้นตัวอย่างและการทำ Digital Proof',
            text: 'ทำ Digital Mockup ฟรีภายใน 24 ชม.',
          },
        },
        score: 0.82,
      },
    ]),
  })

  it('seeds SmartGift knowledge catalog with collections and graph edges', async () => {
    const db = createMockDb()
    const embeddingProvider = vi.fn().mockResolvedValue([0.1, 0.2, 0.3, 0.4])

    const result = await seedSmartGiftKnowledge({ db, embeddingProvider })

    expect(result.status).toBe('ok')
    expect(result.categoryCount).toBeGreaterThan(0)
    expect(result.productCount).toBeGreaterThan(0)
    expect(result.policyCount).toBeGreaterThan(0)

    // Verify all nodes passed collection: 'smartgift'
    expect(db.addNode).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: SMARTGIFT_COLLECTION,
      }),
    )

    // Verify edge was added
    expect(db.addEdge).toHaveBeenCalledWith(
      expect.objectContaining({
        rel: 'BELONGS_TO',
      }),
    )
    expect(db.flushIndex).toHaveBeenCalled()
  })

  it('searches SmartGift knowledge base and formats context with MOQ', async () => {
    const db = createMockDb()
    const embeddingProvider = vi.fn().mockResolvedValue([0.9, 0.1, 0.0, 0.0])

    const searchResult = await searchSmartGiftKnowledge({
      db,
      queryText: 'อยากได้กระบอกน้ำสกรีนโลโก้',
      embeddingProvider,
      topK: 2,
    })

    expect(db.hybridSearch).toHaveBeenCalledWith({
      queryVector: [0.9, 0.1, 0.0, 0.0],
      k: 2,
      alpha: 0.5,
      collection: SMARTGIFT_COLLECTION,
    })

    expect(searchResult.hits.length).toBe(2)
    expect(searchResult.contextText).toContain('กระบอกน้ำสุญญากาศสแตนเลส 304')
    expect(searchResult.contextText).toContain('ขั้นต่ำ (MOQ): 50 ชิ้น')
    expect(searchResult.contextText).toContain('Laser Engraving')
  })

  it('handles SmartGift customer turns with custom persona and LLM call', async () => {
    const db = createMockDb()
    const embeddingProvider = vi.fn().mockResolvedValue([0.8, 0.2, 0.0, 0.0])
    const llmProvider = vi.fn().mockResolvedValue('สวัสดีครับ! น้องกิฟต์ขอแนะนำกระบอกน้ำสแตนเลส 304 ขั้นต่ำ 50 ชิ้นครับ')

    const turn = await handleSmartGiftCustomerTurn({
      db,
      userMessage: 'มีกระบอกน้ำแนะนำไหม ขั้นต่ำกี่ใบ?',
      embeddingProvider,
      llmProvider,
    })

    expect(llmProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining('น้องกิฟต์'),
        prompt: expect.stringContaining('กระบอกน้ำสุญญากาศสแตนเลส 304'),
      }),
    )

    expect(turn.responseText).toContain('น้องกิฟต์')
    expect(turn.contextItems.length).toBe(2)
  })
})
