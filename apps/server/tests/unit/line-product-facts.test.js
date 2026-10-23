import { describe, expect, it } from 'vitest'
import { parseLineProductFactsRequest } from '@/modules/agent/line-product-facts'

// @req FR-291 — only an explicit, strictly typed product command can enter the
// customer-safe stock/price reader; malformed commands never become LLM turns.
// @tested tests/unit/line-product-facts.test.js

describe('LINE product facts request parser', () => {
  it('returns null for ordinary text and non-command prefixes', () => {
    expect(parseLineProductFactsRequest('มีแก้วสีดำไหม')).toBeNull()
    expect(parseLineProductFactsRequest('#products {"sku":"MUG-1"}')).toBeNull()
  })

  it('accepts an exact availability request without a quantity', () => {
    expect(parseLineProductFactsRequest('#product {"sku":"MUG-01","facets":["availability"]}'))
      .toEqual({ request: { sku: 'MUG-01', facets: ['availability'] }, clarification: null })
  })

  it('accepts price only with a positive safe integer and unit', () => {
    expect(parseLineProductFactsRequest('#product {"sku":"MUG-01","facets":["price"],"quantity":10,"unit":"piece"}'))
      .toEqual({ request: { sku: 'MUG-01', facets: ['price'], quantity: 10, unit: 'piece' }, clarification: null })
  })

  it.each([
    ['missing JSON', '#product'],
    ['invalid JSON', '#product {not-json}'],
    ['unknown field', '#product {"sku":"MUG-01","facets":["availability"],"businessId":"foreign"}'],
    ['duplicate facet', '#product {"sku":"MUG-01","facets":["price","price"],"quantity":1,"unit":"EA"}'],
    ['quantity without price', '#product {"sku":"MUG-01","facets":["availability"],"quantity":1,"unit":"EA"}'],
    ['price without quantity', '#product {"sku":"MUG-01","facets":["price"]}'],
    ['fractional quantity', '#product {"sku":"MUG-01","facets":["price"],"quantity":1.5,"unit":"EA"}'],
    ['unsafe quantity', '#product {"sku":"MUG-01","facets":["price"],"quantity":9007199254740992,"unit":"EA"}'],
    ['trailing material', '#product {"sku":"MUG-01","facets":["availability"]} please'],
  ])('returns a bounded clarification for %s', (_label, input) => {
    expect(parseLineProductFactsRequest(input)).toMatchObject({ request: null, clarification: { code: 'INVALID_REQUEST' } })
  })
})
