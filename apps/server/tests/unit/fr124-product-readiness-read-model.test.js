// @req FR-124 — the read model exposes one complete generated projection, fails
// closed for unknown domain drilldowns, and refuses to render before a viewer
// with Platform visibility has been resolved on the server.
// @spec docs/domains/project-manager/features/FR-124-product-readiness-dashboard.md, FR-060, SEC-008
// @tested tests/unit/fr124-product-readiness-read-model.test.js
import { describe, expect, it } from 'vitest'
import {
  getProductReadinessDomain,
  getProductReadinessSnapshot,
  resolveProductReadinessDecision,
} from '@/modules/project-manager/application/product-readiness-read-model'
import { PROGRESS_METHODOLOGY } from '../../scripts/domain-state.mjs'

describe('FR-124 product readiness read model', () => {
  it('returns the complete evidence-backed snapshot without duplicate feature ids', () => {
    const snapshot = getProductReadinessSnapshot()

    expect(snapshot.schemaVersion).toBe('1.1')
    // Asserted against the generator's own constant, not against a copy of the
    // three numbers. A test that repeats the weighting cannot notice the
    // weighting changing; this one notices the snapshot and the generator
    // disagreeing, which is the failure that can actually happen.
    expect(snapshot.progressMethodology).toEqual(PROGRESS_METHODOLOGY)

    // Deliberately not a feature count. The rescued draft pinned 80 features and
    // 94 requirements; both numbers were already wrong by the time this landed,
    // and a count assertion fails on every ordinary FR addition while proving
    // nothing about the projection. These invariants hold at any size.
    expect(snapshot.features.length).toBeGreaterThan(0)
    expect(new Set(snapshot.features.map((feature) => feature.id)).size).toBe(snapshot.features.length)
    expect(snapshot.overall.featureCount).toBe(snapshot.features.length)
    expect(snapshot.features.every((feature) => feature.useCase.trim().length > 0)).toBe(true)
    expect(snapshot.features.every((feature) => snapshot.domains[feature.primaryDomain])).toBe(true)
    expect(snapshot.overall.verifiedRequirementCount).toBeLessThanOrEqual(snapshot.overall.requirementCount)
  })

  it('projects every declared FR exactly once, bundled or standalone', () => {
    const snapshot = getProductReadinessSnapshot()
    const projected = snapshot.features.flatMap((feature) => feature.requirementIds)

    expect(new Set(projected).size).toBe(projected.length)
    expect(projected.length).toBe(snapshot.overall.requirementCount)
  })

  it('returns only primary-domain features and rejects unknown domains', () => {
    const snapshot = getProductReadinessSnapshot()
    const [name] = Object.keys(snapshot.domains).filter((key) => snapshot.domains[key].featureCount > 0)
    const scoped = getProductReadinessDomain(name)

    expect(scoped.domainName).toBe(name)
    expect(scoped.features.length).toBe(scoped.domain.featureCount)
    expect(scoped.features.every((feature) => feature.primaryDomain === name)).toBe(true)
    expect(getProductReadinessDomain('not-a-domain')).toBeNull()
    expect(getProductReadinessDomain('')).toBeNull()
    expect(getProductReadinessDomain(undefined)).toBeNull()
  })

  it('fails closed for a viewer that is absent, errored or without Platform visibility', () => {
    expect(resolveProductReadinessDecision({})).toMatchObject({ state: 'AUTH_REQUIRED', redirect: '/login' })
    expect(resolveProductReadinessDecision({ viewer: { visibleDomains: ['platform'] }, viewerError: new Error('x') }))
      .toMatchObject({ state: 'AUTH_REQUIRED' })
    expect(resolveProductReadinessDecision({ viewer: { visibleDomains: ['projects', 'crm'] } }))
      .toMatchObject({ state: 'FORBIDDEN' })
    expect(resolveProductReadinessDecision({ viewer: { visibleDomains: ['projects', 'platform'] } }))
      .toMatchObject({ state: 'READY' })
  })
})
