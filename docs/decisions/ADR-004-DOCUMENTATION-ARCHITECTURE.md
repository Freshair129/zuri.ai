# ADR-004 — Documentation Architecture: Product Layer, Feature-Driven Notes, Generated Index

**Status:** Accepted
**Date:** 2026-08-12
**Decided by:** Owen (owner)
**Relates to:** [ADR-003](ADR-003-V2-REPLACES-V1-BY-REUSE.md) (V2 replaces V1), AGENTS.md §16 and §18

## Context

The documentation was scaffolded when this repo was a standalone Project Manager
lab. Two things have since changed the shape of what needs documenting:

1. **ADR-003**: V2 is now the product that replaces V1. The Project Manager is one
   module inside it, not the whole thing — but the PRD still described the PM as if
   it were the product, and there was nowhere to write "what is Zuri V2".
2. **AI-native, LINE-first**: there was no home at all for the intent pipeline,
   prompt rules, PDPA/PII boundary or model lifecycle — and PDPA is no longer
   theoretical (`SEC-004` becomes false the moment LINE lands).

A third gap surfaced while deciding this: features had documentation
(`ENTERPRISE-API-SURFACE.md`, `UX-SINGLE-VS-MULTI-BUSINESS.md`) but no convention —
no fixed location, no link from the feature to its note, and no single place to ask
"what features exist, and where does each one live?".

## Decision

**Add a product layer, formalise feature-driven notes, and generate the index.**

| # | Decision | Rationale |
|---|---|---|
| D1 | `docs/PRODUCT.md` is Layer 0 — what V2 is, its two surfaces, the scope hierarchy, the non-negotiables | The question "what is Zuri V2" had to be answered by reading an ADR |
| D2 | Module PRD/SDD stays one layer down (`zuri-v2-lab/docs/PRD-SDD-v1.0.md`), rescoped as the **Project Manager module** of V2 | Keeps FR-001…FR-020 exactly where they are |
| D3 | Feature notes live in `zuri-v2-lab/docs/features/` and declare their feature in frontmatter (`feature: FR-020`) | The note is linked by **id**, so moving or renaming it never breaks the link (§18) |
| D4 | A note exists only when there is **rationale** to record — alternatives, constraints, why this shape | Not every feature needs a document; an empty template is worse than no file |
| D5 | `zuri-v2-lab/docs/FEATURE-MAP.md` is **generated** by `npm run docs:graph` | A hand-written feature index would be a third place the same facts live, next to the PRD registry and Appendix D — guaranteed drift |
| D6 | The map carries a **source** column (`v2-native` / `lifted-from-v1` / `pending`), so it doubles as the cutover dashboard | ADR-003 needs a per-feature view of what has moved; one table instead of two |
| D7 | `docs/domains/agent/` — intent pipeline, prompt engineering, ethics/PDPA, model lifecycle | LINE-first has no home otherwise, and the PDPA decisions block the LINE work |
| D8 | `docs/replacement/` — parity inventory, cutover runbook, contract tests | ADR-003 §D3/§D6/§D8 mandate these artefacts; they had no files |
| D9 | **No requirement id is renumbered** by this restructure | AGENTS.md §18 — ids are keys, not labels |
| D10 | Cross-cutting changes with migration, compatibility or retirement work live in `docs/changes/ZV2-CR-*.md`; V1 evidence retains the `V1-CR-*` namespace | ADR-016 needs one bounded envelope for effects that span schema, API, UI, backup and filesystem without turning the FR or ADR into a mutable task ledger |

Template basis: the RWANG **AI/ML Project** template (scored 88) — a superset of the
3-Layer + Appendix structure already in use, so nothing is discarded.

## Consequences

- `ENTERPRISE-API-SURFACE.md` → `../domains/project-manager/features/FR-019-enterprise-api.md` and
  `UX-SINGLE-VS-MULTI-BUSINESS.md` → `../domains/project-manager/features/FR-020-adaptive-shell.md`. Every
  reference (PRD, roadmap, risk matrix, three `@spec` annotations) was repointed;
  `docs:preflight` verifies no link was left behind.
- `FEATURE-MAP.md` must never be hand-edited. It is derived from: the PRD registry
  (id + label + declared status), `@req` annotations (code + module), test edges,
  feature-note frontmatter, and roadmap rows (delivery task).
- The four `docs/domains/agent/` files and three `docs/replacement/` files start as
  skeletons carrying the decisions already made and the questions still open. They
  fill up as `PHASE-V2-REPLACE` tasks execute — they are not placeholders to be
  filled for their own sake.
- Doc count rises from 21 to 29. The preflight "missing control block" findings on
  the inherited spec pack stay at INFO: those are authority documents, not
  RWANG-managed ones.
- `docs/changes/` is not a general backlog. A ZV2-CR exists only when one approved
  change crosses document/module boundaries and needs an explicit migration,
  compatibility, deletion or rollback inventory. It supplements—but never replaces—
  immutable FR/ADR ids and generated traceability.

## Review

Revisit when the first V1 module is lifted: if `features/` and `FEATURE-MAP.md` do
not make the cutover state obvious at a glance, the map's columns are wrong and
should be changed then, with the generator — not by hand.
