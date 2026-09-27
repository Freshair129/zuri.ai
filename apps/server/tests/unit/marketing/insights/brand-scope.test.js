import { describe, expect, it } from 'vitest'
import { resolveInsightScope, listReadableBrands, BRAND_SLUGS } from '@/modules/marketing/insights/domain/brand-scope'
import { fixtureBindings, FX_BUSINESS } from '../../../fixtures/marketing-insights/fixture-insights-repository'

const bindings = fixtureBindings()
const readsOnly = (...businessIds) => (binding) => businessIds.includes(binding.businessId)

describe('brand scope', () => {
  it('keeps the three contract brand slugs', () => {
    expect(BRAND_SLUGS).toEqual(['infresh', 'glowcea', '056laos'])
  })

  it('resolves every brand for a viewer allowed all three, one exact asset each', () => {
    const canRead = readsOnly(FX_BUSINESS.infresh, FX_BUSINESS.glowcea, FX_BUSINESS.laos)
    expect(resolveInsightScope({ brand: 'infresh', bindings, canRead }).asset.bindingId).toBe('fx-asset-infresh-page-a')
    expect(resolveInsightScope({ brand: 'glowcea', bindings, canRead }).asset.bindingId).toBe('fx-asset-glowcea-page')
    expect(resolveInsightScope({ brand: '056laos', bindings, canRead }).asset.bindingId).toBe('fx-asset-056laos-page')
  })

  it('lists several Pages of one brand, excluding ad accounts in tranche 1 and revoked bindings', () => {
    const scope = resolveInsightScope({ brand: 'infresh', bindings, canRead: readsOnly(FX_BUSINESS.infresh) })
    expect(scope.assets.map((asset) => asset.assetId)).toEqual(['fx-asset-infresh-page-a', 'fx-asset-infresh-page-b'])
    const laos = resolveInsightScope({ brand: '056laos', bindings, canRead: readsOnly(FX_BUSINESS.laos) })
    expect(laos.assets.map((asset) => asset.assetId)).toEqual(['fx-asset-056laos-page'])
  })

  it('a brand parameter grants nothing: unreadable, unknown and cross-brand assets are one 404 shape', () => {
    const canRead = readsOnly(FX_BUSINESS.infresh)
    const cases = [
      { brand: 'glowcea' },
      { brand: 'not-a-brand' },
      { brand: 'infresh', assetId: 'fx-asset-glowcea-page' },
      { brand: 'infresh', assetId: 'fx-asset-infresh-ads' },
      { brand: '056laos', assetId: 'fx-asset-056laos-old' },
    ]
    for (const input of cases) {
      let caught
      try { resolveInsightScope({ ...input, bindings, canRead }) } catch (error) { caught = error }
      expect(caught, JSON.stringify(input)).toMatchObject({ code: 'SCOPE_NOT_FOUND', status: 404, message: 'Insights scope not found' })
    }
  })

  it('lists only readable brands and says nothing about the others', () => {
    expect(listReadableBrands({ bindings, canRead: readsOnly(FX_BUSINESS.glowcea) })).toEqual(['glowcea'])
    expect(listReadableBrands({ bindings, canRead: () => false })).toEqual([])
  })

  it('requires an authority predicate', () => {
    expect(() => resolveInsightScope({ brand: 'infresh', bindings })).toThrow(/canRead/)
  })
})
