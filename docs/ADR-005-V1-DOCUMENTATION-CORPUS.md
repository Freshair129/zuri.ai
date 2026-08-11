# ADR-005 — Import V1's Documentation as a Read-Only Corpus, With Two Id Namespaces

**Status:** Accepted
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

## Review

Revisit when the first module is lifted. If the delta-note pattern (D7) turns out to
need more context than the inherited file provides, the answer is a fuller V2 note
for that feature — not editing the mirror.
