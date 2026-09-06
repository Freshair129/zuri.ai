// @spec docs/GOVERNANCE-LINK-METADATA.md
import { it, expect } from 'vitest'
import { qualifyDocumentIds, assertUniqueNodeIds } from '../../scripts/doc-identities.mjs'

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
