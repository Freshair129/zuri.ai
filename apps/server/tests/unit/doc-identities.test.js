// @spec docs/GOVERNANCE-LINK-METADATA.md
import { it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { qualifyDocumentIds, assertUniqueNodeIds, collectDocumentClaims, indexDeclaredIdentities, isGeneratedDocumentView, requiresSuccessor } from '../../scripts/doc-identities.mjs'
import { collectDeclared } from '../../scripts/id-anchors.mjs'

// Publication assertions are identity evidence, not receiver runtime coverage.
const reportIdentities = [...[281, 282, 283].map(number => ['FR', number].join('-')), ['SDD', 112].join('-')]

it('qualifies equal basenames without changing unique documents or requirement IDs', () => {
  const nodes = [
    { id: 'doc:SRS', path: 'docs/domains/a/SRS.md' },
    { id: 'doc:SRS', path: 'docs/domains/b/SRS.md' },
    { id: 'doc:UNIQUE', path: 'docs/UNIQUE.md' }, { id: 'req:FR-148' },
  ]
  qualifyDocumentIds(nodes)
  expect(nodes.map(n => n.id)).toEqual(['doc:docs/domains/a/SRS', 'doc:docs/domains/b/SRS', 'doc:UNIQUE', 'req:FR-148'])
  expect(nodes[0].identity_migration).toEqual({ repository: 'Freshair129/zuri.ai', previous_id: 'doc:SRS', source_path: 'docs/domains/a/SRS.md' })
})

it('rejects duplicate node IDs independently of dangling edges', () => {
  expect(() => assertUniqueNodeIds([{ id: 'req:FR-148' }, { id: 'req:FR-148' }])).toThrow('Duplicate graph node ID')
  expect(() => qualifyDocumentIds([{ id: 'spec:ADR-001', path: 'a' }, { id: 'spec:ADR-001', path: 'b' }])).toThrow('Duplicate graph node ID')
  expect(() => qualifyDocumentIds([{ id: 'doc:A', path: 'a' }, { id: 'doc:A', path: 'a' }])).toThrow('Duplicate graph node ID')
})

it('indexes all current issued IDs to their owner registry nodes or distinct anchored identity nodes', () => {
  const frId = ['FR', '001'].join('-')
  const declarations = new Map([
    ['ADR-039', { id: 'ADR-039', family: 'ADR', source: 'docs/decisions/ADR-039-identity.md', status: 'current' }],
    [frId, { id: frId, family: 'FR', source: 'docs/PRD-SDD-v1.0.md', status: 'current' }],
    ['ZV2-CR-009', { id: 'ZV2-CR-009', family: 'ZV2-CR', source: 'docs/changes/ZV2-CR-009.md', status: 'current' }],
    ['RSK-016', { id: 'RSK-016', family: 'RSK', source: 'docs/appendices/E-risk-matrix.md', status: 'current' }],
    ['MI-RQ-033', { id: 'MI-RQ-033', family: 'MI-RQ', source: 'docs/domains/market-intelligence/SRS.md', status: 'current' }],
    ['MI-RQ-211', { id: 'MI-RQ-211', family: 'MI-RQ', source: 'docs/domains/market-intelligence/SRS.md', status: 'current' }],
  ])
  const nodes = [
    { id: 'spec:ADR-039-identity', type: 'adr', path: 'docs/decisions/ADR-039-identity.md' },
    { id: `req:${frId}`, type: 'requirement' },
    { id: 'doc:ZV2-CR-009', type: 'document', path: 'docs/changes/ZV2-CR-009.md' },
  ]
  const indexed = indexDeclaredIdentities(declarations, nodes)
  expect(indexed.size).toBe(6)
  expect(indexed.get('ZAI:ADR-039').id).toBe('spec:ADR-039-identity')
  expect(indexed.get(`ZAI:${frId}`).id).toBe(`req:${frId}`)
  expect(indexed.get('ZAI:ZV2-CR-009').id).toBe('doc:ZV2-CR-009')
  expect(indexed.get('ZAI:MI-RQ-033').id).not.toBe(indexed.get('ZAI:MI-RQ-211').id)
  expect(indexed.get('ZAI:MI-RQ-033').defined_in).toBe(indexed.get('ZAI:MI-RQ-211').defined_in)
  expect(nodes.filter(node => node.type === 'document-identity')).toHaveLength(3)
})

it('builds the qualified index for the complete current registry without changing source IDs', () => {
  const declarations = collectDeclared(path.resolve(process.cwd(), '..', '..'))
  expect(declarations.duplicates).toEqual([])
  expect(declarations.missing).toEqual([])
  const indexed = indexDeclaredIdentities(declarations, [])
  expect(indexed.size).toBe(752)
  for (const id of ['ADR-039', 'ZV2-CR-009', 'RSK-016', 'MI-RQ-033', 'MI-RQ-211', ...reportIdentities]) expect(indexed.has(`ZAI:${id}`)).toBe(true)
})

it('keeps identity-only lifecycle status out of document successor obligations', () => {
  expect(requiresSuccessor({ type: 'document-identity', status: 'superseded' })).toBe(false)
  expect(requiresSuccessor({ type: 'requirement', status: 'superseded' })).toBe(true)
  expect(requiresSuccessor({ type: 'adr', doc_status: 'Superseded' })).toBe(true)
})

it('publishes every issued ZAI identity and resolves historical @spec references without treating them as implementation', () => {
  const graphPath = path.resolve(process.cwd(), '..', '..', 'docs/.doc-graph.json')
  const graph = JSON.parse(readFileSync(graphPath, 'utf8'))
  const declared = graph.nodes.filter(node => node.namespace === 'ZAI' && node.document_identity)
  expect(new Set(declared.map(node => node.document_identity)).size).toBe(752)
  for (const id of ['ADR-039', 'ZV2-CR-009', 'RSK-016', 'MI-RQ-033', 'MI-RQ-211', ...reportIdentities]) {
    expect(declared.filter(node => node.document_identity === id)).toHaveLength(1)
  }
  const change = graph.edges.find(edge => edge.from === 'code:src/modules/project-manager/application/file-asset-service.js'
    && edge.to === 'doc:ZV2-CR-001-MANAGED-LOCAL-FILES-AND-CACHE')
  expect(change).toMatchObject({ type: 'references', source: 'qualified-annotation' })
  expect(graph.edges.some(edge => edge.type === 'implements' && edge.to === 'identity:ZAI:ZV2-CR-001')).toBe(false)
  expect(graph.edges.some(edge => edge.to === 'identity:ZAI:CR-014')).toBe(false)
})

it('allows one indexed registry record beside its existing note without permitting a second note or unindexed copy', () => {
  const note = 'docs/domains/crm/features/FR-091-conversation-inbox.md'
  const canonical = 'docs/features/FEAT-009/requirements/FR-091.md'
  const copy = 'docs/features/other/FR-091-copy.md'
  const indexed = new Set([canonical])
  expect(collectDocumentClaims([note, canonical], indexed).get('FR-091')).toEqual([note])
  expect(collectDocumentClaims([note, canonical, copy], indexed).get('FR-091')).toEqual([note, copy])
  expect(collectDocumentClaims([note, canonical]).get('FR-091')).toEqual([note, canonical])
  const decisions = ['docs/decisions/ADR-017-original.md', 'docs/decisions/ADR-017-duplicate.md']
  expect(collectDocumentClaims(decisions, indexed).get('ADR-017')).toEqual(decisions)
  const changes = ['docs/changes/ZV2-CR-001-original.md', 'docs/changes/ZV2-CR-001-W0-INVENTORY.md', 'docs/changes/ZV2-CR-001-duplicate.md']
  expect(collectDocumentClaims(changes, indexed).get('ZV2-CR-001')).toEqual([changes[0], changes[2]])
})

it('excludes derived views without hiding canonical records, source notes or unrelated READMEs', () => {
  for (const file of ['docs/features/FEAT-009/design.md', 'docs/features/FEAT-009/verification.md', 'docs/operations/README.md']) {
    expect(isGeneratedDocumentView(file)).toBe(true)
  }
  for (const file of ['docs/features/FEAT-009/feature.md', 'docs/features/FEAT-009/requirements/FR-091.md', 'docs/domains/crm/README.md', 'docs/README.md']) {
    expect(isGeneratedDocumentView(file)).toBe(false)
  }
})
