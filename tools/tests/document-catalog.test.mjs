import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CatalogError,
  buildCatalog,
  buildRepositoryCatalog,
  classifyPath,
  compilePolicy,
  loadPolicy,
  parseFrontmatter,
} from '../document-catalog.mjs'
import { findDocuments, parseFindArguments, renderFind } from '../document-find.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const POLICY = compilePolicy({
  schema: 'zuri-document-kinds/1',
  homes: { write: '', legacy: '', frozen: '', generated: '' },
  kinds: {
    K9: { name: 'plan', aliases: ['plan'], sot: 's', writeHome: 'docs/plans/' },
    K12: { name: 'evidence', aliases: ['report'], sot: 's', writeHome: 'reports/' },
    K16: { name: 'archive', aliases: ['archive'], sot: 's', writeHome: 'docs/archive/' },
  },
  rules: [
    { prefix: 'docs/archive/', kind: 'K16', home: 'frozen' },
    { prefix: 'docs/plans/', kind: 'K9', home: 'write' },
    { path: 'docs/roadmap/PLAN-OLD.md', kind: 'K9', home: 'legacy' },
    { pattern: '^reports/[^/]+\\.md$', kind: 'K12', home: 'write' },
  ],
})

const FILES = {
  'docs/plans/OFFICE-RECEIVER-20261031.md': '---\nid: ZAI:OFFICE-RECEIVER-PLAN\ntitle: Office design receiver plan\nstatus: candidate\nsource_of_truth: false\nrelations:\n  - type: supersedes\n    target: ZAI:OLD\n---\n\n# Plan\n\nImplements the office design receiver.\n',
  'reports/office-receiver-20261031.md': '---\ntitle: Office receiver evidence\nattributes:\n  doc_type: assessment\n  domain: project-manager\n---\n# Evidence\nBody.\n',
  'docs/archive/office-old.md': '# Office old\n\nHistoric note.\n',
  'docs/roadmap/PLAN-OLD.md': '# Old plan\n',
  'docs/unlisted/stray.md': '# Stray\n',
  'docs/plans/GEN-VIEW.md': '---\ndoc_type: generated-view\n---\n# Generated view\n',
  'not-a-document.json': '{}',
}

function build(registry = new Map()) {
  return buildCatalog({
    files: Object.keys(FILES),
    read: (f) => FILES[f],
    policy: POLICY,
    registryByPath: registry,
  })
}

test('policy rejects an unknown kind, an unknown home and an ambiguous rule', () => {
  const base = { schema: 'zuri-document-kinds/1', homes: { write: '' }, kinds: { K1: { name: 'x' } } }
  assert.throws(() => compilePolicy({ ...base, rules: [{ prefix: 'a/', kind: 'K2', home: 'write' }] }), CatalogError)
  assert.throws(() => compilePolicy({ ...base, rules: [{ prefix: 'a/', kind: 'K1', home: 'nowhere' }] }), CatalogError)
  assert.throws(() => compilePolicy({ ...base, rules: [{ prefix: 'a/', path: 'a/b', kind: 'K1', home: 'write' }] }), CatalogError)
  assert.throws(() => compilePolicy({ schema: 'other' }), CatalogError)
})

test('classification is first-match and never guesses', () => {
  assert.deepEqual(classifyPath(POLICY, 'docs/plans/X.md'), { kind: 'K9', home: 'write', note: null, addAllowed: false })
  assert.equal(classifyPath(POLICY, 'docs/roadmap/PLAN-OLD.md').home, 'legacy')
  assert.equal(classifyPath(POLICY, 'reports/a.md').kind, 'K12')
  assert.equal(classifyPath(POLICY, 'reports/sub/a.md').kind, 'UNCLASSIFIED')
  assert.equal(classifyPath(POLICY, 'docs/unlisted/stray.md').home, 'unclassified')
})

test('frontmatter reader handles scalars, attributes and relations', () => {
  const parsed = parseFrontmatter(FILES['docs/plans/OFFICE-RECEIVER-20261031.md'])
  assert.equal(parsed.fields.id, 'ZAI:OFFICE-RECEIVER-PLAN')
  assert.equal(parsed.fields.source_of_truth, 'false')
  assert.deepEqual(parsed.relations, [{ type: 'supersedes', target: 'ZAI:OLD' }])
  const nested = parseFrontmatter(FILES['reports/office-receiver-20261031.md'])
  assert.equal(nested.fields.doc_type, 'assessment')
  assert.equal(nested.fields.domain, 'project-manager')
  assert.equal(parseFrontmatter('# no frontmatter'), null)
  assert.equal(parseFrontmatter('---\nunterminated'), null)
})

test('catalog is deterministic, skips non-documents and joins registry ids', () => {
  const registry = new Map([['docs/plans/OFFICE-RECEIVER-20261031.md', 'ZAI:FR-999']])
  const first = build(registry)
  const second = build(registry)
  assert.deepEqual(first, second)
  assert.equal(first.count, 6)
  assert.ok(!first.documents.some((d) => d.path === 'not-a-document.json'))
  assert.deepEqual(first.documents.map((d) => d.path), [...first.documents.map((d) => d.path)].sort())
  const plan = first.documents.find((d) => d.path === 'docs/plans/OFFICE-RECEIVER-20261031.md')
  assert.equal(plan.registryId, 'ZAI:FR-999')
  assert.equal(plan.sourceOfTruth, false)
  assert.deepEqual(plan.supersedes, ['ZAI:OLD'])
  const stray = first.documents.find((d) => d.path === 'docs/unlisted/stray.md')
  assert.equal(stray.kind, 'UNCLASSIFIED')
  assert.equal(stray.hasFrontmatter, false)
  assert.ok(!JSON.stringify(first).match(/generatedAt|timestamp/i))
})

test('find ranks write homes above frozen copies and honours filters', () => {
  const catalog = build()
  const hit = findDocuments(catalog, POLICY, parseFindArguments(['office', 'receiver']))
  assert.deepEqual(hit.results.slice(0, 2).map((r) => r.doc.path).sort(),
    ['docs/plans/OFFICE-RECEIVER-20261031.md', 'reports/office-receiver-20261031.md'])
  assert.equal(hit.results.at(-1).doc.path, 'docs/archive/office-old.md')
  const planOnly = findDocuments(catalog, POLICY, parseFindArguments(['office', '--kind', 'plan']))
  assert.ok(planOnly.results.every((r) => r.doc.kind === 'K9'))
  const byId = findDocuments(catalog, POLICY, parseFindArguments(['--id', 'ZAI:OFFICE-RECEIVER-PLAN']))
  assert.equal(byId.results[0].doc.path, 'docs/plans/OFFICE-RECEIVER-20261031.md')
  const byPath = findDocuments(catalog, POLICY, parseFindArguments(['--path', 'reports/']))
  assert.deepEqual(byPath.results.map((r) => r.doc.path), ['reports/office-receiver-20261031.md'])
  assert.throws(() => findDocuments(catalog, POLICY, parseFindArguments(['x', '--kind', 'nonsense'])), /Unknown kind/)
  assert.throws(() => parseFindArguments(['--bogus']), /Unknown option/)
})

test('a miss says it is not proof of absence', () => {
  const catalog = build()
  const options = parseFindArguments(['zzzzqqqq'])
  const text = renderFind(findDocuments(catalog, POLICY, options), POLICY, options)
  assert.match(text, /not proof of absence/)
})

test('repository policy is valid and classifies every tracked document', () => {
  const policy = loadPolicy(REPO_ROOT)
  const { catalog } = buildRepositoryCatalog(REPO_ROOT)
  const unclassified = catalog.documents.filter((d) => d.kind === 'UNCLASSIFIED').map((d) => d.path)
  assert.deepEqual(unclassified, [], `unclassified tracked documents: ${unclassified.slice(0, 10).join(', ')}`)
  assert.ok(policy.docTypes.size > 0 && policy.statuses.size > 0)
  const raw = JSON.parse(readFileSync(path.join(REPO_ROOT, 'docs/governance/DOCUMENT-KINDS.json'), 'utf8'))
  assert.equal(raw.schema, 'zuri-document-kinds/1')
})

test('docs:find finds the three Office design receiver plan-family files', () => {
  const { policy, catalog } = buildRepositoryCatalog(REPO_ROOT)
  const outcome = findDocuments(catalog, policy, parseFindArguments(['office', 'design', 'receiver']))
  const top = outcome.results.slice(0, 4).map((r) => r.doc.path)
  for (const expected of [
    'docs/plans/OFFICE-DESIGN-RECEIVER-20261031.md',
    'docs/change-requests/project-manager/office-design-receiver-20261031.md',
    'reports/office-design-receiver-20261031.md',
  ]) assert.ok(top.includes(expected), `${expected} missing from ${top.join(', ')}`)
})

test('a generated-view marker beats the path, and id filtering is strict', () => {
  const catalog = build()
  const view = catalog.documents.find((d) => d.path === 'docs/plans/GEN-VIEW.md')
  assert.deepEqual([view.kind, view.home], ['K18', 'generated'])
  const strict = findDocuments(catalog, POLICY, parseFindArguments(['--id', 'ZAI:OFFICE-RECEIVER-PLAN', 'unrelatedword']))
  assert.deepEqual(strict.results.map((r) => r.doc.path), ['docs/plans/OFFICE-RECEIVER-20261031.md'])
  const none = findDocuments(catalog, POLICY, parseFindArguments(['--id', 'ZAI:NOPE']))
  assert.deepEqual(none.results, [])
})

test('short and non-Latin terms are searchable; options are validated', () => {
  const catalog = buildCatalog({
    files: ['docs/plans/AI-PLAN.md', 'docs/plans/THAI.md'],
    read: (f) => (f.endsWith('THAI.md') ? '# แผนงานระบบ\n\nรายละเอียด\n' : '# AI plan\n'),
    policy: POLICY,
  })
  assert.equal(findDocuments(catalog, POLICY, parseFindArguments(['AI'])).results[0].doc.path, 'docs/plans/AI-PLAN.md')
  assert.equal(findDocuments(catalog, POLICY, parseFindArguments(['แผนงาน'])).results[0].doc.path, 'docs/plans/THAI.md')
  assert.throws(() => parseFindArguments(['--limit', '2junk']), /positive integer/)
  assert.throws(() => parseFindArguments(['--limit', '--json']), /needs a value/)
  assert.equal(parseFindArguments(['--limit', '3']).limit, 3)
})
