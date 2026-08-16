# ADR-025 — Domain-Driven Documentation Architecture for a Multi-Agent Workflow

**Status:** Accepted
**Date:** 2026-08-16
**Decided by:** Boss (owner)
**Relates to:** [ADR-004](ADR-004-DOCUMENTATION-ARCHITECTURE.md) (extends it — the layer model stands, the spine changes), [ADR-024](ADR-024-ZURI-AI-IS-A-STANDALONE-PRODUCT.md) (the product this documents), [ARCHITECTURE-TARGET-MODULAR-MONOLITH.md](../ARCHITECTURE-TARGET-MODULAR-MONOLITH.md) (the domain taxonomy source)
**Supersedes:** nothing — ADR-004's layers survive inside the new spine

## Context

zuri-ai is built by many agents working concurrently — this repository's own
history shows sessions colliding on ids, stepping on each other's branches, and
resurrecting dead plans found in stale documents. The documentation architecture
was organized by *document type* (all ADRs together, all features together, one
flat root), which answers "where do documents of kind X live?" — a librarian's
question. It never answers the question an agent actually asks at the start of
every task: **"what is my lane, and what must I not touch?"**

The owner directed a redesign: multi-agent-suited, choosing between role-based,
domain-based and feature-based organization, with **domain-driven as the spine**
and **a feature-driven view for users**. The
[Modular Monolith architecture spec](../ARCHITECTURE-TARGET-MODULAR-MONOLITH.md)
(imported alongside this ADR, status Draft) supplies the organizing principle:
*the physical store may be shared; the ownership must never be.* Its central
invariant — every operational table has exactly one owning domain, and only the
owner writes — is as true for documents as for tables.

## The three candidates, and why domain wins

| Basis | What it optimizes | Why it fails as the spine here |
|---|---|---|
| **Role-based** (docs for PM / dev / QA / agent) | onboarding per persona | Roles cut across every subject, so every document belongs to several roles at once; the taxonomy rots the day responsibilities shift. Nothing in the codebase is organized by role, so the docs would mirror nothing |
| **Feature-based** (one folder per FR) | user-visible traceability | 57 FRs and growing — features are the *fastest-moving* axis. A feature also routinely touches several modules, so folders either duplicate content or pick arbitrary owners. Features are a **view**, not a home |
| **Domain-based** | ownership and boundaries | Mirrors the module structure (`src/modules/*`), the schema ownership model, and the way work is actually assigned to agents. Domains are the *slowest-moving* axis — the same reason the architecture spec builds on them |

**Decision: domains are the spine; features are a projection.** The
feature-driven view users need already exists as `FEATURE-MAP.md` — generated,
keyed by immutable FR ids, grouped so a user can ask "what can the product do?"
without caring which module answers. This ADR keeps that contract and moves the
underlying notes into their owning domains.

## Decision

| # | Decision |
|---|---|
| D1 | `docs/domains/<domain>/` is the spine. Initial domains mirror `src/modules/`: `project-manager`, `crm`, `identity`, `agent`, `knowledge`. A domain directory is created when the module exists — never speculatively. The architecture spec's future ERP domains (sales, inventory, accounting, procurement, hr, manufacturing) get directories when their modules do |
| D2 | **Every domain has a `CHARTER.md`** — the agent's lane definition. Machine-readable frontmatter declares what the domain owns (Prisma models, route globs, source module) and the body states its boundaries, public contracts, and known shared-write exceptions. An agent assigned to a domain reads one charter and knows its write boundary |
| D3 | **Ownership claims are enforced like ids.** preflight raises a CRITICAL when two charters claim the same model — the same uniqueness guard that protects ADR/CR/FR numbers, applied to the architecture spec's invariant #1. Claims of models that do not exist in the schema are warnings (stale charter). Unowned models are info (coverage debt, not failure) |
| D4 | Feature notes live in `docs/domains/<domain>/features/` and declare `domain:` in frontmatter; preflight checks the declaration matches the folder. A feature has **one** home — a cross-domain feature lives with its primary owner and cites the others, never duplicated (the spec's rule for tables, applied to notes) |
| D5 | **The feature-driven user view is `FEATURE-MAP.md`**, generated, now with a Domain column. Discovery is by frontmatter, not path, so notes keep the promise that moving them never breaks anything |
| D6 | The `ai-system/` docs move into `domains/agent/` — they were always that domain's design docs under a different name |
| D7 | Cross-domain layers stay at the root, one file each, exactly as ADR-004 layered them: `PRODUCT.md` (why/what), `PRD-SDD-v1.0.md` (the immutable requirement registry — ids are global, not per-domain, and never move), `ARCHITECTURE.md` + `ARCHITECTURE-TARGET-MODULAR-MONOLITH.md` (system shape), the UX set under CR-007's boundaries, `decisions/`, `changes/`, `appendices/`, `roadmap/`, `runbooks/`, `prompts/`, `archive/` |
| D8 | The imported architecture spec is adopted **for its domain taxonomy and ownership principle only.** Its runtime decisions (per-domain Postgres schemas `crm.*`/`sales.*`, outbox, module contracts in code) are a separate acceptance with their own ADR when implementation starts — a docs restructure must not smuggle in a database architecture |
| D9 | `roadmap/ROADMAP-zuri-v2-lab.md` → `roadmap/ROADMAP.md` — the owner confirmed GoVibe Mission Control reads the directory artifacts, not that filename |

## What this buys a multi-agent workflow

- **Lane assignment is one pointer.** "Work in `domains/crm/`" hands an agent its
  charter, its feature notes, its boundaries — instead of a repo-wide scavenger
  hunt that this session showed ends in wrong conclusions.
- **Collisions become CI failures, not archaeology.** Two agents claiming one
  model, one id, or one feature now fail preflight with both claimants named —
  the class of incident that previously took a human noticing two ADR-020s.
- **The graph gains the ownership axis.** Domain nodes and feature→domain edges
  make "what is affected if domain X changes" a query instead of a guess.
- **Documents age in place.** A domain's docs retire with the domain; the
  archive pattern from the sweep handles the rest.

## Consequences

- `crm` starts as a charter with no feature notes — correct: the module exists,
  its features simply never needed rationale notes. The charter is not filler;
  it is the lane definition.
- Shared-write exceptions that exist in code today (`Person` is written by both
  crm ingest and identity linking) are **recorded in the charters as debt**, not
  hidden — the charter documents reality and the target, and the gap is visible.
- Preflight gains three checks (charter presence, domain declaration match,
  ownership uniqueness); none require renumbering or moving anything ever again.

## Revision 2 — Feature (FEAT) is a first-class concept (2026-08-16)

**Status:** Accepted · amends D5; adds D10–D11. Owner decision, stated
directly: *"FR = functional requirement, ไม่ใช่ Feature. Feature = FEAT."*

The original D5 treated features as a projection keyed by FR ids. That
conflation is real debt: an FR is a precise system behavior; a feature is a
product capability that may bundle several.

| # | Decision |
|---|---|
| D10 | `FEAT-xxx` is a new id family under the §18 contract (immutable, never reused, duplicate-guarded). The registry is `docs/FEATURES.md` — hand-maintained source of truth; the graph reads it into `feat:` nodes with `bundles` edges to FRs |
| D11 | An FR with no FEAT row is implicitly a feature of one — **rows are added when a capability genuinely spans FRs**, never mechanically for all 57. Existing FR ids and note filenames do not change; the feature axis is additive |

Also in this revision: the graph gains `route:`, `model:` and `domain:` nodes
with ownership edges (closing the trace chain), and two generated human views —
`DOMAIN-MAP.md` and `TRACE.md` — each protected by a blindness assertion in
preflight, per the prevention rule in the 2026-08-16 drift RCA. The charter
node id collision (five files named `CHARTER.md` all mapping to `doc:CHARTER`)
is fixed by making charters `domain:` nodes.

## Review

When the first ERP domain from the architecture spec (sales, inventory, …) gets
a module, its charter is written **before** its first feature lands — the lane
exists before the agent enters it. Revisit D11's restraint if the FEAT registry
grows past roughly a dozen rows — that is the signal features deserve their own
notes, not just registry rows.
