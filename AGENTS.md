# AGENTS.md — Zuri.Ai v2 Project Manager

## Mission

Implement an offline-first Project Manager that can later become a first-class Zuri
module or the first module of Zuri v2.

The system must model business execution, not just software delivery.

## Non-negotiable rules

### 1. Do not modify current Zuri

The existing `Freshair129/zuri` repository is read-only reference during this build.
The existing `G:\zuri` is the current working Zuri V1 project — **read-only compatibility
reference**. Do not copy it into this repo; `zuri-v2-lab` is built standalone per
ADR-001. Porting V1 modules happens only in a later integration phase
(see `zuri-v2-lab/docs/ZURI-INTEGRATION-ASSESSMENT.md`), decided after MVP dogfooding.
The existing `D:\workspace\zuri-command-agent` is a LINE OA agent — out of MVP scope
(LINE is on the do-not-implement list). Never read or copy its `.env` (secrets).
Revisit merge-vs-rebuild at the integration phase.

> Resolution note (2026-08-11, confirmed by owner): an earlier revision of this
> section both forbade and required copying `G:\zuri`. Standalone build is the
> confirmed interpretation, consistent with MASTER-PROMPT scope and ADR-001.
>
> **Amendment (2026-08-12, ADR-003):** the destination changed — V2 now replaces V1
> by reusing it. **Copying V1 → V2 is permitted and expected** (web UI except
> auth/identity, lifted per module at that module's cutover). Everything below still
> holds: `G:\zuri` itself is never edited, its database is never mutated, and its
> auth is never changed. The rule is one-directional reuse, not shared ownership.

Do not:
- edit it
- migrate its production database
- change its auth
- change its Tenant semantics in place

### 2. New root hierarchy

Canonical hierarchy:

```text
Portfolio / Business Group
  ↓
Tenant
  ↓
Business
  ↓
Workspace
  ↓
Project
  ↓
Workstream
```

Supporting entities:

```text
LegalEntity
Branch
Product
Person
Membership
Repository
Milestone
Gate
Dependency
WorkContainer
WorkItem
Metric
Artifact
AuditEvent
```

### 3. Tenant is isolation, not branch

Never model a branch as a Tenant.

```text
tenant_id   = security/data isolation boundary
business_id = operating business
branch_id   = branch/location
```

### 4. External IDs are not primary keys

Tax ID, DBD number, GitHub repo ID, LINE user ID, etc. are external identifiers.

Use internal UUID primary keys plus human-readable codes.

### 5. No template picker

Do not start Project creation with:

```text
Choose Software / Sales / Marketing template
```

Instead:
- user/agent creates objective
- planning agent decomposes Workstreams
- every Workstream has `executionMode`
- UI activates the correct view automatically

Manual mode override may exist in Settings/Advanced, not as the primary creation flow.

### 6. Only seven canonical execution modes in v1

```text
SOFTWARE_SPRINT
DATA_MIGRATION
B2B_SALES
B2C_CAMPAIGN
PRODUCT_LAUNCH
OPERATIONS
BUSINESS_EXPANSION
```

Do not invent new canonical modes.

### 7. Universal core, domain views

The seven execution views must use one neutral core data model.

Do not create seven unrelated mini-applications.

### 8. Progress is strategy-based

Never use `tasks_done / tasks_total` as universal project progress.

Each Workstream has:
- executionMode
- progressStrategy
- progressWeight
- progress evidence

Project roll-up is weighted.

### 9. Offline-first, sync-ready

MVP uses local SQLite only.

All domain services must go through repository interfaces so a future Postgres adapter
can replace local persistence.

Persist:
- `createdAt`
- `updatedAt`
- `deletedAt` when applicable
- `version`

Maintain an immutable AuditEvent stream for meaningful state changes.

Do not implement network sync in MVP.

### 10. Zuri Heritage UI

Use Zuri design tokens.

Primary:
```text
#E8820C Amber Citrus
#F09420 Brand Hover
#B86A08 Brand Dark
#FDE8D0 Brand Tint
#FFF8F0 Brand Surface
#F7F8FA App Surface
#FFFFFF Card
#EFF1F3 Mid Surface
#D6ECFA Rest Blue
#3D7A9E Rest Blue Text
#C6A052 Mustard
```

Navigation glass:
```text
rgba(31, 41, 55, 0.98)
```

Font stack:
```text
IBM Plex Sans Thai, Manrope, sans-serif
```

Use `lucide-react` icons.

### 11. UI architecture

Universal views:
```text
Overview
All Work
Timeline
Dependencies
Milestones & Gates
Calendar
Table
```

Execution views:
```text
Sprint
Migration
B2B Sales
B2C Campaign
Product Launch
Operations
Business Expansion
```

Context selectors:
```text
Portfolio
Business
Workspace
Project
```

### 12. Agent plan import

The application must accept a structured plan generated outside the app.

Contract:
```text
contracts/plan-envelope.schema.json
```

Import flow:
```text
Agent JSON
  ↓
Zod/JSON Schema validation
  ↓
dry-run preview
  ↓
conflict check
  ↓
transactional import
  ↓
AuditEvent
```

Never execute arbitrary code from imported plans.

### 13. Repository tracking is local metadata in MVP

Repository records may store:
- provider
- external repository id
- owner/name
- URL
- default branch
- project role
- optional path scope

Do not require GitHub API access.

### 14. Testing is part of implementation

Every phase ends only after:
- tests pass
- build passes
- no TypeScript/ESLint blocking errors
- agent writes phase report

### 15. Do not fake completion

Mock/seed data is allowed for demos.

Core CRUD, persistence, progress calculation, filtering, plan import, and at least one
working view for each of the seven execution modes must be functional.

### 16. Use the governance tooling, do not hand-maintain it

The document graph and the preflight report are **generated**, never edited by hand:

```bash
npm run docs:graph      # rebuild docs/.doc-graph.json + appendices/D-traceability.md
npm run docs:check      # CI guard: fails when the committed graph is stale
npm run docs:preflight  # doc health → docs/.preflight-report.json
```

Run both after any change that adds a route, a Prisma model, a requirement or a
document. They are the reason drift gets caught: the graph is built from the
`@req` / `@spec` / `@tested` annotations in the source, and preflight compares the
appendices against the real routes and models.

Annotate every non-trivial file:

```js
// @req FR-020 — the user-visible requirement this file delivers
// @spec BR-004, SDD-002 — the rule or design decision it enforces
// @tested tests/unit/shell-mode.test.js — where the proof lives
```

A requirement id used in code but not declared in `zuri-v2-lab/docs/PRD-SDD-v1.0.md`
is a preflight CRITICAL. Do not chase 100% coverage by adding annotations to files
that do not really enforce the rule — an unanchored rule is information, a false
anchor is a lie.

Build/test commands: `npm test` (Vitest), `npm run test:e2e` (Playwright on :3100),
`npm run build`, `npm run db:seed` / `db:reset`.

### 17. Current integration direction

`docs/ADR-003-V2-REPLACES-V1-BY-REUSE.md` is the binding decision (it supersedes
ADR-002 in full and amends §1 above): **V2 replaces V1 by reusing it** — the web UI
is lifted per module at cutover, everything except auth/identity; LINE is the
primary AI-native surface and the web becomes the back-office console. ADR-001's
standalone-build rationale still explains how this repo got here, but "do not copy
`G:\zuri`" no longer applies in the V1 → V2 direction.

### 18. Order of governance work, and the id contract

When two governance steps touch the same material, **the one that changes the
*meaning* of the other's input runs first**. A step that only changes layout
(moving or renaming files) never invalidates a plan — it only breaks paths, which
`docs:preflight` reports as broken links. A step that changes scope or identity
does invalidate everything downstream.

That is why the order is:

```text
1. doc-architect        restructure so the docs describe V2 as the product that
                        replaces V1 (Project Manager becomes one module inside it,
                        with room for the V1 domains being lifted in)
2. docs:graph + docs:preflight
                        seconds; catches the links and appendices the restructure
                        moved out from under
3. implementation-plan  written once, against the corrected structure
4. subagent-driven      execute the plan
```

Planning before restructuring produces a plan shaped by the old scope, which then
has to be rewritten — the restructure pending right now is a scope change (PM lab
→ V2 product), not a cosmetic one.

**The id contract — requirement ids are keys, not labels.**

`FR-xxx`, `NFR-xxx`, `BR-xxx`, `SEC-xxx`, `SDD-xxx` must keep their meaning for the
life of the project. Documents may be moved, renamed, split or merged; ids may not
be renumbered, reused for a different statement, or recycled after a requirement is
dropped (mark it superseded and leave the number burnt). Plans, annotations, tests,
the traceability matrix and the doc graph all key off these ids — renumbering
silently detaches every one of them.

Same principle as ADR-003 §D4 applies one level up: **change the label, never the
key** — UUIDs for data, requirement ids for documents.

### 19. Documentation architecture (what lives where)

Set by [ADR-004](docs/ADR-004-DOCUMENTATION-ARCHITECTURE.md). Four layers, and only
one of them is written by hand at feature level:

```text
Layer 0  docs/PRODUCT-V2.md            what Zuri V2 is: surfaces, scope chain, non-negotiables
Layer 1-2  zuri-v2-lab/docs/PRD-SDD-v1.0.md   the Project Manager MODULE (FR/NFR/BR/SEC/SDD registry)
Layer 3  docs/ai-system/               intent pipeline · prompts · PDPA/ethics · model lifecycle
         docs/replacement/             parity inventory · cutover runbook · contract tests
Feature  zuri-v2-lab/docs/features/    one note per feature that has rationale worth recording
Index    zuri-v2-lab/docs/FEATURE-MAP.md        GENERATED — never hand-edit
Appendix zuri-v2-lab/docs/appendices/  A api · B db · C model cards · D traceability (generated) · E risks · F glossary
```

**Feature notes** carry frontmatter so the generator can link them by id, not path:

```yaml
---
feature: FR-020
module: project-manager
source: v2-native        # or lifted-from-v1 / pending
---
```

Write a feature note **only when there is rationale**: alternatives considered,
constraints, why this shape. A feature with no interesting decisions needs no file —
it already appears in `FEATURE-MAP.md` with its code, tests and task.

**`FEATURE-MAP.md` is derived**, from the PRD registry + `@req` annotations + test
edges + feature frontmatter + roadmap rows. Its `source` column is also the cutover
dashboard for ADR-003. Editing it by hand creates a third copy of facts that already
live in two places — exactly the drift the generators exist to prevent.

When adding a new document, decide its layer first. If it does not fit one of the
five slots above, that is a signal the structure needs an ADR, not a stray file.

### 20. V1's inherited documentation

[ADR-005](docs/ADR-005-V1-DOCUMENTATION-CORPUS.md). `docs/v1-inherited/` is a
**read-only mirror** of V1's product documentation (234 files, imported by
`npm run docs:import-v1`, provenance in `MANIFEST.json`).

1. **Never edit anything in it.** It is evidence of what V1 says. Corrections go in
   a V2 document that cites the inherited file.
2. **It describes V1 semantics** — "tenant" there means *one shop*. Every file
   carries a banner saying so.
3. **Two id namespaces coexist.** V2 owns `FR/NFR/BR/SEC/SDD` and `ADR-00x`; V1's
   ids are cited with a `V1-` prefix (`V1-ADR-060`, `V1-FEAT-21`, `V1-CR-007`)
   because V1's ADR series runs 057…086 and would otherwise collide with ours.
   Filenames keep their original form so comments inside lifted V1 code resolve.
4. **It is evidence, not authority.** A V2 document wins on disagreement; V1's code
   wins over V1's docs.
5. **Re-sync before each module cutover** — V1 moves ~213 commits/90 days. Drift is
   visible as `MANIFEST.json → sourceCommit`.
6. Mapping V1 ids → V2 requirement ids happens **per feature at lift time** in
   `docs/replacement/PARITY-INVENTORY.md`, never as an upfront exercise.

Feature notes for lifted features record **only the delta** — what changed in the
lift (scope model, auth, endpoints) — and cite the inherited document for the rest.
That is the point of importing: no blank page per feature.
