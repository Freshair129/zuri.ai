# AGENTS.md — zuri-ai

## Mission

Build zuri-ai: an AI-native business operating system. The Project Manager was
its first module; the domain spine (ADR-025) is how the rest grow.

The system must model business execution, not just software delivery.

## Non-negotiable rules

### 1. Do not modify the legacy zuri project

`G:\zuri` (and its remote `Freshair129/zuri`) is a **different product's
repository** — the legacy zuri project, discontinued as far as this product is
concerned ([ADR-024](docs/decisions/ADR-024-ZURI-AI-IS-A-STANDALONE-PRODUCT.md)). Reading it
as prior art is fine. Writing to it never is.

`D:\workspace\zuri-command-agent` is the LINE OA transport this product's LINE
surface talks to. Never read or copy its `.env` (secrets).

> History (kept so old citations resolve): earlier revisions of this section moved
> twice — first "standalone, do not copy" (ADR-001), then "copying is expected,
> the legacy UI will be lifted per module" (ADR-003, 2026-08-12). ADR-024
> (2026-08-16) retired that program with zero modules ever lifted. Any document
> that speaks of lifting, cutover, parity or migration from the legacy project
> describes a dead plan — do not derive work from it.

Do not:
- edit anything under `G:\zuri`
- touch its database
- treat its documents or ids as authority over anything in this repository

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
npm run govern          # graph → check → preflight, in the order the checks require
npm run docs:graph      # rebuild docs/.doc-graph.json + appendices/D-traceability.md
npm run docs:check      # fails when the committed graph is stale
npm run docs:preflight  # doc health → docs/.preflight-report.json; --strict, fails on CRITICAL
```

`npm run verify` is the definition of done in one command (test → build → govern →
e2e). Both test commands are wrapped by `scripts/assert-tests-ran.mjs`, which fails a
run that executed **zero** tests — `vitest run -t "NO_MATCH"` exits 0 with everything
skipped, and an exit code of 0 must never mean the work did not run. `test:e2e`
additionally fails on **flaky**: Playwright exits 0 for a test that passes only on
retry, so a degrading suite reads as green. The retry is kept to label flakiness, not
to hide it.

Viewers in tests come from `tests/factories/viewer.js` (`makeViewer`,
`ownsElsewhere`, `makeDevViewer`), never hand-built. The factory enforces the
resolver's invariants, so the fixture shape that hid three authorization holes cannot
be constructed; a new hand-built one is a preflight CRITICAL against a shrink-only
baseline.

Until 2026-08-17 none of this was enforced: there was no CI, no git hook, and
`docs:preflight` omitted `--strict`, so it printed `CRITICAL` and exited 0. The
rule was a habit, not a gate. `.github/workflows/governance.yml` now runs the
chain, the tests, the build and the full e2e suite on every pull request, and
a route that implements no declared requirement is a CRITICAL against a
shrink-only baseline. Full account:
[RCA](.brain/rca/2026-08-17-governance-did-not-govern.md).

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

A requirement id used in code but not declared in `docs/PRD-SDD-v1.0.md`
is a preflight CRITICAL. Do not chase 100% coverage by adding annotations to files
that do not really enforce the rule — an unanchored rule is information, a false
anchor is a lie.

Build/test commands: `npm test` (Vitest), `npm run test:e2e` (Playwright on :3100),
`npm run build`, `npm run db:seed` / `db:reset`.

### 17. Current direction

`docs/decisions/ADR-024-ZURI-AI-IS-A-STANDALONE-PRODUCT.md` is the binding decision:
**zuri-ai is a standalone product.** It does not replace, version, or migrate the
legacy zuri project; nothing is lifted from it and no cutover will occur. LINE is
the primary AI-native surface and the web app is the back-office console. The
decision chain ADR-001 → ADR-002 → ADR-003 → ADR-024 is preserved as history;
only ADR-024 is in force.

### 18. Order of governance work, and the id contract

When two governance steps touch the same material, **the one that changes the
*meaning* of the other's input runs first**. A step that only changes layout
(moving or renaming files) never invalidates a plan — it only breaks paths, which
`docs:preflight` reports as broken links. A step that changes scope or identity
does invalidate everything downstream.

That is why the order is:

```text
1. doc-architect        restructure so the docs describe the product truthfully
                        (the domain spine, ADR-025, is the current shape)
2. docs:preflight + docs:graph + docs:check
                        seconds; catches broken links, stale views, lane violations
3. implementation-plan  written once, against the corrected structure
4. subagent-driven      execute the plan
```

Planning before restructuring produces a plan shaped by the old scope, which then
has to be rewritten.

**The id contract — requirement ids are keys, not labels.**

`FR-xxx`, `NFR-xxx`, `BR-xxx`, `SEC-xxx`, `SDD-xxx`, `FEAT-xxx` and `ADR-xxx` /
`ZV2-CR-xxx` must keep their meaning for the life of the project. FR is a
*functional requirement* (a precise system behavior); FEAT is a *feature* (a
product capability bundling one or more FRs, registry: `docs/FEATURES.md`) —
different families, same contract (ADR-025 rev 2). Documents may be moved, renamed, split or merged; ids may not
be renumbered, reused for a different statement, or recycled after a requirement is
dropped (mark it superseded and leave the number burnt). Plans, annotations, tests,
the traceability matrix and the doc graph all key off these ids — renumbering
silently detaches every one of them.

The same principle applies one level up: **change the label, never the key** —
UUIDs for data, requirement and feature ids for documents. The duplicate-id
guard in preflight enforces uniqueness across every family, including FEAT rows.

### 19. Documentation architecture (what lives where)

Set by [ADR-004](docs/decisions/ADR-004-DOCUMENTATION-ARCHITECTURE.md). Four layers, and only
one of them is written by hand at feature level:

```text
Spine    docs/domains/<d>/  one folder per domain (ADR-025) — CHARTER.md = the lane; features/ = its notes
Layer 0  docs/PRODUCT.md            what zuri-ai is: surfaces, scope chain, non-negotiables
Layer 1-2  docs/PRD-SDD-v1.0.md   the FR/NFR/BR/SEC/SDD registry — ids are global, never per-domain
Arch     docs/ARCHITECTURE-TARGET-MODULAR-MONOLITH.md  target architecture (Draft; taxonomy adopted by ADR-025)
Registry docs/FEATURES.md           FEAT registry — a feature bundles one or more FRs (ADR-025 rev 2)
Index    docs/FEATURE-MAP.md        GENERATED — the feature-driven user view; never hand-edit
Index    docs/DOMAIN-MAP.md         GENERATED — one section per domain: lane, ownership, contents
Index    docs/TRACE.md              GENERATED — the full chain per FR: surface → code → rules → tests
Appendix docs/appendices/  A api - B db - C model cards - D traceability (generated) - E risks - F glossary
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

**`FEATURE-MAP.md`, `DOMAIN-MAP.md` and `TRACE.md` are derived** (generators in
`scripts/doc-views.mjs` + `scripts/doc-graph.mjs`), from the PRD registry + `@req` annotations + test
edges + feature frontmatter + roadmap rows. Its `source` column is also the cutover
dashboard for ADR-003. Editing it by hand creates a third copy of facts that already
live in two places — exactly the drift the generators exist to prevent.

When adding a new document, decide its layer first. If it does not fit one of the
five slots above, that is a signal the structure needs an ADR, not a stray file.

### 20. The legacy project's documentation (retired)

Retired by [ADR-024](docs/decisions/ADR-024-ZURI-AI-IS-A-STANDALONE-PRODUCT.md). The mirror
(`docs/v1-inherited/`), the import script and the `V1-` citation prefix are gone
with the program they served. Two things remain true:

1. Historical documents in this repository cite legacy ids with a `V1-` prefix
   (`V1-ADR-060`). Those citations resolve to nothing here — they are fossils, and
   that is fine; do not "fix" them.
2. If a design question genuinely benefits from how the legacy project solved it,
   read `G:\zuri` directly, read-only, as prior art (ADR-024 D7) — the same way
   you would read any external codebase.

### 21. Existence claims require enumeration, not search

Before claiming that a document, spec, route, test, or any named artifact does or
does not exist in this repository, **enumerate** — `git ls-files`, a directory
listing, or the doc graph — and reconcile what you find against your working
belief. Semantic or keyword search failing to surface something is never evidence
of absence.

This rule exists because an agent once concluded the repository had no interface
inventory or sitemap while both sat in `docs/`, and the wrong conclusion survived
into its final answer even after tree evidence contradicted it. The two failure
modes it forbids:

1. inferring absence from a search miss instead of an authoritative enumeration;
2. letting an earlier hypothesis survive after newer repository evidence
   contradicts it — the last enumeration wins, not the first guess.
