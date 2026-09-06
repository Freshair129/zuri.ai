# `Monorepo graph is stale` fails on a fresh checkout, passes on a warm tree

Status: root cause confirmed and worked around by regenerating to a stable
fixed point before committing. The structural cause in `scripts/doc-graph.mjs`'s
drift tracking is not fixed here — see "What this doesn't fix" below.

## Symptom

PR #267's `verify` job failed with:

```
node scripts/monorepo-graph.mjs --check
  if (canonical(read(target)) !== canonical(serialized)) throw Error('Monorepo graph is stale')
Error: Monorepo graph is stale
```

`npm test` and `npm run build` passed in the same job; only this one check
failed. Locally, `npm run govern` reported clean every time it was run in
this branch's working tree.

## Root cause

`docs/.doc-graph.json` carries a `drift: { changed, added, removed }` block
that `scripts/doc-graph.mjs` computes by comparing a fresh scan against
whatever is *currently on disk* at that path before overwriting it — a
"what changed since the last regeneration" diagnostic. When a commit is made
right after a single `npm run govern` pass that legitimately detected drift
(here: `test:tests/e2e/fr149-line-server-console.spec.js` and
`test:tests/e2e/fr151-line-oa-rich-menu-console.spec.js`, both edited to add
a `test.skip` quarantine), that non-empty `drift.changed` array gets baked
into the committed file.

That field is self-invalidating the moment it's committed: a fresh
regeneration run against that exact commit compares against *itself* and
necessarily computes empty drift, producing a different
`docs/.doc-graph.json` than the one just checked out. `scripts/monorepo-graph.mjs`
derives its own `server.nodes` from `docs/.doc-graph.json`, so this
difference propagates into `docs/.monorepo-graph.json`'s stale-check even
though `canonical()` already strips the unrelated per-node `status` field —
the mismatch was in the top-level graph state feeding into it, not in
anything `canonical()` was ever designed to ignore.

This is why it reproduced identically on a genuinely fresh `git clone` of
this exact branch (confirmed directly — not merely suspected) while never
reproducing across many single-pass `npm run govern` runs against the
already-regenerated working tree: a warm tree's on-disk file already reflects
zero drift by the time anyone re-checks it, so the self-invalidation is
invisible locally and guaranteed on every CI checkout.

## Fix applied here

Ran `npm run govern` a second (and third, to confirm) time before committing,
each time comparing file hashes to the previous run. The first pass cleared
`drift.changed` to `[]`; the second and third passes produced byte-identical
output to the first, confirming a stable fixed point. Committing that
fixed-point state means a fresh checkout's own regeneration reproduces it
exactly, and `monorepo-graph.mjs --check` passes.

## What this doesn't fix

The structural cause remains: **any** commit whose own `npm run govern` pass
detects real drift (the normal, expected case whenever tracked files change)
will bake a non-empty `drift` block into `docs/.doc-graph.json` unless
someone remembers to run the chain a second time before committing. Nothing
enforces that today. A durable fix belongs to the governance tooling itself
— e.g., `doc-graph.mjs` writing an already-empty `drift` block (since a
freshly-written file's "current" state trivially has no drift from itself),
and reporting the *actual* diff either on stdout only or in a separate,
never-committed file. That is out of scope here: it changes shared tooling
every PR depends on, and deserves its own change and review rather than a
one-off patch made to unblock this PR under CI pressure.
