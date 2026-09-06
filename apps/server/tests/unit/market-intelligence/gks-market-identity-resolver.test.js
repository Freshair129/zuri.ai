import { describe, expect, it, vi } from 'vitest'

import { MARKET_RESOLUTION_STATUS } from '@/modules/market-intelligence/application/translate-raw-record'
import { createGksMarketIdentityResolver } from '@/modules/market-intelligence/infrastructure/gks-market-identity-resolver'

function createReader(records) {
  return {
    query: vi.fn(async (input) => ({
      queryId: input.queryId,
      businessId: input.businessId,
      records,
    })),
  }
}

const governedProduct = {
  knowledge_id: 'KN-RTX3060',
  product_code: 'RTX-3060',
  name: 'GALAX RTX 3060 12GB',
  category: 'GPU',
}

describe('Market -> governed Knowledge identity resolver (#76)', () => {
  it('returns UNRESOLVED without Business scope instead of querying globally', async () => {
    const reader = createReader([governedProduct])
    const resolve = createGksMarketIdentityResolver({ reader, businessId: null })

    const result = await resolve({ candidate: { title: governedProduct.name } })

    expect(result.status).toBe(MARKET_RESOLUTION_STATUS.UNRESOLVED)
    expect(reader.query).not.toHaveBeenCalled()
  })

  it('resolves one exact governed product name', async () => {
    const reader = createReader([governedProduct])
    const resolve = createGksMarketIdentityResolver({ reader, businessId: 'business-a' })

    const result = await resolve({ candidate: { title: 'GALAX RTX 3060 12GB' } })

    expect(reader.query).toHaveBeenCalledWith({
      businessId: 'business-a',
      queryId: 'product_search',
      params: { term: 'GALAX RTX 3060 12GB' },
      limit: 5,
    })
    expect(result).toEqual({
      status: MARKET_RESOLUTION_STATUS.RESOLVED,
      canonicalProductRef: 'gks:business-knowledge:KN-RTX3060',
      canonicalCategoryRef: null,
      confidence: 1,
    })
  })

  it('resolves one exact governed product code', async () => {
    const reader = createReader([governedProduct])
    const resolve = createGksMarketIdentityResolver({ reader, businessId: 'business-a' })

    const result = await resolve({ candidate: { productCode: 'rtx-3060' } })

    expect(result.status).toBe(MARKET_RESOLUTION_STATUS.RESOLVED)
    expect(result.canonicalProductRef).toBe('gks:business-knowledge:KN-RTX3060')
  })

  it('returns PARTIAL when search evidence exists but no exact governed identity exists', async () => {
    const reader = createReader([governedProduct])
    const resolve = createGksMarketIdentityResolver({ reader, businessId: 'business-a' })

    const result = await resolve({ candidate: { title: 'RTX 3060 cheap used' } })

    expect(result).toEqual({
      status: MARKET_RESOLUTION_STATUS.PARTIAL,
      canonicalProductRef: null,
      canonicalCategoryRef: null,
      confidence: null,
    })
  })

  it('returns PARTIAL rather than guessing when multiple exact records collide', async () => {
    const reader = createReader([
      governedProduct,
      { ...governedProduct, knowledge_id: 'KN-RTX3060-DUP' },
    ])
    const resolve = createGksMarketIdentityResolver({ reader, businessId: 'business-a' })

    const result = await resolve({ candidate: { title: governedProduct.name } })

    expect(result.status).toBe(MARKET_RESOLUTION_STATUS.PARTIAL)
    expect(result.canonicalProductRef).toBeNull()
  })

  it('does not manufacture a canonical category ref from the current category label field', async () => {
    const reader = createReader([governedProduct])
    const resolve = createGksMarketIdentityResolver({ reader, businessId: 'business-a' })

    const result = await resolve({ candidate: { title: governedProduct.name } })

    expect(result.status).toBe(MARKET_RESOLUTION_STATUS.RESOLVED)
    expect(result.canonicalCategoryRef).toBeNull()
  })

  it('returns UNRESOLVED when governed search has no evidence', async () => {
    const reader = createReader([])
    const resolve = createGksMarketIdentityResolver({ reader, businessId: 'business-a' })

    const result = await resolve({ candidate: { title: 'Unknown product' } })

    expect(result.status).toBe(MARKET_RESOLUTION_STATUS.UNRESOLVED)
  })
})
