// @spec docs/GOVERNANCE-LINK-METADATA.md
import { it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, cpSync, symlinkSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

it('CLI rejects missing targets and a stale backlink view without indexing generated backlinks', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'zuri-doc-links-'))
  try {
    for (const dir of ['scripts', 'contracts', 'docs']) cpSync(path.join(root, dir), path.join(fixture, dir), { recursive: true })
    cpSync(path.join(root, 'package.json'), path.join(fixture, 'package.json'))
    cpSync(path.join(root, 'AGENTS.md'), path.join(fixture, 'AGENTS.md'))
    mkdirSync(path.join(fixture, 'prisma'))
    cpSync(path.join(root, 'prisma/schema.prisma'), path.join(fixture, 'prisma/schema.prisma'))
    symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
    mkdirSync(path.join(fixture, 'src/config'), { recursive: true })
    cpSync(path.join(root, 'src/config/domains.js'), path.join(fixture, 'src/config/domains.js'))
    writeFileSync(path.join(fixture, 'docs/LINK-PHASE.md'), '---\nid: ZAI:FIXTURE-DOC-LINK-PHASE\nrelations: []\n---\n# Phase\n')
    writeFileSync(path.join(fixture, 'docs/LEGACY-WIKI.md'), '# Legacy wiki\n\n**Relates to:** [[ZAI:FIXTURE-DOC-LINK-PHASE]]\n')
    const run = (script, args = []) => spawnSync(process.execPath, [path.join(fixture, 'scripts', script), ...args], { cwd: fixture, encoding: 'utf8', timeout: 60000 })
    const graph = run('doc-graph.mjs')
    expect(graph.status, graph.stderr).toBe(0)
    const graphData = JSON.parse(readFileSync(path.join(fixture, 'docs/.doc-graph.json'), 'utf8'))
    expect(graphData.edges.filter(e => e.from === 'doc:LEGACY-WIKI')).toEqual([
      { from: 'doc:LEGACY-WIKI', to: 'doc:LINK-PHASE', type: 'relates', source: 'wikilink', status: 'current' },
    ])
    expect(run('doc-graph.mjs', ['--check']).status).toBe(0)
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
