import { describe, expect, it } from 'vitest'

import { createGksMarketIdentityResolver } from '@/modules/market-intelligence/infrastructure/gks-market-identity-resolver'
import { MARKET_RESOLUTION_STATUS } from '@/modules/market-intelligence/domain/market-observation'
import { createInMemoryBusinessKnowledgeReader } from '@/modules/knowledge/business-contract'

const baseRecord = {
  knowledge_id: 'KN-RTX3060',
  business_id: 'business-a',
  knowledge_type: 'PRODUCT',
  product_code: 'RTX-3060',
  name: 'GALAX RTX 3060 12GB',
  category: 'GPU',
  description: 'GeForce RTX 3060 graphics card',
  unit: 'unit',
  sell_price: 4900,
  currency: 'THB',
  moq: 1,
  colors: [],
  specification: { vramGb: 12 },
  source_ref: 'test://approved-product/rtx3060',
  source_sha256: 'a'.repeat(64),
  as_of: '2026-08-20T00:00:00.000Z',
  approved_at: '2026-08-20T00:00:00.000Z',
  is_active: true,
  sensitivity: 'PUBLIC',
  contract_version: '1.0.0',
}

describe('Market identity resolution over real governed Knowledge contract (#76)', () => {
  it('resolves one exact approved product through registered product_search', async () => {
    const reader = createInMemoryBusinessKnowledgeReader([baseRecord])
    const resolve = createGksMarketIdentityResolver({
      reader,
      businessId: 'business-a',
    })

    const result = await resolve({
      candidate: { title: 'GALAX RTX 3060 12GB' },
    })

    expect(result).toEqual({
      status: MARKET_RESOLUTION_STATUS.RESOLVED,
      canonicalProductRef: 'gks:business-knowledge:KN-RTX3060',
      canonicalCategoryRef: null,
      confidence: 1,
    })
  })

  it('cannot resolve a product approved for another Business', async () => {
    const reader = createInMemoryBusinessKnowledgeReader([baseRecord])
    const resolve = createGksMarketIdentityResolver({
      reader,
      businessId: 'business-b',
    })

    const result = await resolve({
      candidate: { title: 'GALAX RTX 3060 12GB' },
    })

    expect(result.status).toBe(MARKET_RESOLUTION_STATUS.UNRESOLVED)
    expect(result.canonicalProductRef).toBeNull()
  })

  it('keeps fuzzy search evidence PARTIAL instead of minting a canonical identity', async () => {
    const reader = createInMemoryBusinessKnowledgeReader([baseRecord])
    const resolve = createGksMarketIdentityResolver({
      reader,
      businessId: 'business-a',
    })

    const result = await resolve({
      candidate: { title: 'cheap RTX 3060 used' },
    })

    expect(result.status).toBe(MARKET_RESOLUTION_STATUS.PARTIAL)
    expect(result.canonicalProductRef).toBeNull()
  })
})
