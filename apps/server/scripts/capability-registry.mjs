// @req FR-124 — complete, disjoint Feature and Standalone FR readiness items.
// @spec docs/FEATURES.md, ADR-025
// @tested tests/unit/capability-registry.test.js
import { splitRow } from './id-anchors.mjs'

// Validate raw rows before graph edge deduplication can hide a repeated FR.
export function parseFeatureBundles(source) {
  const rows = []
  const seen = new Set()
  for (const line of source.split(/\r?\n/)) {
    if (!/^\|\s*FEAT-\d{3}\s*\|/.test(line)) continue
    const [, id, title, members, status] = splitRow(line)
    if (seen.has(id)) throw new Error(`Duplicate Feature bundle ${id}`)
    seen.add(id)
    const requirementIds = members.match(/FR-\d{3}/g) || []
    if (!requirementIds.length) throw new Error(`${id} must bundle at least one FR`)
    if (new Set(requirementIds).size !== requirementIds.length) throw new Error(`${id} repeats an FR in its bundle`)
    rows.push({ id, title, requirementIds, status })
  }
  return rows
}

// Uses the canonical graph, not a second membership registry.
export function classifyRequirements(nodes, edges) {
  const requirements = nodes.filter(n => n.type === 'requirement' && n.family === 'FR')
  const known = new Set(requirements.map(n => n.id))
  const bundles = new Map(nodes.filter(n => n.type === 'feature').map(n => [n.id, []]))
  const membership = new Map()
  for (const edge of edges.filter(e => e.type === 'bundles')) {
    if (!bundles.has(edge.from)) throw new Error(`Unknown Feature bundle ${edge.from}`)
    if (!known.has(edge.to)) throw new Error(`${edge.from} bundles unknown FR ${edge.to}`)
    const members = bundles.get(edge.from)
    if (members.includes(edge.to)) throw new Error(`${edge.from} repeats an FR in its bundle: ${edge.to}`)
    members.push(edge.to)
    if (membership.has(edge.to)) throw new Error(`${edge.to} belongs to multiple FEATs: ${membership.get(edge.to)}, ${edge.from}`)
    membership.set(edge.to, edge.from)
  }
  for (const [id, members] of bundles) {
    if (!members.length) throw new Error(`${id} must bundle at least one FR`)
  }
  return requirements.sort((a, b) => a.id.localeCompare(b.id)).map(r => ({
    id: r.id.slice(4),
    classification: membership.has(r.id) ? 'bundled-fr' : 'standalone-fr',
    featureId: membership.get(r.id)?.slice(5) ?? null,
  }))
}

// A vocabulary guard over enumerated live documentation; membership itself is
// validated structurally above. Archives are excluded by the graph/preflight scan.
export function assertCapabilityTerminology(documents) {
  for (const { path, body } of documents) {
    const prose = body.replace(/[`*_]/g, '').replace(/\s+/g, ' ')
    if (/\bfeature[ -]of[ -]one\b|\bimplicit(?:ly)?\s+(?:a\s+)?feature\b/i.test(prose)) {
      throw new Error(`${path}: retired capability terminology; use Standalone FR`)
    }
  }
}

export function capabilityInventory(nodes, edges, readiness, noteOwnership = new Map()) {
  return classifyRequirements(nodes, edges).map(row => {
    const item = readiness.features.find(f => f.id === (row.featureId || row.id))
    const evidence = item?.requirements.find(r => r.id === row.id)
    return {
      ...row,
      owningDomains: [...noteOwnership].filter(([, ids]) => ids.includes(row.id)).map(([name]) => name).sort(),
      implementationDomains: Object.entries(readiness.domains)
        .filter(([, domain]) => domain.requirements.some(r => r.id === row.id && r.codeCount > 0))
        .map(([name]) => name).sort(),
      readinessId: item?.id ?? null,
      primaryDomain: item?.primaryDomain ?? null,
      metadataPresent: Boolean(item),
      useCasePresent: Boolean(item?.useCase?.trim()),
      evidenceState: evidence?.status ?? 'unknown',
      codeCount: evidence?.codeCount ?? 0,
      testCount: evidence?.testCount ?? 0,
    }
  })
}
