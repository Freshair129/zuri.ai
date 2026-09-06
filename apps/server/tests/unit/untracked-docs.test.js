import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { GIT_ARGS, CI_BLIND_SPOT, parseUntracked, evaluateUntrackedDocs } from '../../scripts/untracked-docs.mjs'

// @spec scripts/untracked-docs.mjs — preflight Check 15 (untracked-docs)
//
// On 2026-08-30 four change-request documents sat in the working tree of the
// shared primary checkout: untracked, not gitignored, absent from main. Nothing
// in this repository could see them — not govern, not preflight, not CI, not the
// doc graph — because every one of those builds its input from the tracked-file
// list, which excludes untracked files by construction. They were found by
// byte-comparing the tree against `git archive`. This file is the regression.
//
// EVERY PATH BELOW IS SYNTHETIC. scripts/doc-graph.mjs turns any
// requirement-id-shaped token in a test file into a `verifies` edge, so quoting
// the real filenames as fixture data would credit this test in TRACE.md and
// Appendix D with requirements it does not exercise. Fixtures use a `QQ-` family
// that no registry declares.

// git ls-files -z emits NUL-separated paths with a trailing NUL. The fixture
// reproduces that byte-for-byte rather than joining with newlines, because the
// separator is the part of the contract a wrong flag would break.
const gitOut = (...paths) => (paths.length ? paths.join('\0') + '\0' : '')
const ok = (...paths) => () => ({ ok: true, stdout: gitOut(...paths) })

describe('parseUntracked — NUL framing', () => {
  it('reads every path and never invents an empty one from the trailing NUL', () => {
    expect(parseUntracked(gitOut('docs/a.md', 'docs/b/c.md'))).toEqual(['docs/a.md', 'docs/b/c.md'])
    expect(parseUntracked(gitOut())).toEqual([])
    expect(parseUntracked('')).toEqual([])
    expect(parseUntracked(undefined)).toEqual([])
  })

  it('keeps a path containing spaces and non-ASCII intact', () => {
    // The reason GIT_ARGS carries -z: without it git quotes and octal-escapes
    // any non-ASCII path, and this repository writes Thai copy by convention.
    const thai = 'docs/change-requests/QQ-001-ข้อเสนอ.md'
    expect(parseUntracked(gitOut('docs/notes/two words.md', thai))).toEqual(['docs/notes/two words.md', thai])
  })
})

describe('evaluateUntrackedDocs — the untracked case', () => {
  it('fires, and names every file rather than reporting a count', () => {
    const files = [
      'docs/change-requests/QQ-002-alpha.md',
      'docs/change-requests/QQ-003-beta.md',
      'docs/change-requests/QQ-004-gamma.md',
      'docs/change-requests/QQ-005-delta.md',
    ]
    const [finding, ...rest] = evaluateUntrackedDocs({ git: ok(...files) })
    expect(rest).toEqual([])
    expect(finding.severity).toBe('warning')
    expect(finding.check).toBe('untracked-docs')
    expect(finding.files).toEqual(files)
    // Named, not counted: the whole failure was four documents nobody could
    // enumerate, so a finding that says "4 files" repeats it.
    for (const f of files) expect(finding.details).toContain(f)
  })

  it('says nothing at all about a tree with no untracked documents', () => {
    expect(evaluateUntrackedDocs({ git: ok() })).toEqual([])
  })

  it('tells the reader that .gitignore is not the way out', () => {
    // An ignored file is hidden from --exclude-standard too, so the cheapest
    // workaround would rebuild the blind spot this check closes.
    expect(evaluateUntrackedDocs({ git: ok('docs/x.md') })[0].action).toMatch(/gitignore is NOT/i)
  })
})

describe('evaluateUntrackedDocs — a check that cannot look must never report clean', () => {
  it('is CRITICAL when git exits non-zero, and quotes why', () => {
    const git = () => ({ ok: false, reason: 'exited 128: not a git repository' })
    const [finding, ...rest] = evaluateUntrackedDocs({ git })
    expect(rest).toEqual([])
    expect(finding.severity).toBe('critical')
    expect(finding.details).toContain('not a git repository')
    expect(finding.action).toMatch(/could not look/i)
  })

  it('is CRITICAL when the runner throws, e.g. git is not on PATH', () => {
    const git = () => { throw new Error('spawn git ENOENT') }
    const [finding] = evaluateUntrackedDocs({ git })
    expect(finding.severity).toBe('critical')
    expect(finding.details).toContain('ENOENT')
  })

  it('is CRITICAL when the runner returns nothing recognisable', () => {
    // An empty stdout from a command that never ran is indistinguishable from a
    // healthy tree, which is the exact defect class this check exists to close.
    for (const git of [() => undefined, () => ({}), () => ({ ok: false })]) {
      expect(evaluateUntrackedDocs({ git })[0].severity).toBe('critical')
    }
  })
})

describe('evaluateUntrackedDocs — the CI blind spot is stated, not implied', () => {
  it('emits a standalone info on a CI runner, even when the tree is clean', () => {
    const findings = evaluateUntrackedDocs({ git: ok(), ci: true })
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('info')
    expect(findings[0].details).toBe(CI_BLIND_SPOT)
  })

  it('does not editorialise locally, where the check can actually see', () => {
    expect(evaluateUntrackedDocs({ git: ok(), ci: false })).toEqual([])
  })

  it('carries the limitation on every finding a reader could mistake for coverage', () => {
    expect(CI_BLIND_SPOT).toMatch(/CANNOT fire in CI/)
    expect(evaluateUntrackedDocs({ git: ok('docs/x.md') })[0].action).toContain(CI_BLIND_SPOT)
    expect(evaluateUntrackedDocs({ git: () => ({ ok: false, reason: 'x' }) })[0].action).toContain(CI_BLIND_SPOT)
  })
})

// Closed-world, in the idiom of tests/unit/profile-identity-fields-migration.test.js:
// the assertion's strength is that it names the WHOLE permitted set, so it fails
// on a path nobody thought to write a test for. A check that grows a fifth,
// quieter outcome — an untracked file downgraded to info, say — breaks here
// rather than shipping unnoticed.
describe('the complete set of outcomes this check can produce', () => {
  const inputs = {
    'clean tree': { git: ok() },
    'clean tree on CI': { git: ok(), ci: true },
    'untracked files': { git: ok('docs/a.md') },
    'untracked files on CI': { git: ok('docs/a.md'), ci: true },
    'git failed': { git: () => ({ ok: false, reason: 'boom' }) },
    'git threw': { git: () => { throw new Error('boom') } },
    'runner returned junk': { git: () => null },
  }

  // The three outcomes, keyed on severity AND on what the title says — matched
  // by pattern rather than by a prefix slice, so rewording a message is free
  // while adding a fourth outcome is not.
  const OUTCOMES = {
    'info/blind-spot': (f) => f.severity === 'info' && /blind on this runner/.test(f.title),
    'warning/untracked': (f) => f.severity === 'warning' && /untracked and invisible/.test(f.title),
    'critical/could-not-look': (f) => f.severity === 'critical' && /could not enumerate/.test(f.title),
  }

  it('emits nothing outside {info: blind-spot, warning: untracked, critical: could-not-look}', () => {
    const seen = new Set()
    for (const deps of Object.values(inputs)) {
      for (const f of evaluateUntrackedDocs(deps)) {
        expect(f.check).toBe('untracked-docs')
        // Shape, enumerated: a finding missing a field is a finding preflight
        // renders as `undefined` in the report.
        expect(Object.keys(f).sort()).toEqual(['action', 'check', 'details', 'files', 'severity', 'title'])
        expect(typeof f.action).toBe('string')
        expect(f.action.length).toBeGreaterThan(0)
        const matched = Object.entries(OUTCOMES).filter(([, p]) => p(f)).map(([k]) => k)
        // Exactly one: an outcome matching none is a new one nobody declared,
        // and an outcome matching two means the classifiers stopped separating
        // the cases this test claims to bound.
        expect(matched, `unclassified finding: ${f.severity} — ${f.title}`).toHaveLength(1)
        seen.add(matched[0])
      }
    }
    // And all three are actually reachable, so the set is a bound rather than
    // an aspiration.
    expect([...seen].sort()).toEqual(Object.keys(OUTCOMES).sort())
  })

  it('never reports zero findings for an input where git did not answer', () => {
    for (const [name, deps] of Object.entries(inputs)) {
      const findings = evaluateUntrackedDocs(deps)
      if (name.startsWith('clean tree')) continue
      expect(findings.some((f) => f.severity === 'critical' || f.severity === 'warning')).toBe(true)
    }
  })
})

// The injected-runner tests above cannot catch a wrong flag — they never run
// git. This one does, against a repository built for the purpose, and asserts
// the EXACT set the real invocation returns. It is what proves `--others`,
// `--exclude-standard`, the `--` fence and the `docs/` pathspec are all right.
describe('GIT_ARGS against a real repository', () => {
  it('returns exactly the untracked, non-ignored files under docs/ and nothing else', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'untracked-docs-'))
    const write = (rel, body = 'x\n') => {
      const abs = path.join(dir, rel)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, body)
    }
    const git = (...args) => {
      const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true })
      // Never swallowed: a setup step that failed would otherwise make this test
      // pass by producing an empty repository.
      if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.error?.message}`)
      return r.stdout
    }

    try {
      git('init', '-q')
      git('config', 'user.email', 'test@example.invalid')
      git('config', 'user.name', 'test')

      write('.gitignore', 'docs/ignored/\n')
      write('docs/tracked.md')          // tracked → must not appear
      write('docs/ignored/secret.md')   // gitignored → must not appear
      git('add', '.gitignore', 'docs/tracked.md')
      git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'base')

      write('docs/change-requests/QQ-002-alpha.md')  // untracked → must appear
      write('docs/nested/deep/QQ-003-beta.md')       // untracked, nested → must appear
      write('src/stray.js')                          // untracked, outside docs/ → must not appear
      write('root-stray.md')                         // untracked, at root → must not appear

      const found = parseUntracked(git(...GIT_ARGS)).sort()
      // Exact equality, not toContain: the point is the whole set, so a flag that
      // over-reports (dropping --exclude-standard) fails here just as loudly as
      // one that under-reports.
      expect(found).toEqual(['docs/change-requests/QQ-002-alpha.md', 'docs/nested/deep/QQ-003-beta.md'])

      // And the check built on it fires, by name.
      const [finding] = evaluateUntrackedDocs({ git: () => ({ ok: true, stdout: git(...GIT_ARGS) }) })
      expect(finding.severity).toBe('warning')
      expect(finding.files.sort()).toEqual(found)

      // Remove them and it goes quiet — the other half of the proof.
      fs.rmSync(path.join(dir, 'docs/change-requests'), { recursive: true, force: true })
      fs.rmSync(path.join(dir, 'docs/nested'), { recursive: true, force: true })
      expect(evaluateUntrackedDocs({ git: () => ({ ok: true, stdout: git(...GIT_ARGS) }) })).toEqual([])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
