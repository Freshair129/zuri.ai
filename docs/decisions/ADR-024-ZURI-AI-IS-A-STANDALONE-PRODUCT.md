# ADR-024 — zuri-ai Is a Standalone Product; the Replace-by-Reuse Program Is Retired

**Status:** Accepted
**Date:** 2026-08-16
**Decided by:** Boss (owner)
**Supersedes:** [ADR-003](ADR-003-V2-REPLACES-V1-BY-REUSE.md) (the replace-by-reuse direction, in full), [ADR-005](ADR-005-V1-DOCUMENTATION-CORPUS.md) (the imported corpus and the `V1-` citation namespace, in full)
**Relates to:** [ADR-001](ADR-001-STANDALONE-ZURI-V2.md) (whose standalone instinct this restores), AGENTS.md §18 (id contract — unchanged)

## Context

ADR-003 set the repository's direction as "V2 replaces V1 by reuse": the legacy
project's web UI would be lifted module by module, its tenants cut over one at a
time, its UUIDs preserved. Everything in this repository that mentions "V1" —
the imported documentation corpus (ADR-005), the `V1-` citation prefix,
`docs/replacement/`, the cutover runbook, `PHASE-V2-REPLACE`, the hard rules
about preserving UUIDs and single-system tenant ownership — is scaffolding built
for that program.

Measured on 2026-08-16, before writing this decision:

| Fact | Value |
|---|---|
| References from this product's code (`src/`, `tests/`, `prisma/`, `contracts/`) to the legacy project | **0** |
| Modules actually lifted from the legacy UI since ADR-003 | **0** — all 57 FRs were built new |
| V2 documents citing a specific file of the imported corpus | **0** (the corpus was untracked in ADR-005 rev 2 for this reason) |
| Legacy project's own status (`CRITICAL_FACTS.md`, read-only) | production in **permanent demo mode**, serving fixtures — no real tenant data, no paying customers |

The program's premise — that reuse is cheaper than rebuilding, and that live
tenants must survive the transition — did not survive contact with reality. The
tenants it was designed to protect do not exist, and four days of actual work
rebuilt everything it planned to lift. Meanwhile the scaffolding it justified
became the single largest source of confusion in the repository: two vocabularies
in which *tenant* means different things, three colliding id namespaces, and a
mirror that was 59% of `docs/` with zero inbound references.

The owner's decision, stated directly: **this repository is not "Zuri V2". It is
zuri-ai, a different product.** The legacy project at `G:\zuri` is a separate,
discontinued codebase — prior art, not an ancestor.

## Decision

| # | Decision | Rationale |
|---|---|---|
| D1 | **zuri-ai is a standalone product.** It does not replace, extend, version, or migrate the legacy `G:\zuri` project. No module will be lifted from it; no data will be migrated from it; no tenant cutover will ever occur | The program those activities belonged to produced zero output in its lifetime and its protective premises (live tenants, printed UUIDs, LINE bindings at risk) are factually absent |
| D2 | **The "V1"/"V2" vocabulary is retired from all live documents.** This product is *zuri-ai*. The legacy project is *the legacy zuri project (`G:\zuri`)*. Governing documents (CLAUDE.md, AGENTS.md, PRODUCT, roadmap) carry no V1/V2 language | The version framing is the root of the naming confusion: it implies lineage and shared semantics that do not exist |
| D3 | **Historical documents are stamped, not rewritten.** ADR-001–023 and ZV2-CR-001–008 keep their text; ADR-003 and ADR-005 carry a superseded banner pointing here. A reader — human or agent — who opens them sees on the first line that the program is dead | Rewriting accepted history is forbidden (ADR-004); the anti-hallucination guard is the banner plus the standing rule in CLAUDE.md, which loads into every session |
| D4 | **Existing ids are fossils, not vocabulary.** `ZV2-CR-*`, `FR-*`, `ADR-*` numbers stay exactly as they are, including the `ZV2` letters inside change-request ids — an id is a key, and keys are never renamed (AGENTS.md §18). New change requests continue the `ZV2-CR-` sequence for continuity | Renumbering ids to purge three letters would break every plan, annotation and test keyed on them — the exact failure §18 exists to prevent |
| D5 | **The reuse scaffolding is deleted:** `scripts/import-v1-docs.mjs`, the `docs:import-v1` npm script, and `docs/replacement/` (parity inventory, cutover runbook, contract-test plan, identity impact scan, implementation plan, demo runbook). `PHASE-V2-REPLACE` is closed in the roadmap as retired-by-this-ADR | Scaffolding for a cancelled program is not history worth indexing — it is instruction to resume the program, which is precisely the hallucination risk. Git history preserves every byte if it is ever wanted |
| D6 | **Two hard rules survive, restated without the program:** (a) never modify anything under `G:\zuri` — it is a different product's repository; (b) never read `D:\workspace\zuri-command-agent\.env` — it holds LINE OA secrets. The retired rules — preserve-UUIDs-on-migration and one-tenant-one-system — die with the migration they governed | (a) is ordinary respect for someone else's codebase; (b) protects this product's own LINE transport and never depended on the reuse program |
| D7 | The legacy schema (94 models) **may be consulted read-only as prior art** when designing a domain zuri-ai has not built yet — the way one reads any prior system | Prior art is useful; ancestry is not claimed |

## Consequences

- The naming confusion the owner identified as the single worst problem in the
  repository is removed at its root, not patched at its symptoms.
- `docs/` now describes one product in one vocabulary. *Tenant* means what
  zuri-ai's PRD says it means — an isolation boundary in the scope chain — and
  nothing else, anywhere.
- The words "V1" and "V2" surviving inside ADR-001–023, ZV2-CR-001–008 and id
  strings are **historical labels**. The standing interpretation rule lives in
  CLAUDE.md: encountering them in history is not evidence of a live migration
  program, and no work may be derived from them.
- Some historical file names (`ZURI-V2-HANDOFF.md`, `README-zuri-v2-lab.md`,
  `PRODUCT-V2.md`, …) still carry the old label. Renaming them is free — ids,
  not paths, are keys — and is deliberately left to the documentation sweep so
  each rename fixes its inbound links in one reviewable change.
- If a future decision ever wants something from the legacy project, it starts
  from D7 (read its code as prior art) — never from resurrecting ADR-003.

## Review

Revisit only if the legacy project comes back to life as a maintained product
with real users — the one scenario that could make coexistence rules relevant
again. Nothing about zuri-ai's own roadmap requires reopening this.
