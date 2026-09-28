// @spec docs/GOVERNANCE-LINK-METADATA.md
import { it, expect } from 'vitest'
import { qualifyDocumentIds, assertUniqueNodeIds, collectDocumentClaims, isGeneratedDocumentView } from '../../scripts/doc-identities.mjs'

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
