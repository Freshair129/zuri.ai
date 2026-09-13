// @req FR-211 — the Domain map & inventory tab: each domain's features, FRs and
// NFRs with their readiness, projected from the committed domain-state snapshot.
// @spec ADR-048 D3, SDD-055, FR-124
// @tested tests/unit/platform-control-domain-map.test.js
//
// A pure function of the snapshot FR-124 already publishes. It measures
// nothing, fetches nothing and invents no status: every number here is a count
// over the snapshot, and every status is the snapshot's own word. It exists so
// the client receives a trimmed projection (no evidence path lists) instead of
// the whole generated file.

const DOMAIN_LABELS = {
  agent: 'Agent',
  'asset-management': 'Asset Management',
  commerce: 'Commerce',
  crm: 'CRM',
  identity: 'Identity & Access',
  integration: 'Integration',
  inventory: 'Inventory',
  knowledge: 'Knowledge',
  'line-oa-studio': 'LINE OA Studio',
  'market-intelligence': 'Market Intelligence',
  marketing: 'Marketing',
  'platform-control': 'Platform Control',
  procurement: 'Procurement',
  'project-manager': 'Project Manager',
}

export function domainLabel(name) {
  return DOMAIN_LABELS[name] ?? name.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

// The same subject rule the generator applies to requirement statements, for
// FEAT titles, which the snapshot keeps whole because FR-124 prints them whole.
export function featureSubject(title = '') {
  const plain = String(title).replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim()
  const stop = plain.indexOf(' — ')
  if (stop >= 12 && stop <= 140) return plain.slice(0, stop)
  return plain.length > 140 ? `${plain.slice(0, 137).trim()}…` : plain
}

const requirementRow = ({ id, title, status, codeCount, testCount }) => ({ id, title: title || id, status, codeCount, testCount })

export function projectDomainMap(snapshot) {
  const nonFunctional = snapshot.nonFunctionalRequirements ?? []
  const domains = Object.entries(snapshot.domains)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, domain]) => {
      const features = snapshot.features
        .filter((feature) => feature.primaryDomain === name)
        .map((feature) => ({
          id: feature.id,
          title: featureSubject(feature.title),
          kind: feature.kind,
          registryStatus: feature.registryStatus,
          readiness: feature.readiness,
          progressPercent: feature.progressPercent,
          useCase: feature.useCase,
          blockers: feature.blockers,
          requirementIds: feature.requirementIds,
          contributorDomains: feature.contributorDomains.filter((other) => other !== name),
        }))
      // The domain's FRs are the ones its primary features bundle — the same set
      // FR-124's domain roll-up averages, so the counts agree with that page.
      const frById = new Map()
      for (const feature of snapshot.features.filter((item) => item.primaryDomain === name)) {
        for (const requirement of feature.requirements) {
          const row = frById.get(requirement.id) ?? { ...requirementRow(requirement), featureIds: [] }
          row.featureIds.push(feature.id)
          frById.set(requirement.id, row)
        }
      }
      const functional = [...frById.values()].sort((a, b) => a.id.localeCompare(b.id))
      const nfr = nonFunctional.filter((item) => item.domains.includes(name)).map(requirementRow)
      return {
        name,
        label: domainLabel(name),
        status: domain.status,
        progressPercent: domain.progressPercent,
        featureCount: domain.featureCount,
        readyFeatureCount: domain.readyFeatureCount,
        functional,
        verifiedFunctionalCount: functional.filter((item) => item.status === 'verified').length,
        nonFunctional: nfr,
        checks: Object.entries(domain.checks).map(([check, value]) => ({ check, status: value.status })),
        gaps: domain.gaps.map(({ id, severity, check, summary }) => ({ id, severity, check, summary })),
        features,
      }
    })

  return {
    methodology: {
      declarationWeight: snapshot.progressMethodology.declarationWeight,
      codeWeight: snapshot.progressMethodology.codeWeight,
      testWeight: snapshot.progressMethodology.testWeight,
      readinessRule: snapshot.progressMethodology.readinessRule,
    },
    overall: {
      domainCount: snapshot.overall.domainCount,
      featureCount: snapshot.overall.featureCount,
      readyFeatureCount: snapshot.overall.readyFeatureCount,
      requirementCount: snapshot.overall.requirementCount,
      verifiedRequirementCount: snapshot.overall.verifiedRequirementCount,
      progressPercent: snapshot.overall.progressPercent,
      gapCount: snapshot.overall.gapCount,
      nonFunctionalCount: nonFunctional.length,
      verifiedNonFunctionalCount: nonFunctional.filter((item) => item.status === 'verified').length,
    },
    domains,
    unanchoredNonFunctional: nonFunctional.filter((item) => item.domains.length === 0).map(requirementRow),
  }
}
