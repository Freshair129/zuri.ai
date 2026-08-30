// The rule behind preflight Check 15 (untracked-docs), kept out of
// doc-preflight.mjs for the same reason scripts/roadmap-evidence.mjs and
// scripts/id-stability.mjs are: that script is straight-line and derives ROOT
// from its own location, so it cannot be pointed at a fixture. The decisions
// with judgement in them — what severity a stray document earns, what happens
// when git cannot be asked, and what this check is structurally unable to see —
// live here where a test can reach them.
//
// Filesystem-free and process-free by construction: the git invocation is
// injected. Everything below works in repo-relative POSIX paths, which is what
// `git ls-files` emits on every platform including Windows.

/**
 * The exact invocation. Exported so the test can assert on it rather than on a
 * second copy of the argument list — a check that enumerates the wrong set is
 * the failure this whole check exists to close, and the argument list is where
 * that would happen here.
 *
 * `--others` is untracked, `--exclude-standard` honours .gitignore/.git/info/
 * exclude, and `--` fences the pathspec so a file named like a flag cannot be
 * read as one.
 *
 * `-z` is not cosmetic. Without it git *quotes and octal-escapes* any path
 * containing a non-ASCII byte, so a Thai-named note — and this repository writes
 * Thai copy by convention — would be reported as `"docs/\340\270..."`, a name
 * nobody can act on and no `git add` will take. NUL separation sidesteps quoting
 * entirely, so what the finding prints is the path.
 */
export const GIT_ARGS = ['ls-files', '--others', '--exclude-standard', '-z', '--', 'docs/']

/**
 * The limitation, in the words that go into the report.
 *
 * A CI checkout has no untracked files by construction: the runner clones a
 * commit. So this check passes in CI no matter what is sitting in anybody's
 * working tree, and its green there means only that git found nothing to find.
 * That is stated in the finding's own `action`, and emitted as a standalone
 * `info` on every CI run (see `evaluateUntrackedDocs`), because the way a guard
 * fools the next person is by being silent about what it cannot see. The class
 * this check covers is closed by `npm run govern` locally and by nothing else.
 */
export const CI_BLIND_SPOT =
  'This check CANNOT fire in CI — a CI checkout has no untracked files by construction, so it passes there ' +
  'regardless of what sits in any working tree. A green governance run on a pull request is not evidence that ' +
  'this class is clean. It is closed by running npm run govern locally, and by nothing else.'

/**
 * Parse `git ls-files -z` output into paths.
 *
 * NUL-separated with a trailing NUL, so the final split element is always empty;
 * empties are dropped rather than assumed to be exactly one.
 */
export function parseUntracked(stdout) {
  return (stdout || '').split('\0').map((p) => p.trim()).filter(Boolean)
}

/**
 * Findings for Check 15, in doc-preflight's `add()` shape.
 *
 * @param {object}   deps
 * @param {Function} deps.git  () => { ok: true, stdout } | { ok: false, reason }
 * @param {boolean}  deps.ci   true when running on a CI runner
 *
 * ## Why WARNING, and why there is no baseline file
 *
 * **Severity is `warning`.** The obvious alternative is CRITICAL, and it is
 * wrong here for a reason that is specific rather than squeamish: this check
 * fires on state that is *transient and machine-local*. A contributor with a
 * half-written note in `docs/` has done nothing wrong, and `govern` is run
 * constantly and locally — so a CRITICAL would block work that is fine, and the
 * cheapest way out of it is `echo 'docs/scratch/' >> .gitignore`. That move
 * converts an untracked file, which this check can see, into an *ignored* file,
 * which `--exclude-standard` deliberately hides from it. A gate whose easiest
 * workaround manufactures the exact blind spot it was built to close is worse
 * than no gate: it would have made the CR-002..005 case permanently invisible
 * instead of merely invisible.
 *
 * The force of this check was never going to come from its severity anyway. It
 * comes from naming **every** file, so the finding cannot be read as a count and
 * shrugged off, and from carrying its own limitation in the text.
 *
 * **There is no shrink-only baseline**, and that is a departure from this
 * repo's convention for "real but accepted" (`.route-anchor-baseline.json`,
 * `.roadmap-evidence-baseline.json`). Those baselines pin *durable* facts: a
 * route with no requirement anchor, an evidence path that does not resolve —
 * each stays true in every checkout until somebody repairs it, so a committed
 * list of them is a real ratchet. An untracked file is the opposite on both
 * counts. It is per-working-tree, so one contributor's baseline would silence a
 * condition another contributor does not have; and its remedy is one `git add`,
 * not a repair, so an entry becomes unsatisfiable noise the moment the file is
 * tracked. Worst of all, committing the *name* of a file that is not committed
 * is the visibility fiction this check exists to break — the repo would then
 * hold a record saying the document is known, while still holding none of it.
 *
 * ## Why a failed git call is CRITICAL
 *
 * If `git ls-files` cannot run — no git on PATH, not a repository, a broken
 * index — the honest answer is "this check could not look", never "clean". The
 * repeating defect in this codebase is a guard whose source cannot represent the
 * failure it screens for, and an empty list returned from a crashed command is
 * that defect in its purest form: indistinguishable from a healthy tree.
 */
export function evaluateUntrackedDocs({ git, ci = false }) {
  const findings = []

  if (ci) {
    findings.push({
      severity: 'info',
      check: 'untracked-docs',
      title: 'untracked-docs is structurally blind on this runner',
      details: CI_BLIND_SPOT,
      files: [],
      action: 'Read this check\'s result from a local npm run govern; CI cannot produce evidence for it',
    })
  }

  let result
  try {
    result = git()
  } catch (e) {
    result = { ok: false, reason: e?.message || String(e) }
  }

  if (!result || result.ok !== true) {
    findings.push({
      severity: 'critical',
      check: 'untracked-docs',
      title: 'could not enumerate untracked documents',
      details: `git ${GIT_ARGS.join(' ')} — ${result?.reason || 'the runner returned nothing'}`,
      files: [],
      action:
        'This check could not look, which is NOT the same as finding nothing — do not read this run as evidence that docs/ is fully tracked. ' +
        'Run the command by hand to see why it failed. ' + CI_BLIND_SPOT,
    })
    return findings
  }

  const untracked = parseUntracked(result.stdout)
  if (untracked.length) {
    findings.push({
      severity: 'warning',
      check: 'untracked-docs',
      title: `${untracked.length} document(s) under docs/ are untracked and invisible to every other check`,
      // Every path, never a count. govern, docs:graph, docs:check, preflight and
      // CI all build their inputs from the tracked-file list, so a file in this
      // list is one that no other check in this repository can represent.
      details: untracked.join(', '),
      files: untracked,
      action:
        'git add them if they belong to the repository, or delete them if they do not. Adding them to .gitignore is NOT the third option: ' +
        'an ignored file is hidden from this check too, which is strictly worse than an untracked one. ' + CI_BLIND_SPOT,
    })
  }

  return findings
}
