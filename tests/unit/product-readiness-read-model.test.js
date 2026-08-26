// @req FR-094 — the read model exposes one complete generated projection and
// fails closed for unknown domain drilldowns.
// @spec docs/domains/project-manager/features/FR-094-domain-feature-readiness-dashboard.md
// @tested tests/unit/product-readiness-read-model.test.js
import { describe, expect, it } from 'vitest'
import {
  getProductReadinessDomain,
  getProductReadinessSnapshot,
} from '@/modules/project-manager/application/product-readiness-read-model'

describe('product readiness read model', () => {
  it('returns the complete evidence-backed snapshot without duplicate feature ids', () => {
    const snapshot = getProductReadinessSnapshot()

    expect(snapshot.schemaVersion).toBe('1.1')
    expect(snapshot.progressMethodology).toMatchObject({
      declarationWeight: 20,
      codeWeight: 40,
      testWeight: 40,
    })
    expect(snapshot.features).toHaveLength(80)
    expect(new Set(snapshot.features.map((feature) => feature.id)).size).toBe(80)
    expect(snapshot.features.every((feature) => feature.useCase.trim().length > 0)).toBe(true)
    expect(snapshot.overall.featureCount).toBe(80)
    expect(snapshot.overall.requirementCount).toBe(94)
  })

  it('returns only primary-domain features and rejects unknown domains', () => {
    const crm = getProductReadinessDomain('crm')

    expect(crm.domainName).toBe('crm')
    expect(crm.features.length).toBe(crm.domain.featureCount)
    expect(crm.features.every((feature) => feature.primaryDomain === 'crm')).toBe(true)
    expect(getProductReadinessDomain('not-a-domain')).toBeNull()
  })
})
