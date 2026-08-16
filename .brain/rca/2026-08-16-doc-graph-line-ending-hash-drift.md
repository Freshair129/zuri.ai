---
version: "0.1.0b"
created_at: "2026-08-16T06:47:00+07:00,CLAUDE"
last_update: "2026-08-16T06:47:00+07:00,CLAUDE"
status: "beta"
superseded_by: null
attributes:
  domain: "doc-governance-tooling"
  doc_type: "root-cause-analysis"
  scope: "scripts/doc-graph.mjs --check guard and node content hashing"
---

# RCA — doc-graph reports drift for content that never changed

## Symptom

`npm run docs:check` — the CI guard that CLAUDE.md requires to be green before any
change is considered done — failed on a **pristine** checkout of `main`, with no
local edits:

```
doc-graph is stale — run: npm run docs:graph
```

Running `npm run docs:graph` rewrote 159–160 node hashes and still left
`docs:check` failing. Only a second consecutive `docs:graph` run made it pass.
The guard was therefore unusable: it could not distinguish "someone forgot to
regenerate" from "this checkout materializes newlines differently", and its own
remedy did not clear it in one pass.

## Evidence

Measured on a clean `main` (`4220caf`), 789 nodes of which 426 carry a content hash:

- **160** hashed nodes differed from the committed graph.
- Re-encoding each differing file's working-tree content and rehashing:
  - **125** matched the committed hash when encoded **CRLF**
  - **8** matched when encoded **LF**
  - **27** matched under neither → genuinely different content
- So **133 of 160 (83%)** were byte-identical content reported as drift purely
  because of newline encoding.
- Sampling confirmed the split is not per-file-type: `code_file` 59,
  `test` 41, `document` 38, `roadmap` 12, `adr` 9, `appendix` 1.
- `git config core.autocrlf` is `true` and the repository has **no**
  `.gitattributes`, so whether a given file lands on disk as LF or CRLF depends
  on whether git last materialized it (checkout/merge) or a tool wrote it.
- Independently: `docs/ADR-020-AGENT-VAULT-AND-EPISTEMIC-MEMORY.md` exists in the
  tree but had **no node** in the committed graph, and 27 nodes had genuinely
  stale hashes — the graph had been committed without regeneration.

## Root Cause

Two independent defects, both in `scripts/doc-graph.mjs`.

**1. Hashing was line-ending sensitive.** `read()` returned raw file bytes and
`hash()` digested them directly. A file's identity therefore depended on how git
happened to materialize it, not on its content. The same class of bug was already
documented for the JSONL exporter in
[.brain/rca/2026-08-14-business-knowledge-export-hash-newline.md](.brain/rca/2026-08-14-business-knowledge-export-hash-newline.md),
whose prevention was "render once as canonical bytes and use those exact bytes
for both the digest and the artifact". That lesson was applied to the exporter
only; the doc-graph reader kept the original behaviour.

**2. The guard compared the graph's own bookkeeping.** The graph records
`drift.changed/added/removed` and a per-node `status`, which describe the graph's
*previous revision*, not the filesystem. Writing the graph therefore changes the
input to the next run: pass 1 records `status: "changed"`, pass 2 settles it back
to `"current"`. `--check` compared those fields verbatim, so it could only pass
after two consecutive `docs:graph` runs — a fixpoint requirement nothing
documented and no caller knew about.

## Why the issue escaped detection

The committed graph was generated on a checkout where the relevant files happened
to be CRLF, so it was self-consistent for whoever produced it. `docs:check` only
runs as a manual step in this repository, and the documented workflow
(CLAUDE.md: "run `docs:graph` and `docs:preflight` after any change") ends at
running the generator — nobody re-ran the guard afterwards to see it still fail.
The two-pass requirement masked the newline defect further: a second run always
"fixed" it locally, so the failure looked transient rather than structural.

There is also no test over `scripts/doc-graph.mjs` itself. The generator is
governance infrastructure that every other check reads, but it is not in the
Vitest suite, so neither defect had a regression seam.

## Fix

1. `scripts/canonical-text.mjs` is the one place newline normalization lives.
   `scripts/doc-graph.mjs` and `scripts/doc-preflight.mjs` both read through it,
   so hashes, link parsing, control-block checks and the `--check` comparison are
   all line-ending agnostic. One canonical serializer, per the earlier RCA's
   prevention — as a shared module this time, so the third site cannot regress.
2. `--check` compares a canonical projection of the graph that omits
   `generated_at`, `drift`, and per-node `status`. A genuine content change still
   fails the guard through its node hash; only the self-referential bookkeeping is
   excluded.
3. `tests/unit/doc-graph-canonical-text.test.js` pins the invariant: identical
   content written as LF and as CRLF must produce one node hash, normalization is
   idempotent, a lone `\r` is not a line ending, and line-anchored captures carry
   no trailing `\r`. The generator had no test seam at all before this.
4. The graph is regenerated once in the same change to re-baseline every hash on
   canonical LF content and to pick up the 27 genuinely stale nodes plus the
   missing ADR-020 node.

Verified: with a real source edit `docs:check` exits 1; on a clean tree it exits
0; the identical file written as CRLF and as LF both pass; and a single
`docs:graph` run now satisfies `docs:check` where two were required before.

## Proposed prevention

1. Any digest over repository content normalizes newlines first — this is now the
   second occurrence of the same failure mode, so treat it as a standing rule
   rather than a per-site fix.
2. Never compare a generated artifact's self-referential drift bookkeeping when
   asking whether it is current; compare only what describes the source of truth.
3. Route any future content digest through `scripts/canonical-text.mjs` rather
   than calling `readFileSync` directly.
4. Optional and more invasive: add a `.gitattributes` normalizing text files so
   checkouts stop varying. Not done here — it would rewrite line endings across
   the whole tree and touch every open branch. Making the tooling insensitive is
   the smaller, safer fix and removes the dependency entirely.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-16 | beta | Documented line-ending-sensitive hashing and self-referential `--check` comparison in doc-graph | pending | CLAUDE |
