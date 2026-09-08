# `Monorepo graph is stale` fails on a fresh checkout, passes on a warm tree

Status: root cause confirmed and durably fixed. The stopgap from PR #267
(regenerate to a stable fixed point before committing) is superseded by the
structural fix below — `scripts/doc-graph.mjs` no longer writes a committed
`drift` block that can go stale relative to itself.

## Symptom

PR #267's `verify` job failed with:

```
node scripts/monorepo-graph.mjs --check
  if (canonical(read(target)) !== canonical(serialized)) throw Error('Monorepo graph is stale')
Error: Monorepo graph is stale
```

`npm test` and `npm run build` passed in the same job; only this one check
failed. Locally, `npm run govern` reported clean every time it was run in
that branch's working tree.

## Root cause

`docs/.doc-graph.json` carried a `drift: { changed, added, removed }` block
that `scripts/doc-graph.mjs` computed by comparing a fresh scan against
whatever was *currently on disk* at that path before overwriting it — a
"what changed since the last regeneration" diagnostic. When a commit is made
right after a single `npm run govern` pass that legitimately detected drift
(PR #267: `test:tests/e2e/fr149-line-server-console.spec.js` and
`test:tests/e2e/fr151-line-oa-rich-menu-console.spec.js`, both edited to add
a `test.skip` quarantine), that non-empty `drift.changed` array got baked
into the committed file, and each drifted node's `status` was set to
`"changed"` in the same commit.

That field is self-invalidating the moment it's committed: a fresh
regeneration run against that exact commit compares against *itself* and
necessarily computes empty drift, producing a different `docs/.doc-graph.json`
than the one just checked out. `scripts/monorepo-graph.mjs` derives its own
`server.nodes` from `docs/.doc-graph.json`, so a difference here could
propagate into `docs/.monorepo-graph.json`'s stale-check.

`scripts/monorepo-graph.mjs`'s own `canonical()` already strips each node's
`status` field before comparing, which closes off the most direct version of
this — a commit that is otherwise self-consistent (`docs/.doc-graph.json` and
`docs/.monorepo-graph.json` regenerated together, in the same pass, before
committing) reproduces clean on a fresh clone even carrying non-empty
`drift.changed`; confirmed directly against commit `2a1b6a81` on the PR #267
branch, node-for-node, after `status` is stripped. The field was still real
content the committed file had no business carrying, though, and it was not
the only way the underlying mechanism bit: PR #267's actual CI failures trace
to `docs/.doc-graph.json` (and therefore the `docs/.monorepo-graph.json`
derived from it) not being regenerated at all after a source edit landed —
confirmed directly against the failing commit `7bbe3cce` (which edited
`tests/unit/domain-state.test.js` without running `docs:graph` afterward): a
fresh regeneration in a scratch clone of that exact commit computed hash
`42d47909` for that test file, while the committed `docs/.monorepo-graph.json`
still carried the pre-edit hash `f1dc6268`. `monorepo-graph.mjs --check`
caught that correctly — it is a real staleness, not a false positive — but a
`drift`/`status` bookkeeping field that changes shape on every regeneration
makes exactly this kind of omission easier to miss locally (a warm tree always
looks clean because it has already re-converged) and, across the merge commits
this repo's CI tests for pull requests against an actively-moving `main`, gives
git's line-level merge more churn to reconcile than the underlying content
actually changed.

This is why the symptom reproduced identically on a genuinely fresh `git
clone` of the PR #267 branch (confirmed directly — not merely suspected)
while never reproducing across many single-pass `npm run govern` runs against
the already-regenerated working tree: a warm tree's on-disk file already
reflects the fully-converged state by the time anyone re-checks it, so
whatever the checked-out commit was missing is invisible locally and
guaranteed on every CI checkout.

## Durable fix (this change)

`scripts/doc-graph.mjs` no longer writes a `drift` block that can differ from
one regeneration to the next, and no longer overwrites any node's persisted
`status` to `"changed"`:

- The committed `docs/.doc-graph.json` always states `drift: { changed: [],
  added: [], removed: [] }` — trivially true of a file's relation to itself,
  which is what makes it safe for `monorepo-graph.mjs` (or anything else) to
  re-derive state from byte-for-byte.
- Every node keeps whatever `status` it was constructed with (`"current"` for
  almost everything; `"superseded"`/`"planned"` for requirement and document
  nodes whose registry entry says so) — never clobbered by drift tracking.
  This also fixes a latent bug the old code had: a requirement whose *content*
  changed and which was *also* marked superseded would have its real
  `superseded` status stomped to `"changed"` in the persisted graph.
- The real diff-since-last-regeneration is still computed and still reported
  — to the console (`npm run docs:graph` prints a `drift since last
  regeneration: N changed · M added · K removed` line when non-empty), and to
  a new `docs/.doc-graph-drift-report.json`, which nothing in the governance
  chain reads back or requires to be reproducible.

Grepped `apps/server/scripts`, `apps/server/tests` and `docs/*.md` for
`.drift`, `drift.changed`, `drift.added`, `drift.removed` before making this
change: nothing outside `doc-graph.mjs` itself read the committed block, so
nothing else needed updating.

This closes the specific self-invalidation class described above. It does
**not** and should not suppress the separate, legitimate failure mode found
in `7bbe3cce`: forgetting to regenerate `docs/.doc-graph.json` (and, at the
root of this monorepo, `docs/.monorepo-graph.json`) after an edit is still a
real staleness, and `monorepo-graph.mjs --check` is right to fail on it. What
changes is that the committed graph no longer carries bookkeeping that
differs on every regeneration for reasons unrelated to real content, so there
is one less source of noise between "did the content actually change" and
"does this file match itself."

### Verification

- `npm run govern`, `docs:check` and `node scripts/monorepo-graph.mjs --check`
  are all clean in the working tree that made this change.
- The actual regression test, not just a warm-tree check: edited a comment in
  `tests/e2e/fr040-project-work.spec.js` (a realistic change that previously
  would have baked a non-empty `drift.changed` entry into the committed
  graph), ran `npm run govern` once, confirmed the committed
  `docs/.doc-graph.json` already showed empty `drift` while
  `docs/.doc-graph-drift-report.json` correctly reported the real change,
  committed, then cloned that exact commit fresh into a scratch directory and
  ran `npm ci` there. On the *first* run, with no second regeneration pass:
  `node scripts/doc-graph.mjs` (regenerate) → `node scripts/doc-graph.mjs
  --check` → `node scripts/monorepo-graph.mjs --check` all passed.
