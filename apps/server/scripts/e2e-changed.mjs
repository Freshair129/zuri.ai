#!/usr/bin/env node
// Run only the e2e specs this branch's changes can affect.
//
// `npm run test:e2e` always runs every spec, which is right for CI on `main`
// and wrong for the loop a person is actually in: change one domain, wait ~21
// minutes to learn whether you broke it. CI has answered this since PR #342 —
// `scripts/ci-select-e2e.mjs` maps changed paths to the specs that can observe
// them — but the mapping was reachable only from the workflow, so locally the
// choice stayed "all of it or none of it". This is that same selector, run
// against the working tree.
//
// It is deliberately the SAME function CI calls, not a second implementation:
// a local selector that drifted from the CI one would tell you a change is
// covered when the pipeline disagrees, which is worse than having no local
// command at all.
//
// @req NFR-008 — the suite must fail for the reason under test.
// @tested tests/unit/ci-select-e2e.test.js
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { selectE2ETargets } from '../../../scripts/ci-select-e2e.mjs'

const BASE = process.env.E2E_CHANGED_BASE || 'origin/main'
const serverRoot = process.cwd()
// `--dry-run` prints the selection and stops. It exists so "what would this
// run?" is answerable in a second rather than by starting a dev server and
// watching — and so the selection can be checked in a test without paying for
// a real browser run.
const dryRun = process.argv.includes('--dry-run')

function git(args) {
  const run = spawnSync('git', args, { encoding: 'utf8' })
  if (run.status !== 0) return null
  return run.stdout
}

// Three sources, because a change is "yours" whether or not you have committed
// it yet, and a run that ignored the uncommitted half would green-light the
// edit you are still making.
function changedFiles() {
  const sets = [
    git(['diff', '--name-only', `${BASE}...HEAD`]), // committed on this branch
    git(['diff', '--name-only', 'HEAD']), // unstaged
    git(['diff', '--name-only', '--cached']), // staged
    git(['ls-files', '--others', '--exclude-standard']), // new, untracked
  ]
  if (sets[0] === null) {
    console.error(`Cannot diff against ${BASE} — fetch it first (git fetch origin main), or set E2E_CHANGED_BASE.`)
    process.exit(2)
  }
  const all = sets.filter(Boolean).join('\n').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  return [...new Set(all)]
}

const files = changedFiles()
const result = selectE2ETargets(files, { serverRoot })

console.log(`Changed files vs ${BASE}: ${files.length}`)
console.log(`Selection: ${result.reason}`)

if (result.skip) {
  // Nothing an e2e spec could observe. Exit 0 rather than invoking Playwright:
  // `assert-tests-ran.mjs` exists to fail a run that executed zero tests, and
  // it is right to — but "the selector found nothing to run" is a different
  // statement from "the suite silently ran nothing", and only the second is a
  // defect. Say which one happened.
  console.log('No e2e target can observe these changes — nothing to run.')
  process.exit(0)
}

// The warm-up is included on purpose, and it is the expensive half.
//
// Playwright's positional arguments filter by FILE PATH across every project,
// and the `e2e` project's `dependencies: ['warmup']` is satisfied by a warm-up
// project that matched zero tests. So a filtered run silently drops the
// warm-up and pays Next's first-request compile inside the specs instead —
// exactly the rotating cold-compile flake that PR #285 diagnosed and that
// `--fail-on-flaky` now turns into a failed run rather than a hidden retry.
// Naming `warmup.setup.js` alongside the selected specs keeps it matched.
//
// It is not free: ~393s locally (the figure warmup.setup.js records). Kept
// anyway, because the alternative is a fast answer that is wrong in a way that
// looks like a product bug. The win is still large — warm-up plus a handful of
// specs is roughly 7-8 minutes against ~21 for the full suite — because what
// is skipped is the 160 specs this change cannot reach, not the warm-up.
//
// Scoping the warm-up to just the routes the selected specs touch would need a
// spec-to-route mapping that does not exist; inventing one would be a second
// selector to keep correct, and a stale one would reintroduce the same flake.
const filters = result.runAll ? [] : ['tests/e2e/warmup.setup.js', ...result.specs]

if (result.runAll) console.log('Running the full suite.')
else console.log(`Running ${result.specs.length} spec(s) plus the warm-up:\n  ${result.specs.join('\n  ')}`)

if (dryRun) {
  console.log('--dry-run: stopping before Playwright.')
  process.exit(0)
}

const child = spawnSync(
  process.execPath,
  [path.join('scripts', 'assert-tests-ran.mjs'), 'playwright', 'test', '--fail-on-flaky', ...filters],
  { stdio: 'inherit' },
)
process.exit(child.status ?? 1)
