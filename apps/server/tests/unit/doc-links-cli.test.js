import { workspacePath } from '../../scripts/workspace-path.mjs'
// @spec docs/GOVERNANCE-LINK-METADATA.md
import { it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, cpSync, symlinkSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

it('CLI reproduces generated files and rejects stale state, backlinks and missing targets', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'zuri-doc-links-'))
  try {
    for (const dir of ['scripts', 'contracts', 'docs']) cpSync(workspacePath(root, dir), path.join(fixture, dir), { recursive: true })
    cpSync(workspacePath(root, 'package.json'), path.join(fixture, 'package.json'))
    cpSync(workspacePath(root, 'AGENTS.md'), path.join(fixture, 'AGENTS.md'))
    mkdirSync(path.join(fixture, 'prisma'))
    cpSync(workspacePath(root, 'prisma/schema.prisma'), path.join(fixture, 'prisma/schema.prisma'))
    const fileModelSource = 'services/file-management/migrations/0001_file_management.sql'
    mkdirSync(path.dirname(path.join(fixture, fileModelSource)), { recursive: true })
    cpSync(workspacePath(root, fileModelSource), path.join(fixture, fileModelSource))
    symlinkSync(workspacePath(root, 'node_modules'), path.join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
    mkdirSync(path.join(fixture, 'src/config'), { recursive: true })
    cpSync(workspacePath(root, 'src/config/domains.js'), path.join(fixture, 'src/config/domains.js'))
    mkdirSync(path.join(fixture, 'apps/edge/tests/unit'), { recursive: true })
    mkdirSync(path.join(fixture, 'apps/edge/docs'), { recursive: true })
    const fixtureId = ['FR', '001'].join('-')
    const qualifiedFixtureId = ['ZAI', fixtureId].join(':')
    writeFileSync(path.join(fixture, 'apps/edge/docs/PRD-SDD-v1.0.md'), `| ${fixtureId} | Edge-only subject |\n`)
    writeFileSync(path.join(fixture, 'apps/edge/tests/unit/qualified.test.ts'), '// @req ' + qualifiedFixtureId + '\n// foreign ZNEXT:FR-002 and edge::FR-003 are not root test evidence\n')
    writeFileSync(path.join(fixture, 'docs/LINK-PHASE.md'), '---\nid: ZAI:FIXTURE-DOC-LINK-PHASE\nrelations: []\n---\n# Phase\n')
    writeFileSync(path.join(fixture, 'docs/LEGACY-WIKI.md'), '# Legacy wiki\n\n**Relates to:** [[ZAI:FIXTURE-DOC-LINK-PHASE]]\n')
    writeFileSync(path.join(fixture, 'docs/encoded target.txt'), 'Fixture target\n')
    writeFileSync(path.join(fixture, 'docs/ENCODED-LINK.md'), '# Encoded links\n[real](encoded%20target.txt)\n[missing](__missing%20target.txt)\n')
    mkdirSync(path.join(fixture, 'docs/migrations'), { recursive: true })
    writeFileSync(path.join(fixture, 'docs/migrations/FIXTURE-MIGRATION.md'), '# Source migration\n')
    for (const name of ['identity-a', 'identity-b']) {
      mkdirSync(path.join(fixture, 'docs', name))
      writeFileSync(path.join(fixture, 'docs', name, 'FIXTURE-SRS.md'), `# ${name}\n`)
    }
    writeFileSync(path.join(fixture, 'docs/identity-a/LINK.md'), '# Link\n\n**Relates to:** [other](../identity-b/FIXTURE-SRS.md)\n\n[own](FIXTURE-SRS.md)\n')
    const run = (script, args = []) => spawnSync(process.execPath, [path.join(fixture, 'scripts', script), ...args], { cwd: fixture, encoding: 'utf8', timeout: 60000 })
    const graph = run('doc-graph.mjs')
    expect(graph.status, graph.stderr).toBe(0)
    const outputs = ['.doc-graph.json', '.domain-state.json', 'FEATURE-MAP.md', 'DOMAIN-MAP.md', 'TRACE.md', 'DOCUMENT-LINKS.md', 'appendices/D-traceability.md']
    const before = outputs.map(name => readFileSync(path.join(fixture, 'docs', name), 'utf8'))
    const repeated = run('doc-graph.mjs')
    expect(repeated.status, repeated.stderr).toBe(0)
    expect(outputs.map(name => readFileSync(path.join(fixture, 'docs', name), 'utf8'))).toEqual(before)
    const graphData = JSON.parse(readFileSync(path.join(fixture, 'docs/.doc-graph.json'), 'utf8'))
    expect(new Set(graphData.nodes.map(n => n.id)).size).toBe(graphData.nodes.length)
    expect(graphData.edges).toContainEqual(expect.objectContaining({ from: 'test:apps/edge/tests/unit/qualified.test.ts', to: 'req:FR-001', type: 'verifies' }))
    expect(graphData.edges.some(e => e.from === 'test:apps/edge/tests/unit/qualified.test.ts' && ['req:FR-002', 'req:FR-003'].includes(e.to))).toBe(false)
    expect(graphData.nodes.some(n => n.id === 'doc:FIXTURE-MIGRATION')).toBe(true)
    expect(graphData.edges).toContainEqual(expect.objectContaining({ from: 'doc:LINK', to: 'doc:docs/identity-b/FIXTURE-SRS', type: 'relates' }))
    expect(graphData.edges).toContainEqual(expect.objectContaining({ from: 'doc:LINK', to: 'doc:docs/identity-a/FIXTURE-SRS', type: 'references' }))
    expect(graphData.edges.filter(e => e.from === 'doc:LEGACY-WIKI')).toEqual([
      { from: 'doc:LEGACY-WIKI', to: 'doc:LINK-PHASE', type: 'relates', source: 'wikilink', status: 'current' },
    ])
    expect(run('doc-graph.mjs', ['--check']).status).toBe(0)
    const statePath = path.join(fixture, 'docs/.domain-state.json')
    const state = readFileSync(statePath, 'utf8')
    const staleState = JSON.parse(state)
    staleState.overall.featureCount += 1
    writeFileSync(statePath, JSON.stringify(staleState, null, 2) + '\n')
    const stateCheck = run('doc-graph.mjs', ['--check'])
    expect(stateCheck.status).toBe(1)
    expect(stateCheck.stderr).toContain('domain state is stale')
    writeFileSync(statePath, state)
    const featuresPath = path.join(fixture, 'docs/FEATURES.md')
    const originalFeatures = readFileSync(featuresPath, 'utf8')
    const bundleRows = originalFeatures.split('\n').filter(line => /^\| FEAT-/.test(line))
    const firstFr = bundleRows[0].match(/FR-\d{3}/)[0]
    const next = bundleRows[1].split('|')
    const violations = [
      [originalFeatures.replace(bundleRows[0], bundleRows[0].replace(firstFr, `${firstFr}, ${firstFr}`)), 'repeats an FR'],
      [originalFeatures.replace(bundleRows[0], bundleRows[0].replace(firstFr, ['FR', '998'].join('-'))), 'bundles unknown FR'],
      [originalFeatures.replace(bundleRows[1], [next[0], next[1], next[2], ` ${firstFr},${next[3]}`, ...next.slice(4)].join('|')), 'belongs to multiple FEATs'],
      [originalFeatures + '\nAn FR is implicitly a feature of one.\n', 'retired capability terminology'],
    ]
    for (const [body, message] of violations) {
      writeFileSync(featuresPath, body)
      const refused = run('doc-graph.mjs')
      expect(refused.status, refused.stderr).toBe(1)
      expect(refused.stderr).toContain(message)
    }
    // Preflight independently reads current registry rows, even with an old graph.
    expect(run('doc-preflight.mjs', ['--strict']).status).toBe(1)
    const terminologyReport = JSON.parse(readFileSync(path.join(fixture, 'docs/.preflight-report.json'), 'utf8'))
    expect(terminologyReport.findings.some(f => f.check === 'capability-classification' && f.severity === 'critical')).toBe(true)
    writeFileSync(featuresPath, originalFeatures)
    const guidePath = path.join(fixture, 'AGENTS.md')
    const guide = readFileSync(guidePath, 'utf8')
    writeFileSync(guidePath, guide + '\nAn FR is an implicit feature.\n')
    expect(run('doc-graph.mjs').stderr).toContain('retired capability terminology')
    writeFileSync(guidePath, guide)
    const tracePath = path.join(fixture, 'docs/TRACE.md')
    const trace = readFileSync(tracePath, 'utf8')
    writeFileSync(tracePath, trace.replace('standalone-fr', 'bundled-fr'))
    expect(run('doc-graph.mjs', ['--check']).stderr).toContain('TRACE.md is stale')
    writeFileSync(tracePath, trace)
    const ambiguousPath = path.join(fixture, 'docs/AMBIGUOUS-FIXTURE.md')
    writeFileSync(ambiguousPath, '# Ambiguous\n\n[[doc:FIXTURE-SRS]]\n')
    const ambiguous = run('doc-graph.mjs')
    expect(ambiguous.status).toBe(1)
    expect(ambiguous.stderr).toContain('Ambiguous link target: doc:FIXTURE-SRS')
    rmSync(ambiguousPath)
    writeFileSync(path.join(fixture, 'docs/DOCUMENT-LINKS.md'), '# stale view\n')
    const stale = run('doc-graph.mjs', ['--check'])
    expect(stale.status).toBe(1)
    expect(stale.stderr).toContain('document links are stale')
    writeFileSync(path.join(fixture, 'docs/BROKEN-LINK-FIXTURE.md'), '---\nid: ZAI:FIXTURE\nrelations:\n  - type: relates_to\n    target: ZAI:DOES-NOT-EXIST\n---\n# Fixture\n')
    const broken = run('doc-graph.mjs')
    expect(broken.status).toBe(1)
    expect(broken.stderr).toContain('Missing link target: ZAI:DOES-NOT-EXIST')
    const preflight = run('doc-preflight.mjs', ['--strict'])
    expect(preflight.status, preflight.stderr).toBe(1)
    const report = JSON.parse(readFileSync(path.join(fixture, 'docs/.preflight-report.json'), 'utf8'))
    expect(report.findings.some(f => f.check === 'cross-reference' && f.title.includes('encoded%20target.txt'))).toBe(false)
    expect(report.findings.some(f => f.check === 'cross-reference' && f.title.includes('__missing%20target.txt'))).toBe(true)
    expect(report.findings.some(f => f.severity === 'critical' && f.check === 'doc-link-metadata' && f.details.includes('ZAI:DOES-NOT-EXIST'))).toBe(true)
  } finally {
    // The target is the exact directory allocated by mkdtemp above; remove the
    // dependency junction first, without traversing the real dependency tree.
    rmSync(path.join(fixture, 'node_modules'), { force: true, recursive: true })
    rmSync(fixture, { recursive: true, force: true })
  }
}, 180000)
