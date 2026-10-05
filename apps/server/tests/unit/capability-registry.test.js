// @req FR-124
// @spec docs/FEATURES.md, ADR-025
// @tested tests/unit/capability-registry.test.js
import { describe, expect, it } from 'vitest'
import { parseFeatureBundles, classifyRequirements, assertCapabilityTerminology, capabilityInventory } from '../../scripts/capability-registry.mjs'
import { buildDomainState } from '../../scripts/domain-state.mjs'

const fr = n => `FR-${String(n).padStart(3, '0')}`
const feat = n => `FEAT-${String(n).padStart(3, '0')}`
const nodes = [
  { id: 'domain:identity', type: 'domain', modules: ['identity'] },
  ...[1, 2].map(n => ({ id: `req:${fr(n)}`, type: 'requirement', family: 'FR', label: `Behavior ${n}`, declared: 'planned' })),
  { id: `feat:${feat(1)}`, type: 'feature', label: 'Capability', declared: 'building' },
]
const edge = (f, r) => ({ from: `feat:${feat(f)}`, to: `req:${fr(r)}`, type: 'bundles' })
const edges = [edge(1, 1)]
const metadata = id => ({ id, primaryDomain: 'identity', useCase: 'A person can use this behavior.' })
const featurePresentation = [metadata(feat(1)), metadata(fr(2))]
const build = (overrides = {}) => buildDomainState({ nodes, edges, featurePresentation, ...overrides })

describe('capability classification', () => {
  it('partitions every FR without allocating an identity, including a deliberate one-FR FEAT', () => {
    expect(classifyRequirements(nodes, edges)).toEqual([
      { id: fr(1), classification: 'bundled-fr', featureId: feat(1) },
      { id: fr(2), classification: 'standalone-fr', featureId: null },
    ])
    expect(build().features.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: feat(1), kind: 'bundle' }, { id: fr(2), kind: 'requirement' },
    ])
  })

  it('rejects multiple membership even when called directly without presentation', () => {
    const competing = [...nodes, { id: `feat:${feat(2)}`, type: 'feature' }]
    expect(() => build({ nodes: competing, edges: [...edges, edge(2, 1)], featurePresentation: null }))
      .toThrow('belongs to multiple FEATs')
  })

  it('rejects unknown FRs, duplicate edges and empty bundles before projection', () => {
    expect(() => build({ edges: [edge(1, 99)] })).toThrow('bundles unknown FR')
    expect(() => build({ edges: [...edges, ...edges] })).toThrow('repeats an FR')
    expect(() => build({ edges: [] })).toThrow('must bundle at least one FR')
  })

  it('rejects repeated FRs in raw rows before a graph can deduplicate them', () => {
    const row = `| ${feat(1)} | Product \\| capability | ${fr(1)} | live |`
    expect(parseFeatureBundles(row)[0]).toMatchObject({ title: 'Product | capability', requirementIds: [fr(1)] })
    expect(() => parseFeatureBundles(`${row}\n${row}`)).toThrow('Duplicate Feature bundle')
    expect(() => parseFeatureBundles(`| ${feat(1)} | Capability | ${fr(1)}, ${fr(1)} | live |`)).toThrow('repeats an FR')
    expect(() => parseFeatureBundles(`| ${feat(1)} | Capability | | live |`)).toThrow('must bundle at least one FR')
  })

  it('requires standalone metadata and refuses stale standalone projection after bundling', () => {
    expect(() => build({ featurePresentation: [metadata(feat(1))] })).toThrow(`missing projected features: ${fr(2)}`)
    expect(() => build({ edges: [...edges, edge(1, 2)] })).toThrow(`non-projected features: ${fr(2)}`)
    const later = build({ edges: [...edges, edge(1, 2)], featurePresentation: [metadata(feat(1))] })
    expect(later.features).toHaveLength(1)
    expect(later.features[0].requirementIds).toEqual([fr(1), fr(2)])
  })

  it('inventories every FR deterministically and does not turn presentation into ownership', () => {
    const state = build()
    const inventory = capabilityInventory(nodes, edges, state, new Map([['identity', [fr(1)]]]))
    expect(inventory).toHaveLength(2)
    expect(inventory[0]).toMatchObject({ owningDomains: ['identity'], readinessId: feat(1), metadataPresent: true, useCasePresent: true })
    expect(inventory[1]).toMatchObject({ owningDomains: [], primaryDomain: 'identity', evidenceState: 'planned', codeCount: 0, testCount: 0 })
    expect(capabilityInventory([...nodes].reverse(), edges, state, new Map([['identity', [fr(1)]]]))).toEqual(inventory)
  })

  it('rejects retired vocabulary across Markdown formatting and line breaks', () => {
    for (const body of ['an FR is implicitly a feature of one', 'implicit\n**feature** of one', 'feature-of-one']) {
      expect(() => assertCapabilityTerminology([{ path: 'docs/FEATURES.md', body }])).toThrow('retired capability terminology')
    }
    expect(() => assertCapabilityTerminology([{ path: 'docs/FEATURES.md', body: 'A Standalone FR remains a Functional Requirement; it is not an implicit or synthetic Feature.' }])).not.toThrow()
  })
})
