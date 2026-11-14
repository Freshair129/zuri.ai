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
    expect(module).toMatch(/export const SEVERITY = 'warning'/)
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
    for (const file of ['apps/server/deploy/NOTES.md', 'services/runtime/NOTES.md', 'skills/zuri-x/NOTES.md']) {
      expect(check(file, fm(['status: active', 'version: "1"']))).not.toContain('doc-placement')
    }
    // ADR-118 amendment 3: governance is a K14 write home and migration procedures are K11; reports and reviews moved to reports/.
    for (const file of ['docs/governance/NEW-POLICY.md', 'docs/migrations/lane/x.md']) {
      expect(check(file, fm(['status: active', 'version: "1"']))).not.toContain('doc-placement')
    }
    for (const file of ['.brain/reports/x.md', '.brain/reviews/x.md']) expect(check(file)).toContain('doc-placement')
    for (const file of ['docs/archive/x.md', 'reference/GoVibe/x.md', 'docs/roadmap/NEW-NOTES.md']) {
      expect(check(file)).toContain('doc-placement')
    }
  })

  it('evidence may be added under an RCA, and README files are never new subjects', () => {
    expect(check('.brain/rca/evidence/2026-11-14-x/source/a.md', '# copy\n')).toEqual([])
    expect(check('.brain/rca/other-frozen-name.md', '# x\n').length).toBeGreaterThan(0)
    expect(check('docs/plans/README.md')).toEqual([])
    expect(check('docs/plans/index.md')).toEqual([])
    expect(check('docs/roadmap/README.md')).toEqual(['doc-placement'])
  })

  it('every kind that is asked for metadata has a pass and a fail from the real policy', () => {
    const samples = {
      K1: 'docs/PRODUCT.md', K3: 'docs/decisions/ADR-999-X.md', K4: 'docs/change-requests/identity/x-20261114.md',
      K5: 'docs/domains/crm/CHARTER.md', K6: 'docs/architecture/x.md', K7: 'docs/services/x/SERVICE.md',
      K9: 'docs/plans/X-20261114.md', K10: 'docs/roadmap/ROADMAP.md', K11: 'docs/runbooks/X.md',
      K12: 'reports/x-20261114.md', K13: '.brain/rca/2026-11-14-x.md',
    }
    for (const [kind, required] of real.requiredFields) {
      const file = samples[kind]
      expect(file, `a sample path for ${kind}`).toBeTruthy()
      const lines = required.map((key) => {
        if (key === 'status') return 'status: active'
        if (key === 'doc_type') return `doc_type: ${[...(real.vocabulary.get(kind)?.docTypes || ['implementation-plan'])][0]}`
        if (key === 'version') return 'version: "1"'
        return `${key}: x`
      })
      const withPriorArt = [...lines, 'relations:', '  - type: references', '    target: ZAI:FR-1']
      expect(check(file, fm(withPriorArt)), `${kind} compliant`).toEqual([])
      expect(check(file, '# no frontmatter\n'), `${kind} without frontmatter`).toContain('doc-metadata')
    }
  })

  it('empty required values count as missing; README is exempt from metadata only', () => {
    const empty = fm(['id: ""', 'doc_type: implementation-plan', 'status: candidate', 'version: ""', 'prior_art: none-found (query "x")'])
    expect(check('docs/plans/E-20261114.md', empty)).toEqual(['doc-metadata'])
    expect(check('docs/plans/README.md', '# index\n')).toEqual([])
  })

  it('exemptions are narrow: only NN- chapters, dated report folders, and real bundles', () => {
    const base = ['doc_type: architecture-specification', 'status: candidate', 'version: "1"']
    expect(check('docs/architecture/project-manager-system/NEW-DESIGN.md', fm(base))).toEqual(['doc-prior-art'])
    expect(check('docs/architecture/blueprint/NEW.md', fm(base))).toEqual(['doc-prior-art'])
    const ev = ['doc_type: assessment', 'status: reviewed', 'version: "1"']
    expect(check('reports/random-folder/new.md', fm(ev))).toEqual(['doc-prior-art'])
    expect(check('reports/study-2026-11-14/new.md', fm(ev))).toEqual([])
  })
})

describe('CRITICAL only for added or renamed-into files in the named legacy homes (ADR-118 amendment 3)', () => {
  const real = loadPolicy(REPO_ROOT)
  const run = (entries, read = () => '# x\n') => evaluateAddedDocuments({
    added: entries.map((e) => (typeof e === 'string' ? { status: 'A', path: e, from: null } : e)), policy: real, read, exists: () => true,
  })
  const placement = (entries) => run(entries).filter((f) => f.check === 'doc-placement')
  const CRITICAL_HOMES = ['docs/superpowers/specs/x.md', 'docs/superpowers/plans/x.md', '.brain/plans/x.md', 'docs/roadmap/PLAN-NEW-20261114.md', '.agent/reports/x.md', 'agent/phases/x.md', '.rwang-tasks/x.md']

  it('an addition to each named legacy home is CRITICAL, and the shared SEVERITY is still warning', () => {
    for (const file of CRITICAL_HOMES) {
      const [finding] = placement([file])
      expect(finding.severity, file).toBe('critical')
      expect(finding.details).toMatch(/delegated product-owner decision/)
    }
    expect(SEVERITY).toBe('warning')
  })

  it('every other legacy, frozen or unclassified home stays WARNING', () => {
    for (const file of ['docs/archive/x.md', 'reference/GoVibe/x.md', 'docs/roadmap/NEW-NOTES.md', '.brain/reports/x.md', '.brain/reviews/x.md', '.brain/waves/x.md', 'docs/DB-NEW.md', 'docs/prompts/x.md']) {
      const [finding] = placement([file])
      expect(finding.severity, file).toBe('warning')
    }
  })

  it('a same-directory rename is the same document; a cross-home rename is a move into another home', () => {
    expect(placement([{ status: 'R', from: '.agent/reports/a.md', path: '.agent/reports/b.md' }])).toEqual([])
    expect(placement([{ status: 'R', from: 'docs/superpowers/specs/a.md', path: 'docs/superpowers/specs/b.md' }])).toEqual([])
    for (const [from, to] of [
      ['.agent/reports/a.md', 'agent/phases/a.md'],
      ['docs/superpowers/specs/a.md', 'docs/superpowers/plans/a.md'],
      ['docs/plans/a.md', 'docs/superpowers/specs/a.md'],
      ['reports/a.md', '.rwang-tasks/a.md'],
    ]) {
      const [finding] = placement([{ status: 'R', from, path: to }])
      expect(finding?.severity, `${from} -> ${to}`).toBe('critical')
    }
    expect(placement([{ status: 'R', from: '.agent/reports/a.md', path: 'docs/plans/a.md' }])).toEqual([])
  })

  it('K2 records, generated views, Edge, frozen evidence and sealed approval copies are not flagged', () => {
    for (const file of [
      'docs/features/FEAT-999/feature.md', 'docs/requirements/FR-999.md', 'docs/PRD-SDD-v1.0.md', 'docs/product/README.md',
      'apps/edge/docs/new.md', '.brain/rca/evidence/2026-11-14-x/source/a.md',
      'docs/migrations/document-reintegration/record-migrations/x-20261114.approval.md',
    ]) expect(placement([file]), file).toEqual([])
  })

  it('only the enumerated homes can ever produce a CRITICAL finding', () => {
    const sample = [
      ...CRITICAL_HOMES, 'docs/plans/x.md', 'docs/decisions/ADR-1-x.md', 'docs/archive/x.md', 'reports/x.md', '.brain/rca/x.md', 'docs/architecture/x.md',
      'docs/domains/crm/x.md', 'docs/runbooks/x.md', 'docs/governance/x.md', 'docs/migrations/x.md', 'AGENTS.md', 'apps/server/x.md', 'docs/DB-NEW.md',
      '.brain/reports/x.md', 'reference/x.md', 'experiments/x.md', 'docs/roadmap/NEW.md',
    ]
    const critical = run(sample).filter((f) => f.severity === 'critical').map((f) => f.files[0]).sort()
    expect(critical).toEqual([...CRITICAL_HOMES].sort())
  })

  it('a diff that cannot be evaluated is reported as NOT EVALUATED, never as a pass', () => {
    const noBase = () => evaluateAddedDocumentGuards({ git: () => ({ ok: false, stdout: '' }), policy: real, read: () => null, exists: () => false })
    const saved = process.env.CI
    try {
      delete process.env.CI
      const local = noBase()
      expect(local).toHaveLength(1)
      expect(local[0].title).toMatch(/NOT EVALUATED/)
      expect(local[0].severity).toBe('info')
      process.env.CI = 'true'
      expect(noBase()[0].severity).toBe('warning')
    } finally {
      if (saved === undefined) delete process.env.CI
      else process.env.CI = saved
    }
    const failedDiff = evaluateAddedDocumentGuards({
      git: (args) => (args[0] === 'merge-base' ? { ok: true, stdout: 'abc\n' } : { ok: false, stdout: '' }),
      policy: real, read: () => null, exists: () => false,
    })
    expect(failedDiff[0].title).toMatch(/NOT EVALUATED/)
  })

  it('the exact set of enforce:critical rules is pinned', () => {
    const raw = JSON.parse(readFileSync(path.join(REPO_ROOT, 'docs/governance/DOCUMENT-KINDS.json'), 'utf8'))
    const enforced = raw.rules.filter((r) => r.enforce === 'critical').map((r) => r.prefix || r.pattern || r.path).sort()
    expect(enforced).toEqual([
      '.agent/', '.brain/plans/', '.rwang-tasks/', '^docs/roadmap/PLAN-[^/]+\\.md$', 'agent/', 'docs/superpowers/', 'docs/superpowers/plans/', 'docs/superpowers/specs/',
    ].sort())
    expect(raw.rules.filter((r) => r.enforce === 'critical').every((r) => r.home === 'legacy')).toBe(true)
  })

  it('a PR is compared with the branch it targets; unreadable and thrown cases are NOT EVALUATED', () => {
    const calls = []
    const git = (args) => {
      calls.push(args.join(' '))
      if (args[0] === 'merge-base') return args[2] === 'origin/release-1' ? { ok: true, stdout: 'base1\n' } : { ok: false, stdout: '' }
      if (args[0] === 'diff') return { ok: true, stdout: '' }
      return { ok: true, stdout: '' }
    }
    listAddedDocuments({ git, baseRef: 'release-1' })
    expect(calls[0]).toBe('merge-base HEAD origin/release-1')
    expect(calls.some((c) => c.includes('base1'))).toBe(true)
    const saved = process.env.CI
    try {
      process.env.CI = 'true'
      const unreadable = evaluateAddedDocuments({ added: [{ status: 'A', path: 'docs/plans/U.md', from: null }], policy: real, read: () => null, exists: () => true })
      expect(unreadable.find((f) => f.title.startsWith('NOT EVALUATED'))?.severity).toBe('warning')
      const thrown = evaluateAddedDocumentGuards({ git: () => { throw new Error('spawn failed') }, policy: real, read: () => null, exists: () => false })
      expect(thrown[0].title).toMatch(/NOT EVALUATED/)
      expect(thrown[0].severity).toBe('warning')
    } finally {
      if (saved === undefined) delete process.env.CI
      else process.env.CI = saved
    }
  })

  it('a critical finding reaches doc-preflight unchanged and can make --strict exit non-zero', () => {
    const source = readFileSync(path.join(REPO_ROOT, 'apps/server/scripts/doc-preflight.mjs'), 'utf8')
    expect(source).toMatch(/for \(const f of guards\) add\(f\.severity, f\.check, f\.title, f\.details, f\.files, f\.action\)/)
    expect(source).toMatch(/--strict'\) && report\.summary\.critical > 0\) process\.exit\(1\)/)
  })
})
