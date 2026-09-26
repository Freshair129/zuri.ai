import { describe, expect, it } from 'vitest'
import { makeViewer } from '../../../factories/viewer'
import { viewerCanReadBinding } from '@/modules/marketing/insights/application/insight-scope-authority'
import { fixtureBindings, FX_BUSINESS } from '../../../fixtures/marketing-insights/fixture-insights-repository'

const bindings = fixtureBindings()
const glowcea = bindings.find((binding) => binding.brandSlug === 'glowcea')
const infresh = bindings.find((binding) => binding.brandSlug === 'infresh')

describe('insight scope authority', () => {
  it('allows a Business the viewer sees with the growth domain', () => {
    const viewer = makeViewer({ principal: { id: 'fx-member' }, visibleBusinessIds: [FX_BUSINESS.glowcea], visibleDomains: ['growth'] })
    const canRead = viewerCanReadBinding(viewer)
    expect(canRead(glowcea)).toBe(true)
    expect(canRead(infresh)).toBe(false)
  })

  it('refuses when the growth domain is hidden, even for a visible Business', () => {
    const viewer = makeViewer({ principal: { id: 'fx-no-growth' }, visibleBusinessIds: [FX_BUSINESS.glowcea], visibleDomains: ['projects'] })
    expect(viewerCanReadBinding(viewer)(glowcea)).toBe(false)
  })

  it('same Tenant does not imply every Business', () => {
    const viewer = makeViewer({ principal: { id: 'fx-one' }, visibleBusinessIds: [FX_BUSINESS.infresh], visibleDomains: ['growth'] })
    const canRead = viewerCanReadBinding(viewer)
    expect(bindings.filter(canRead).map((binding) => binding.brandSlug)).toEqual(['infresh', 'infresh', 'infresh'])
  })

  it('requires a viewer', () => {
    expect(() => viewerCanReadBinding(null)).toThrow()
  })
})
