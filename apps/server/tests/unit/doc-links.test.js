// @spec docs/GOVERNANCE-LINK-METADATA.md
import { describe, it, expect } from 'vitest'
import { collectDocumentLinks, documentLinksView } from '../../scripts/doc-links.mjs'

const doc = (name, body = '', nodeId = `doc:${name}`) => ({ path: `docs/${name}.md`, body, nodeId })
const fm = (id, relations = '[]', rest = '') => `---\nid: ${id}\nrelations: ${relations}\n${rest}---\n`
const relation = (target, type = 'relates_to') => `\n  - type: ${type}\n    target: '${target}'`
function scan(docs, extra = []) {
  return collectDocumentLinks(docs, [...docs.map(d => ({ id: d.nodeId, path: d.path, title: d.nodeId })), ...extra])
}
const b = doc('B', fm('ZAI:B') + '# Heading One\n')

describe('document metadata identity and links', () => {
  it('resolves typed metadata and deduplicates equivalent prose links', () => {
    const a = doc('A', fm('ZAI:A', relation('ZAI:B')) + '[[ZAI:B|B]] [B](B.md)')
    expect(scan([a, b])).toEqual({ findings: [], edges: [{ from: 'doc:A', to: 'doc:B', type: 'relates', source: 'metadata', status: 'current' }] })
  })
  it('keeps old unrelated frontmatter valid', () => {
    expect(scan([doc('A', '---\nstatus: Custom\n---\n')]).findings).toEqual([])
  })
  it.each([
    fm('ZAI:A', relation('ZAI:MISSING')),
    fm('ZAI:A', relation('UNKNOWN:ADR-001')),
    fm('ZAI:A', relation('ZAI:B', 'wrong')),
    fm('ZAI:A', relation('ZAI:B') + '\n    typo: true'),
    fm('bad id'),
    fm('ZAI:A', '[]\nrelations: []'),
    fm('ZAI:A', '!custom []'),
  ])('rejects invalid metadata or unresolved targets: %s', body => {
    expect(scan([doc('A', body), b]).findings.length).toBeGreaterThan(0)
  })
  it('keeps an exact phase identity separate from its parent requirement', () => {
    const a = doc('A', fm('ZAI:A', relation('ZAI:FR-148-P1')))
    const parent = { id: 'req:FR-148' }
    expect(scan([a], [parent]).findings).toHaveLength(1)
    const phase = doc('phase', fm('ZAI:FR-148-P1'))
    expect(scan([a, phase], [parent]).edges[0].to).toBe('doc:phase')
  })
  it('retains stable IDs after a file move and separates namespaces', () => {
    const moved = { ...b, path: 'docs/elsewhere/B-renamed.md' }
    const edge = doc('edge', fm('EDGE:B'))
    const a = doc('A', fm('ZAI:A', relation('ZAI:B')))
    expect(scan([a, moved, edge]).edges[0].to).toBe('doc:B')
    expect(scan([a, moved, edge]).findings).toEqual([])
  })
  it('rejects duplicate explicit IDs and aliases', () => {
    expect(scan([b, doc('C', fm('ZAI:B'))]).findings.length).toBeGreaterThan(0)
    expect(scan([b, doc('C', fm('ZAI:C', '[]', 'aliases: [ZAI:B]\n'))]).findings.length).toBeGreaterThan(0)
  })
  it('rejects ambiguous basenames instead of choosing a document', () => {
    const one = { ...doc('B'), path: 'docs/one/B.md' }
    const two = { ...doc('B', '', 'doc:other-B'), path: 'docs/two/B.md' }
    expect(scan([doc('A', '[[B]]'), one, two]).findings[0].message).toMatch(/Ambiguous/)
  })
  it('rejects inherited graph ID collisions even for a path target', () => {
    const one = { ...doc('B'), path: 'docs/one/B.md' }
    const two = { ...doc('B'), path: 'docs/two/B.md' }
    expect(scan([doc('A', '[[one/B.md]]'), one, two]).findings[0].message).toMatch(/Ambiguous/)
  })
  it('validates heading fragments and ignores code examples', () => {
    const a = doc('A', '[[B.md#heading-one|Heading]]\n`[[MISSING]]`\n```md\n[[MISSING]]\n```\n')
    expect(scan([a, b]).findings).toEqual([])
    expect(scan([a, b]).edges).toHaveLength(1)
    expect(scan([doc('A', '[[B.md#absent]]'), b]).findings[0].message).toMatch(/Missing heading/)
  })
  it('accepts agreeing legacy controls and rejects conflicting ones', () => {
    const a = doc('A', fm('ZAI:A', relation('ZAI:B')) + '**Relates to:** [B](B.md)')
    expect(scan([a, b]).findings).toEqual([])
    expect(scan([{ ...a, body: fm('ZAI:A') + '**Relates to:** [B](B.md)' }, b]).findings[0].message).toMatch(/conflicts/)
  })
  it('ignores indented, longer-closing and unclosed fences, including fake headings', () => {
    const a = doc('A', '  ```md\n[[MISSING]]\n  ````\n[[ZAI:B]]\n~~~\n[[MISSING]]')
    expect(scan([a, b]).findings).toEqual([])
    expect(scan([a, b]).edges).toHaveLength(1)
    const target = doc('B', '# Real\n```\n# Fake\n```\n# Real\n')
    expect(scan([doc('A', '[[B.md#real-1]]'), target]).findings).toEqual([])
    expect(scan([doc('A', '[[B.md#fake]]'), target]).findings[0].message).toMatch(/Missing heading/)
  })
  it('reverses superseded_by and tolerates legacy historical Markdown', () => {
    const a = doc('A', fm('ZAI:A', relation('ZAI:B', 'superseded_by')) + '[Old](absent.md)')
    expect(scan([a, b]).edges[0]).toMatchObject({ from: 'doc:B', to: 'doc:A', type: 'supersedes' })
    expect(scan([a, b]).findings).toEqual([])
  })
  it('preserves the type of wikilinks in legacy control lines', () => {
    const a = doc('A', '**Relates to:** [[ZAI:B|Label]]')
    expect(scan([a, b]).edges[0]).toMatchObject({ from: 'doc:A', to: 'doc:B', type: 'relates' })
    expect(scan([doc('A', '**Superseded by:** [[ZAI:MISSING]]')]).findings).toHaveLength(1)
  })
  it('generates deterministic portable crosslinks and derived backlinks', () => {
    const a = doc('A', '[[ZAI:B]]')
    const nodes = [a, b].map(d => ({ id: d.nodeId, path: d.path }))
    const { edges } = scan([a, b])
    const view = documentLinksView(nodes, edges)
    expect(view).toContain('references: [doc:B](B.md)')
    expect(view).toContain('Backlinks:\n\n- [doc:A](A.md) (references)')
    expect(documentLinksView([...nodes].reverse(), edges)).toBe(view)
  })
})
