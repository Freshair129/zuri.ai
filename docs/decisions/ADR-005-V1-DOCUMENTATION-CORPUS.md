# ADR-005 — Import V1's Documentation as a Read-Only Corpus, With Two Id Namespaces

> [!WARNING]
> **Superseded in full — do not act on this document.** The corpus, the import
> script and the `V1-` citation namespace were retired by
> [ADR-024](ADR-024-ZURI-AI-IS-A-STANDALONE-PRODUCT.md) (2026-08-16) together
> with the replace-by-reuse program they served. This text is preserved as history.

**Status:** Superseded
**Superseded by:** [ADR-024](ADR-024-ZURI-AI-IS-A-STANDALONE-PRODUCT.md)
**Date:** 2026-08-12
**Decided by:** Owen (owner)
**Relates to:** [ADR-003](ADR-003-V2-REPLACES-V1-BY-REUSE.md) (reuse V1), [ADR-004](ADR-004-DOCUMENTATION-ARCHITECTURE.md) (doc structure), AGENTS.md §18 (id contract)

## Context

ADR-003 decided to reuse V1's implementation rather than rebuild it. The same
argument applies to its documentation: writing a fresh feature note for every lifted
module would be rebuilding knowledge that already exists.

Measured (read-only scan of `G:\zuri`, commit `0b6d3c3`, 2026-08-10):

| | |
|---|---|
| Markdown files | **238** (2.5 MB of text; the 46 MB folder is mostly images and canvases) |
| Structure | `decisions/adrs` · `specs` · `architecture` · `product` · `runbooks` · `standards` · `contracts` · `appendices` · `gate-readiness` · `reviews` · `gotchas` · `guide` |
| ADRs | **25, numbered ADR-057…ADR-086+** |
| Change requests | CR-001…CR-013 |
| `id_standards.yaml` | source of truth for customer ids, SKUs, order ids and tenant codenames (e.g. `TVS` = The V School) |

Three problems block a naive copy:

1. **Id collision.** V2 has ADR-001…ADR-005; V1 has ADR-057…ADR-086. Merged under
   one prefix, "ADR-060" becomes ambiguous. AGENTS.md §18 forbids renumbering either
   side.
2. **The lifted code cites these ids.** V1's Prisma schema and source carry comments
   like `FEAT21`, `ADR-086`, `CR-007`, `ZDEV-TSK-20260409-053`. Lifting the UI
   without the corpus leaves every one of those pointing at nothing.
3. **The corpus describes V1 semantics.** Everywhere it says "tenant" it means *one
   shop*. Imported unmarked, it becomes an authoritative-looking source of exactly
   the confusion this project keeps having to correct.

## Decision

**Import V1's markdown corpus into `docs/v1-inherited/` as a read-only mirror, keep
the two id namespaces separate, and map them per feature only when that feature is
actually lifted.**

| # | Decision | Rationale |
|---|---|---|
| D1 | Mirror `G:\zuri\docs\**\*.md` + `id_standards.yaml` into `docs/v1-inherited/`, preserving the original tree and filenames | Filenames are what the lifted code's comments resolve against |
| D2 | The mirror is **read-only**. Corrections are written in V2 documents that cite the inherited file — never by editing it | An edited mirror can no longer be re-synced, and stops being evidence of what V1 actually said |
| D3 | Import is **scripted** (`npm run docs:import-v1`), recording source commit and file count in `MANIFEST.json` | V1 moves ~213 commits/90 days; a re-sync must be one command, and provenance must be checkable |
| D4 | Every imported file gets a **provenance banner** at import time: read-only, source path, source commit, and the warning that "tenant" means one shop | A reader who opens a random file must see it without going back to a README |
| D5 | **Two id namespaces coexist.** V2 keeps `FR/NFR/BR/SEC/SDD/ADR-00x`. V1's ids are cited from V2 documents with a `V1-` prefix (`V1-ADR-060`, `V1-FEAT-21`, `V1-CR-007`) while the files keep their original names | Neither side is renumbered (§18); ambiguity is removed at the point of citation |
| D6 | The V1 ↔ V2 mapping table is filled **per feature at lift time**, in `docs/replacement/PARITY-INVENTORY.md` — not upfront for 238 files | Same pattern as `ExternalRef` for data: their id stays theirs, ours stays ours, a mapping joins them |
| D7 | Feature notes for lifted features record **only the delta** (what changed in the lift: scope model, auth, endpoints), citing the inherited document for the rest | This is the saving — not writing ~60 notes from scratch |
| D8 | Not imported: images and canvases (43 MB), and V1's own process governance (`gks/`, MSP scripts, workflow templates) | Product knowledge comes; another project's working method does not |
| D9 | The doc graph indexes the corpus as type `v1_inherited`; preflight exempts it from control-block and link checks | 238 inherited files would otherwise flood the report with findings nobody will act on, and their relative links point at V1 paths that do not exist here |

## Consequences

- `docs/v1-inherited/` adds ~238 files / 2.5 MB to the repo. That is the price of not
  rewriting them, and it is cheap.
- The corpus is **evidence, not authority**. When it disagrees with a V2 document,
  the V2 document wins; when it disagrees with V1's code, the code wins (the trust
  hierarchy in `rwang:doc-preflight` applies).
- Importing does **not** reduce the parity work. Someone still has to decide, per
  module, which inherited statements are still true. What disappears is the blank
  page, not the judgement.
- A stale mirror is a real risk: V1 keeps moving. `MANIFEST.json` records the source
  commit so drift is visible, and re-syncing is one command. Re-sync before each
  module's cutover, not continuously.

## Revision 2 — the mirror stops being tracked (2026-08-16)

**Status:** Accepted · amends D1 and D9; D2–D8 stand unchanged.

The original decision weighed 238 files against the cost of rewriting them and
called the price "cheap". Measured four days later, the price was not the disk
space — it was attention:

| | |
|---|---|
| Share of `docs/` that was the mirror | **236 of 402 files — 59%** |
| V2 documents citing a specific inherited file | **0** |
| Graph edges pointing into a `v1_inherited` node | **0** |

D5 kept the two id namespaces apart, and D9 kept the corpus out of the checks.
Neither stopped it from being the majority of what anyone reads when they open
`docs/`, in a vocabulary where *tenant* means one shop. The owner's report was that
the naming collision between V1 and V2 was the single most confusing thing in the
repository — and the mechanism that made a V1 file reachable at all was never used.

**D10 — the corpus is no longer tracked.** `npm run docs:import-v1` still
materializes it into `docs/v1-inherited/`, and `.gitignore` keeps it out of the
repository. It is fetched when someone is actually doing parity work and is absent
otherwise.

**D11 — the doc tooling ignores the directory entirely.** Previously the graph
indexed it as type `v1_inherited` (D9) so a V2 document could cite an inherited
file and have the reference validated. With the directory now present on some
machines and not others, indexing it would make the committed graph describe
whichever machines had run the import. `scripts/doc-graph.mjs` and
`scripts/doc-preflight.mjs` exclude it; the graph drops from 795 nodes to 561.

What this does **not** change: D6 still governs the V1 ↔ V2 mapping at lift time,
and it is filled from the imported corpus the same way. The corpus did not become
less useful — it stopped being resident.

## Review

Revisit when the first module is lifted. If the delta-note pattern (D7) turns out to
need more context than the inherited file provides, the answer is a fuller V2 note
for that feature — not editing the mirror. If parity work turns out to need the
corpus resident rather than on demand (D10), that is the signal to reconsider — a
separate repository the parity docs depend on, not a re-merge into this tree.
