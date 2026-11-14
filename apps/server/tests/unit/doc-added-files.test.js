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
  requiredFields: { K9: ['id', 'title', 'doc_type', 'status', 'version', 'last_update', 'source_of_truth'], K3: ['status'], K12: ['status'] },
  priorArtKinds: ['K3', 'K9', 'K12'],
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

  it('a hostile frontmatter key cannot throw, and an unreadable file is info', () => {
    const hostile = '---\nconstructor:\n  - x\n__proto__:\n  - y\ntitle: T\n---\n'
    const findings = run(['docs/plans/H.md', 'docs/plans/U.md'], { 'docs/plans/H.md': hostile })
    expect(findings.every((f) => ['warning', 'info'].includes(f.severity))).toBe(true)
    expect(findings.some((f) => f.severity === 'info' && f.files[0] === 'docs/plans/U.md')).toBe(true)
    const wrapped = evaluateAddedDocumentGuards({
      git: (args) => (args[0] === 'merge-base' ? { ok: true, stdout: 'abc\n' } : args[0] === 'diff' ? { ok: true, stdout: 'A\0docs/plans/H.md\0' } : { ok: true, stdout: '' }),
      policy, read: () => { throw new Error('boom') }, exists: () => false,
    })
    expect(wrapped).toHaveLength(1)
    expect(wrapped[0].severity).toBe('info')
  })

  it('none-found needs a query, and prior_art paths may contain spaces', () => {
    const noQuery = GOOD.replace('none-found (query "x")', 'none-found')
    expect(run(['docs/plans/N.md'], { 'docs/plans/N.md': noQuery })[0].title).toMatch(/names no query/)
    const spaced = GOOD.replace('prior_art: none-found (query "x")', 'prior_art:\n  - docs/STD-Multi agent workflow S-01.md')
    expect(run(['docs/plans/S.md'], { 'docs/plans/S.md': spaced }, ['docs/STD-Multi agent workflow S-01.md'])).toEqual([])
  })

  it('generated homes are not reported and only approval copies may be added to record-migrations', () => {
    const real = loadPolicy(REPO_ROOT)
    const check = (p) => evaluateAddedDocuments({ added: [{ status: 'A', path: p, from: null }], policy: real, read: () => null, exists: () => false })
    expect(check('docs/PRD-SDD-v1.0.md')).toEqual([])
    expect(check('docs/migrations/document-reintegration/record-migrations/x-20261114.approval.md')).toEqual([])
    expect(check('docs/migrations/document-reintegration/record-migrations/notes.md').map((f) => f.check)).toEqual(['doc-placement'])
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
    expect(source).toMatch(/await import\('\.\/doc-added-files\.mjs'\)/)
    expect(source).not.toMatch(/^import .*doc-added-files/m)
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

describe('rules tuned to the shapes that really exist (ADR-118 amendment 2)', () => {
  const real = loadPolicy(REPO_ROOT)
  const check = (file, text = null, existing = []) => evaluateAddedDocuments({
    added: [{ status: 'A', path: file, from: null }], policy: real, read: () => text, exists: (f) => existing.includes(f),
  }).filter((f) => f.severity === 'warning').map((f) => f.check)
  const fm = (lines) => `---\n${lines.join('\n')}\n---\n# T\n`

  it('K13 RCA: status and version are what is asked; its own doc_type and vocabulary are fine', () => {
    expect(check('.brain/rca/2026-11-14-x.md', fm(['status: resolved', 'version: "1"', 'doc_type: root-cause-analysis']))).toEqual([])
    expect(check('.brain/rca/2026-11-14-x.md', '# no frontmatter\n')).toEqual(['doc-metadata'])
    expect(check('.brain/rca/2026-11-14-x.md', fm(['status: whatever-this-is', 'version: "1"']))).toEqual(['doc-metadata'])
  })

  it('K5 domain note: no prior_art asked (it cites canonical ids), but status and version are', () => {
    expect(check('docs/domains/crm/features/FR-9-x.md', fm(['status: beta', 'version: "1"']))).toEqual([])
    expect(check('docs/domains/crm/features/FR-9-x.md', fm(['title: only a title']))).toEqual(['doc-metadata'])
  })

  it('K4 change request: doc_type not required; relations count as prior art; bundles are exempt', () => {
    const base = ['status: approved', 'version: "1"']
    expect(check('docs/change-requests/identity/x-20261114.md', fm([...base, 'relations:', '  - type: references', '    target: ZAI:FR-1']))).toEqual([])
    expect(check('docs/change-requests/identity/x-20261114.md', fm(base))).toEqual(['doc-prior-art'])
    expect(check('docs/change-requests/marketing/flow/part-2.md', fm(base))).toEqual([])
  })

  it('K6 architecture: numbered chapters of one specification need no prior_art; a new design does', () => {
    const base = ['doc_type: architecture-specification', 'status: candidate', 'version: "1"']
    expect(check('docs/architecture/project-manager-system/30-NEW-CHAPTER.md', fm(base))).toEqual([])
    expect(check('docs/architecture/2026-11-14-new-design.md', fm(base))).toEqual(['doc-prior-art'])
    expect(check('docs/architecture/2026-11-14-new-design.md', fm(base.slice(1)))).toEqual(['doc-metadata', 'doc-prior-art'])
  })

  it('K12 evidence: a document inside a dated assessment folder belongs to it; a top-level report declares prior art', () => {
    const base = ['doc_type: implementation-evidence', 'status: reviewed', 'version: "1"']
    expect(check('reports/compact-2026-11-14/task9.md', fm(base))).toEqual([])
    expect(check('reports/new-report-20261114.md', fm(base))).toEqual(['doc-prior-art'])
  })

  it('tolerated homes are not flagged for placement, legacy and frozen homes still are', () => {
    for (const file of ['.brain/reports/x.md', '.brain/reviews/x.md', 'docs/migrations/lane/x.md', 'apps/server/deploy/NOTES.md', 'services/runtime/NOTES.md', 'docs/governance/NEW-POLICY.md', 'skills/zuri-x/NOTES.md']) {
      expect(check(file, fm(['status: active', 'version: "1"']))).not.toContain('doc-placement')
    }
    for (const file of ['.agent/reports/x.md', 'docs/archive/x.md', 'docs/roadmap/PLAN-NEW.md', 'reference/GoVibe/x.md', 'docs/superpowers/specs/x.md']) {
      expect(check(file)).toContain('doc-placement')
    }
  })

  it('evidence may be added under an RCA, and README files are never new subjects', () => {
    expect(check('.brain/rca/evidence/2026-11-14-x/source/a.md', '# copy\n')).toEqual([])
    expect(check('.brain/rca/other-frozen-name.md', '# x\n').length).toBeGreaterThan(0)
    expect(check('docs/roadmap/README.md')).toEqual([])
    expect(check('docs/plans/README.md')).toEqual([])
    expect(check('.brain/session-memory/README.md')).toEqual([])
  })
})
