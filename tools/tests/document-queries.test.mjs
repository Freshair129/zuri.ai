import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import {
  loadDocumentQueryContext,
  parseQueryArguments,
  queryImpact,
  queryReadiness,
  queryTestsFor,
  resolveQueryTarget,
} from '../document-query.mjs'

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(THIS_DIR, '../..')
const SOURCE_REVISION = 'a34ceaf79c112e02b1bcfdbf0a84122d835b002e'

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

function writeCanonicalRecord(root, { id, family, statement, members = [], featureId }) {
  const requirementCells = family === 'FEAT' ? [3] : []
  const row = family === 'FEAT'
    ? `| ${id} | ${statement} | ${members.join(', ')} | active |\n`
    : `| ${id} | ${statement} | active |\n`
  const sourcePath = family === 'FEAT' ? 'docs/FEATURES.md' : 'docs/PRD-SDD-v1.0.md'
  const sourceRowSha256 = digest(Buffer.from(row, 'utf8'))
  const recordPath = family === 'FEAT' ? `docs/features/${id}/feature.md` : `docs/requirements/${id}.md`
  const markdown = [
    '---',
    `id: ${id}`,
    'namespace: ZAI',
    `family: ${family}`,
    'version: 1',
    'status: source-preserved',
    `source_revision: ${SOURCE_REVISION}`,
    `source_path: ${sourcePath}`,
    'source_row_eol: LF',
    `source_row_sha256: ${sourceRowSha256}`,
    'statement_cell: 2',
    `requirement_cells: ${JSON.stringify(requirementCells)}`,
    ...(featureId ? [`feature_id: ${featureId}`] : []),
    '---',
    '',
    `# ZAI:${id}`,
    '',
    '<!-- canonical-row:start -->',
    '```text',
    row.trimEnd(),
    '```',
    '<!-- canonical-row:end -->',
    '',
  ].join('\n')
  const absoluteRecordPath = path.join(root, ...recordPath.split('/'))
  mkdirSync(path.dirname(absoluteRecordPath), { recursive: true })
  writeFileSync(absoluteRecordPath, markdown)
  return {
    id,
    namespace: 'ZAI',
    family,
    recordVersion: 1,
    status: 'source-preserved',
    path: recordPath,
    sourcePath,
    sourceRowSha256,
    recordSha256: digest(Buffer.from(markdown, 'utf8')),
    statementCell: 2,
    requirementCells,
    ...(featureId ? { featureId } : {}),
  }
}

function writeFile(root, file, content = 'fixture') {
  const absolute = path.join(root, ...file.split('/'))
  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, content)
}

function makeFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'zai-document-query-'))
  const records = [
    writeCanonicalRecord(root, { id: 'FEAT-001', family: 'FEAT', statement: 'Feature membership is explicit', members: ['FR-001', 'FR-002'] }),
    writeCanonicalRecord(root, { id: 'FR-001', family: 'FR', statement: 'Server and Edge proof is bound', featureId: 'FEAT-001' }),
    writeCanonicalRecord(root, { id: 'FR-002', family: 'FR', statement: 'Runtime proof is bound', featureId: 'FEAT-001' }),
    writeCanonicalRecord(root, { id: 'FR-003', family: 'FR', statement: 'Adjacent requirement is not a member' }),
  ]
  const indexPath = path.join(root, 'registry', 'document-registry', 'index.json')
  mkdirSync(path.dirname(indexPath), { recursive: true })
  writeFileSync(indexPath, `${JSON.stringify({ version: 1, sourceRevision: SOURCE_REVISION, records }, null, 2)}\n`)

  const serverTest = 'apps/server/tests/unit/fr-001.test.js'
  const serverE2eTest = 'apps/server/tests/e2e/fr-001.spec.js'
  const edgeTest = 'apps/edge/tests/unit/fr-001.test.ts'
  const runtimeTest = 'services/conversation-runtime/test/fr-002.test.js'
  const unlistedTest = 'apps/server/tests/unit/fr-003.test.js'
  const serverCode = 'apps/server/src/modules/example.js'
  const runtimeCode = 'services/conversation-runtime/src/example.js'
  for (const file of [serverTest, serverE2eTest, edgeTest, runtimeTest, unlistedTest, serverCode, runtimeCode]) writeFile(root, file)

  const nodes = [
    { id: 'feat:FEAT-001', type: 'feature', namespace: 'ZAI', status: 'current', canonical_path: 'docs/features/FEAT-001/feature.md' },
    { id: 'req:FR-001', type: 'requirement', namespace: 'ZAI', status: 'current', canonical_path: 'docs/requirements/FR-001.md' },
    { id: 'req:FR-002', type: 'requirement', namespace: 'ZAI', status: 'current', canonical_path: 'docs/requirements/FR-002.md' },
    { id: 'req:FR-003', type: 'requirement', namespace: 'ZAI', status: 'current', canonical_path: 'docs/requirements/FR-003.md' },
    { id: `test:${serverTest}`, type: 'test', path: serverTest, status: 'current' },
    { id: `test:${serverE2eTest}`, type: 'test', path: serverE2eTest, status: 'current' },
    { id: `test:${edgeTest}`, type: 'test', path: edgeTest, status: 'current' },
    { id: `test:${runtimeTest}`, type: 'test', path: runtimeTest, status: 'current' },
    { id: `test:${unlistedTest}`, type: 'test', path: unlistedTest, status: 'current' },
    { id: `code:${serverCode}`, type: 'code_file', path: serverCode, status: 'current' },
    { id: `code:${runtimeCode}`, type: 'code_file', path: runtimeCode, status: 'current' },
    { id: 'doc:FR-001', type: 'document', path: 'docs/requirements/FR-001.md', status: 'current' },
    { id: 'spec:ADR-999', type: 'adr', path: 'docs/decisions/ADR-999.md', status: 'current' },
  ]
  const edges = [
    { from: 'feat:FEAT-001', to: 'req:FR-001', type: 'bundles', status: 'current' },
    { from: 'feat:FEAT-001', to: 'req:FR-002', type: 'bundles', status: 'current' },
    { from: 'req:FR-002', to: 'req:FR-001', type: 'depends_on', status: 'current' },
    { from: `code:${serverCode}`, to: 'req:FR-001', type: 'implements', status: 'current', source: 'annotation' },
    { from: `code:${runtimeCode}`, to: 'req:FR-002', type: 'implements', status: 'current', source: 'annotation' },
    { from: `test:${serverTest}`, to: 'req:FR-001', type: 'verifies', status: 'current', source: 'test-reference' },
    { from: `test:${serverE2eTest}`, to: 'req:FR-001', type: 'verifies', status: 'current', source: 'test-reference' },
    { from: `test:${edgeTest}`, to: 'req:FR-001', type: 'verifies', status: 'current', source: 'test-reference' },
    { from: `test:${runtimeTest}`, to: 'req:FR-002', type: 'verifies', status: 'current', source: 'test-reference' },
    { from: `test:${unlistedTest}`, to: 'req:FR-003', type: 'verifies', status: 'current', source: 'test-reference' },
    { from: 'doc:FR-001', to: 'req:FR-001', type: 'relates', status: 'current' },
    { from: 'spec:ADR-999', to: 'req:FR-001', type: 'references', status: 'current' },
  ]
  const graphPath = path.join(root, 'docs', '.doc-graph.json')
  mkdirSync(path.dirname(graphPath), { recursive: true })
  writeFileSync(graphPath, `${JSON.stringify({ nodes, edges })}\n`)
  return { root, graphPath, paths: { serverTest, edgeTest, runtimeTest } }
}

test('FEAT test lookup expands only its explicit FR row and groups existing tests by app', () => {
  const fixture = makeFixture()
  try {
    const context = loadDocumentQueryContext(fixture)
    const report = queryTestsFor('ZAI:FEAT-001', context)
    assert.deepEqual(report.requirements, ['ZAI:FR-001', 'ZAI:FR-002'])
    assert.equal(report.requirements.includes('ZAI:FR-003'), false)
    assert.deepEqual(new Set(report.files), new Set([...Object.values(fixture.paths), 'apps/server/tests/e2e/fr-001.spec.js']))
    assert.deepEqual(report.commands.map(command => `${command.app}:${command.runner}`), [
      'apps/edge:node-test-tsx',
      'apps/server:playwright',
      'apps/server:vitest',
      'services/conversation-runtime:node-test',
    ])
    assert.deepEqual(report.commands.find(command => command.app === 'apps/edge').argv,
      ['node', '--import', 'tsx', '--test', 'tests/unit/fr-001.test.ts'])
    assert.match(report.commands.find(command => command.app === 'apps/edge').command, /'tests\/unit\/fr-001\.test\.ts'/)
    assert.deepEqual(report.commands.find(command => command.runner === 'playwright').argv,
      ['npm', '--prefix', 'apps/server', 'run', 'test:e2e', '--', 'tests/e2e/fr-001.spec.js'])
    assert.match(report.note, /not evidence that tests were executed or passed/)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('foreign namespaces are separately classified and never queried as current evidence', () => {
  const fixture = makeFixture()
  try {
    const context = loadDocumentQueryContext(fixture)
    const imported = queryTestsFor('ZNEXT:FR-001', context)
    const edge = queryImpact('edge::FR-001', context)
    assert.equal(imported.target.namespaceDisposition, 'provenance-only')
    assert.equal(imported.target.declarationVerified, false)
    assert.equal(imported.target.currentEvidence, false)
    assert.deepEqual(imported.bindings, [])
    assert.equal(edge.target.namespaceDisposition, 'edge-separate')
    assert.deepEqual(edge.reviewSet, [])
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('a graph node with a foreign namespace cannot satisfy a ZAI declaration', () => {
  const fixture = makeFixture()
  try {
    const context = loadDocumentQueryContext(fixture)
    context.nodes.set('req:FR-001', { ...context.nodes.get('req:FR-001'), namespace: 'ZNEXT' })
    assert.throws(() => queryTestsFor('ZAI:FR-001', context), { code: 'GRAPH_DECLARATION_MISMATCH' })
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('impact keeps typed evidence, relations, relates, and weak references separate', () => {
  const fixture = makeFixture()
  try {
    const context = loadDocumentQueryContext(fixture)
    const report = queryImpact('FR-001', context)
    assert.ok(report.evidence.some(edge => edge.type === 'implements'))
    assert.ok(report.evidence.some(edge => edge.type === 'verifies'))
    assert.equal(report.dependencies.length, 1)
    assert.equal(report.navigationOnly.length, 1)
    assert.equal(report.weakReferences.length, 1)
    assert.equal(report.reviewSet.some(node => node.id === 'doc:FR-001'), false)
    assert.equal(report.reviewSet.some(node => node.id === 'spec:ADR-999'), false)
    assert.ok(report.reviewSet.some(node => node.type === 'code_file'))
    assert.ok(report.reviewSet.some(node => node.type === 'test'))

    const feature = queryImpact('FEAT-001', context)
    assert.ok(feature.evidence.some(edge => edge.via === 'ZAI:FR-001' && edge.type === 'implements'))
    assert.ok(feature.evidence.some(edge => edge.via === 'ZAI:FR-002' && edge.type === 'verifies'))
    assert.equal(feature.evidence.some(edge => edge.via === 'ZAI:FR-003'), false)
    assert.match(report.note, /recognized source/)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('unreviewed provenance edges are visible as unverified and never become bindings', () => {
  const fixture = makeFixture()
  try {
    const importedTest = 'apps/server/tests/unit/imported.test.js'
    const crosswalkTest = 'apps/server/tests/unit/crosswalk.test.js'
    writeFile(fixture.root, importedTest)
    writeFile(fixture.root, crosswalkTest)
    const graph = JSON.parse(readFileSync(fixture.graphPath, 'utf8'))
    graph.nodes.push({ id: `test:${importedTest}`, type: 'test', path: importedTest, namespace: 'ZNEXT', status: 'current' })
    graph.nodes.push({ id: `test:${crosswalkTest}`, type: 'test', path: crosswalkTest, namespace: 'ZAI', status: 'current' })
    graph.edges.push({ from: `test:${importedTest}`, to: 'req:FR-001', type: 'verifies', status: 'current', source: 'test-reference' })
    graph.edges.push({ from: `test:${crosswalkTest}`, to: 'req:FR-001', type: 'verifies', status: 'current', source: 'crosswalk' })
    writeFileSync(fixture.graphPath, JSON.stringify(graph))

    const context = loadDocumentQueryContext(fixture)
    const tests = queryTestsFor('FR-001', context)
    const impact = queryImpact('FR-001', context)
    assert.equal(tests.bindings.some(binding => binding.testNode === `test:${importedTest}`), false)
    assert.equal(tests.bindings.some(binding => binding.testNode === `test:${crosswalkTest}`), false)
    assert.ok(impact.unverifiedEvidence.some(edge => edge.from.id === `test:${importedTest}` && edge.source === 'test-reference'))
    assert.ok(impact.unverifiedEvidence.some(edge => edge.from.id === `test:${crosswalkTest}` && edge.source === 'crosswalk'))
    assert.equal(impact.evidence.some(edge => edge.source === 'crosswalk'), false)
    assert.equal(impact.reviewSet.some(node => node.id === `test:${importedTest}`), false)
    assert.equal(impact.reviewSet.some(node => node.id === `test:${crosswalkTest}`), false)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('readiness measures only declaration, graph, code, and test bindings', () => {
  const fixture = makeFixture()
  try {
    const report = queryReadiness('ZAI:FEAT-001', loadDocumentQueryContext(fixture))
    assert.deepEqual(report.completeness, {
      declaration: true,
      graphNode: true,
      codeBindings: true,
      testBindings: true,
    })
    assert.equal(report.requirements.length, 2)
    assert.equal(Object.hasOwn(report, 'delivery'), false)
    assert.equal(Object.hasOwn(report, 'ready'), false)
    assert.match(report.note, /does not state approval, delivery, test execution, runtime activation, or production readiness/)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('current trace adapter implementation edges remain visible in query consumers', () => {
  const fixture = makeFixture()
  try {
    const graph = JSON.parse(readFileSync(fixture.graphPath, 'utf8'))
    for (const edge of graph.edges) if (edge.type === 'implements') edge.source = 'trace-annotation'
    writeFileSync(fixture.graphPath, JSON.stringify(graph))
    const context = loadDocumentQueryContext(fixture)
    assert.equal(queryReadiness('ZAI:FEAT-001', context).completeness.codeBindings, true)
    assert.ok(queryImpact('ZAI:FEAT-001', context).evidence.some(edge => edge.type === 'implements' && edge.source === 'trace-annotation'))
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('unknown and non-exact ZAI IDs fail closed', () => {
  const fixture = makeFixture()
  try {
    const context = loadDocumentQueryContext(fixture)
    assert.throws(() => resolveQueryTarget('ZAI:FR-001-001', context), { code: 'IDENTITY_NOT_FOUND' })
    assert.throws(() => resolveQueryTarget('FR-999', context), { code: 'IDENTITY_NOT_FOUND' })
    context.records.set('edge::FR-001', { ...context.records.get('ZAI:FR-001'), namespace: 'edge' })
    assert.throws(() => resolveQueryTarget('FR-001', context), { code: 'AMBIGUOUS_IDENTITY' })
    assert.equal(resolveQueryTarget('ZAI:FR-001', context).namespace, 'ZAI')
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('missing test paths remain visible but are not offered as runnable files', () => {
  const fixture = makeFixture()
  try {
    const graph = JSON.parse(readFileSync(fixture.graphPath, 'utf8'))
    const missing = 'apps/server/tests/unit/missing.test.js'
    graph.nodes.push({ id: `test:${missing}`, type: 'test', path: missing, status: 'current' })
    graph.edges.push({ from: `test:${missing}`, to: 'req:FR-001', type: 'verifies', status: 'current', source: 'test-reference' })
    writeFileSync(fixture.graphPath, JSON.stringify(graph))
    const report = queryTestsFor('FR-001', loadDocumentQueryContext(fixture))
    assert.ok(report.missingFiles.includes(missing))
    assert.equal(report.files.includes(missing), false)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('server-relative graph ID fallback resolves inside apps/server and shell specials are quoted', () => {
  const fixture = makeFixture()
  try {
    const graph = JSON.parse(readFileSync(fixture.graphPath, 'utf8'))
    const relativeIdPath = 'tests/unit/[scope]/dollar$cash.test.js'
    writeFile(fixture.root, `apps/server/${relativeIdPath}`)
    graph.nodes.push({ id: `test:${relativeIdPath}`, type: 'test', status: 'current' })
    graph.edges.push({ from: `test:${relativeIdPath}`, to: 'req:FR-001', type: 'verifies', status: 'current', source: 'test-reference' })
    writeFileSync(fixture.graphPath, JSON.stringify(graph))
    const report = queryTestsFor('FR-001', loadDocumentQueryContext(fixture))
    const binding = report.bindings.find(item => item.testNode === `test:${relativeIdPath}`)
    const server = report.commands.find(command => command.app === 'apps/server' && command.runner === 'vitest')
    assert.equal(binding.path, `apps/server/${relativeIdPath}`)
    assert.equal(binding.exists, true)
    assert.ok(server.argv.includes(relativeIdPath))
    assert.ok(server.command.includes(`'${relativeIdPath}'`))
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('CLI honors --root and --graph from an unrelated working directory', () => {
  const fixture = makeFixture()
  try {
    const cli = path.join(REPO_ROOT, 'tools', 'tests-for.mjs')
    const result = spawnSync(process.execPath, [cli, 'ZAI:FR-001', '--root', fixture.root, '--graph', fixture.graphPath, '--json'], {
      cwd: tmpdir(),
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(result.stdout).reports[0]
    assert.equal(report.target.id, 'FR-001')
    assert.equal(report.files.length, 3)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('query flags reject unknown options and malformed invocation', () => {
  assert.throws(() => parseQueryArguments(['FR-001', '--mystery'], 'usage'), { code: 'USAGE' })
  assert.throws(() => parseQueryArguments(['--root', 'x'], 'usage'), { code: 'USAGE' })
})

test('queries refuse a canonical index without the record digest', () => {
  const fixture = makeFixture()
  try {
    const file = path.join(fixture.root, 'registry/document-registry/index.json')
    const index = JSON.parse(readFileSync(file, 'utf8'))
    delete index.records[0].recordSha256
    writeFileSync(file, JSON.stringify(index))
    assert.throws(() => loadDocumentQueryContext(fixture), /hash does not match/)
  } finally {
    assert.ok(path.resolve(fixture.root).startsWith(path.resolve(tmpdir()) + path.sep))
    assert.ok(path.basename(fixture.root).startsWith('zai-document-query-'))
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('impact downgrades dangling recognized edges to unverified evidence', () => {
  const fixture = makeFixture()
  try {
    const context = loadDocumentQueryContext(fixture)
    context.graph.edges.push({ from: 'ghost:missing', to: 'req:FR-001', type: 'implements', status: 'current', source: 'annotation' })
    context.graph.edges.push({ from: 'ghost:dependency', to: 'req:FR-001', type: 'depends_on', status: 'current' })
    const report = queryImpact('ZAI:FR-001', context)
    assert.ok(!report.evidence.some(edge => edge.from.id === 'ghost:missing'))
    assert.ok(report.unverifiedEvidence.some(edge => edge.from.id === 'ghost:missing'))
    assert.ok(report.dependencies.some(edge => edge.from.id === 'ghost:dependency' && edge.from.type === 'unknown'))
  } finally {
    assert.ok(path.resolve(fixture.root).startsWith(path.resolve(tmpdir()) + path.sep))
    assert.ok(path.basename(fixture.root).startsWith('zai-document-query-'))
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('generated runtime invocation executes selected tests from its declared cwd', () => {
  const fixture = makeFixture()
  try {
    writeFile(fixture.root, 'services/conversation-runtime/test/fr-002.test.js', "const assert = require('node:assert/strict'); assert.equal(require('node:path').basename(process.cwd()), 'conversation-runtime'); require('node:fs').writeFileSync('selected-test-ran.txt', 'passed');")
    const command = queryTestsFor('FR-002', loadDocumentQueryContext(fixture)).commands.find(item => item.app === 'services/conversation-runtime')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, command.argv.slice(1), { cwd: command.cwd, encoding: 'utf8', env })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(path.join(command.cwd, 'selected-test-ran.txt'), 'utf8'), 'passed')
  } finally {
    assert.ok(path.resolve(fixture.root).startsWith(path.resolve(tmpdir()) + path.sep))
    assert.ok(path.basename(fixture.root).startsWith('zai-document-query-'))
    rmSync(fixture.root, { recursive: true, force: true })
  }
})
