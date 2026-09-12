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
    symlinkSync(workspacePath(root, 'node_modules'), path.join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
    mkdirSync(path.join(fixture, 'src/config'), { recursive: true })
    cpSync(workspacePath(root, 'src/config/domains.js'), path.join(fixture, 'src/config/domains.js'))
    writeFileSync(path.join(fixture, 'docs/LINK-PHASE.md'), '---\nid: ZAI:FIXTURE-DOC-LINK-PHASE\nrelations: []\n---\n# Phase\n')
    writeFileSync(path.join(fixture, 'docs/LEGACY-WIKI.md'), '# Legacy wiki\n\n**Relates to:** [[ZAI:FIXTURE-DOC-LINK-PHASE]]\n')
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
    expect(report.findings.some(f => f.severity === 'critical' && f.check === 'doc-link-metadata' && f.details.includes('ZAI:DOES-NOT-EXIST'))).toBe(true)
  } finally {
    // The target is the exact directory allocated by mkdtemp above; remove the
    // dependency junction first, without traversing the real dependency tree.
    rmSync(path.join(fixture, 'node_modules'), { force: true, recursive: true })
    rmSync(fixture, { recursive: true, force: true })
  }
}, 180000)
