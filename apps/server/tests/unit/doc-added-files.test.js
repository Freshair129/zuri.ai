// @spec ADR-118, docs/plans/DOCS-ARCHITECTURE-REDESIGN-PROPOSAL-20261113.md
// @tested apps/server/tests/unit/doc-added-files.test.js
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SEVERITY,
  evaluateAddedDocumentGuards,
  evaluateAddedDocuments,
  listAddedDocuments,
  parseNameStatus,
} from '../../scripts/doc-added-files.mjs'
import { compilePolicy, loadPolicy } from '../../../../tools/document-catalog.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')

const policy = compilePolicy({
  schema: 'zuri-document-kinds/1',
  homes: { write: '', legacy: '', frozen: '', generated: '', external: '' },
  kinds: {
    K3: { name: 'decision' }, K9: { name: 'plan' }, K12: { name: 'evidence' }, K16: { name: 'archive' }, EDGE: { name: 'edge' },
  },
  docTypes: ['implementation-plan', 'decision'],
  statuses: ['candidate', 'accepted'],
  rules: [
    { prefix: 'apps/edge/', kind: 'EDGE', home: 'external' },
    { prefix: 'docs/archive/', kind: 'K16', home: 'frozen' },
    { prefix: 'docs/migrations/record-migrations/', kind: 'K16', home: 'frozen', addAllowed: true },
    { prefix: 'docs/superpowers/specs/', kind: 'K9', home: 'legacy', note: 'use docs/plans/' },
    { prefix: 'docs/plans/', kind: 'K9', home: 'write' },
    { prefix: 'docs/decisions/', kind: 'K3', home: 'write' },
  ],
})

const GOOD = '---\nid: ZAI:X\ntitle: X\ndoc_type: implementation-plan\nstatus: candidate\nversion: "1"\nlast_update: "2026-11-14"\nsource_of_truth: false\nprior_art: none-found (query "x")\n---\n# X\n'

function run(added, files = {}, existing = []) {
  return evaluateAddedDocuments({
    added: added.map((a) => (typeof a === 'string' ? { status: 'A', path: a, from: null } : a)),
    policy,
    read: (f) => files[f] ?? null,
    exists: (f) => existing.includes(f),
  })
}

describe('report-only added-document guards', () => {
  it('a violating added file yields only WARNINGs, never CRITICAL', () => {
    const findings = run(['docs/superpowers/specs/new.md', 'docs/plans/BAD.md', 'docs/archive/more.md'], { 'docs/plans/BAD.md': 'no frontmatter' })
    expect(findings.length).toBeGreaterThanOrEqual(4)
    expect(findings.every((f) => f.severity === 'warning')).toBe(true)
    expect(SEVERITY).toBe('warning')
    expect(findings.map((f) => f.check).sort()).toEqual(['doc-metadata', 'doc-placement', 'doc-placement', 'doc-prior-art'])
    for (const f of findings) expect(f.details).toMatch(/never fails govern or CI/)
  })

  it('a compliant added document in a write home is not reported', () => {
    expect(run(['docs/plans/GOOD.md'], { 'docs/plans/GOOD.md': GOOD })).toEqual([])
  })

  it('checks metadata fields and the closed vocabularies', () => {
    const text = '---\ntitle: X\ndoc_type: made-up\nstatus: beta\nprior_art: none-found\n---\n'
    const [finding] = run(['docs/plans/P.md'], { 'docs/plans/P.md': text })
    expect(finding.check).toBe('doc-metadata')
    expect(finding.details).toMatch(/missing id, version, last_update, source_of_truth/)
    expect(finding.details).toMatch(/doc_type "made-up"/)
    expect(finding.details).toMatch(/status "beta"/)
  })

  it('verifies prior_art paths exist but never claims a search happened', () => {
    const listed = GOOD.replace('prior_art: none-found (query "x")', 'prior_art:\n  - docs/plans/OLD.md  # read\n  - docs/plans/GONE.md')
    const [finding] = run(['docs/plans/L.md'], { 'docs/plans/L.md': listed }, ['docs/plans/OLD.md'])
    expect(finding.check).toBe('doc-prior-art')
    expect(finding.details).toMatch(/GONE\.md/)
    expect(finding.details).not.toMatch(/OLD\.md\b.*Missing/)
    expect(finding.details).toMatch(/not that they were read/)
    expect(run(['docs/plans/L2.md'], { 'docs/plans/L2.md': listed.replace('  - docs/plans/GONE.md\n', '') }, ['docs/plans/OLD.md'])).toEqual([])
  })

  it('exempts Edge, sanctioned additions, non-Markdown files and same-home renames', () => {
    expect(run(['apps/edge/docs/new.md', 'docs/migrations/record-migrations/x.approval.md', 'docs/plans/data.json'])).toEqual([])
    expect(run([{ status: 'R', from: 'docs/archive/a.md', path: 'docs/archive/b.md' }])).toEqual([])
    const moved = run([{ status: 'R', from: 'docs/plans/a.md', path: 'docs/superpowers/specs/a.md' }])
    expect(moved.map((f) => f.check)).toEqual(['doc-placement'])
  })

  it('parses git name-status -z output including renames', () => {
    const out = 'A\0docs/a.md\0R100\0docs/old.md\0docs/new.md\0'
    expect(parseNameStatus(out)).toEqual([
      { status: 'A', path: 'docs/a.md', from: null },
      { status: 'R', from: 'docs/old.md', path: 'docs/new.md' },
    ])
  })

  it('lists added files from the diff plus untracked files, deduplicated', () => {
    const calls = []
    const git = (args) => {
      calls.push(args.join(' '))
      if (args[0] === 'merge-base') return { ok: true, stdout: 'abc123\n' }
      if (args[0] === 'diff') return { ok: true, stdout: 'A\0docs/a.md\0' }
      return { ok: true, stdout: 'docs/a.md\0docs/b.md\0' }
    }
    const listed = listAddedDocuments({ git })
    expect(listed.added.map((e) => e.path)).toEqual(['docs/a.md', 'docs/b.md'])
    expect(calls.some((c) => c.startsWith('diff --name-status -z --find-renames --diff-filter=AR abc123'))).toBe(true)
  })

  it('a missing merge base or failed git call is info, never clean and never critical', () => {
    const none = evaluateAddedDocumentGuards({ git: () => ({ ok: false, stdout: '' }), policy, read: () => null, exists: () => false })
    expect(none).toHaveLength(1)
    expect(none[0].severity).toBe('info')
    const failedDiff = evaluateAddedDocumentGuards({
      git: (args) => (args[0] === 'merge-base' ? { ok: true, stdout: 'abc\n' } : { ok: false, stdout: '' }),
      policy, read: () => null, exists: () => false,
    })
    expect(failedDiff[0].severity).toBe('info')
  })

  it('doc-preflight still fails --strict only on CRITICAL and wires the guards without a baseline', () => {
    const source = readFileSync(path.join(REPO_ROOT, 'apps/server/scripts/doc-preflight.mjs'), 'utf8')
    expect(source).toMatch(/--strict'\) && report\.summary\.critical > 0\) process\.exit\(1\)/)
    expect(source).toMatch(/evaluateAddedDocumentGuards/)
    const module = readFileSync(path.join(REPO_ROOT, 'apps/server/scripts/doc-added-files.mjs'), 'utf8')
    expect(module).not.toMatch(/'critical'/)
    expect(module).not.toMatch(/baseline\.json/)
  })

  it('the repository policy marks the superpowers and .brain/plans homes legacy', () => {
    const real = loadPolicy(REPO_ROOT)
    const findings = evaluateAddedDocuments({
      added: ['docs/superpowers/specs/x.md', 'docs/superpowers/plans/y.md', '.brain/plans/z.md'].map((p) => ({ status: 'A', path: p, from: null })),
      policy: real, read: () => null, exists: () => false,
    })
    expect(findings.map((f) => f.check)).toEqual(['doc-placement', 'doc-placement', 'doc-placement'])
  })
})
