---
status: active
superseded_by: null
---

## Current coding-delivery policy — Git review and repository CI (2026-10-22)

[ADR-113](docs/decisions/ADR-113-RETIRE-DEVELOPER-DELIVERY-CONTROL.md) retires
the developer-only Developer Delivery Control (DDC), including its task
preflight, controller, supervisor, worker-observation pipeline, and dedicated
operator surfaces. Do not create or require DDC task records, `delivery:*`
commands, controller receipts, or DDC admissions. Historical DDC files and
receipts are provenance only.

For ordinary code and document work:

1. Read the applicable repository instructions, product/architecture sources,
   and current Git state before editing. Use a branch or an existing isolated
   worktree when the change needs isolation; preserve unrelated user changes.
2. Derive scope and acceptance from the user's task and applicable source
   documents. Keep implementation and review within that scope.
3. Run the checks required by
   [VERIFICATION-POLICY.md](docs/architecture/VERIFICATION-POLICY.md) for the
   changed behavior. Document changes use the canonical registry and
   `npm run govern` as applicable; they are not exempt from validation.
4. Substantive changes receive independent review against the same patch.
   Worker, verifier, and reviewer sessions use GPT-6 Luna Max when those roles
   are delegated. The integrator resolves conflicts and runs shared generators
   serially.
5. Use the repository's existing pull-request review, exact-head GitHub CI,
   merge, and release controls. Do not claim an unrun check passed. Production,
   destructive, and security-sensitive actions still require their
   environment-specific authority and evidence.

There is no replacement task ledger or local admission controller. Business
Project Manager workflows, product approval and admission, document governance,
verification selection, and standard repository CI remain separate systems.

# AGENTS.md — zuri-ai

## Documentation reintegration branch (2026-09-29)

Read [the approved migration profile](docs/migrations/document-reintegration/GOVERNANCE-PROFILE.md)
before changing a registry or document reader. Individual ZAI records in
`docs/features/FEAT-*/feature.md`, their explicitly bundled `requirements/`, and
`docs/requirements/` generate `registry/document-registry/index.json` and the
existing PRD/FEATURES compatibility paths.
Run `npm run docs:registry` after an explanatory canonical edit, then
`npm run docs:graph` and `npm run docs:views`. `govern` checks exports and views
without repairing them. Initial source rows, issued IDs and subject anchors
remain pinned. New/changed behavior needs a reviewed record migration. The owner
approved the P6 canonical documentation-writer cutover for this integration; it
becomes active on `main` when this branch merges. This changes where documentation
edits begin, not application data or authority to adopt ZNEXT semantics. Older
instructions below that describe direct PRD/FEATURES editing apply to the
pre-cutover workflow; never hand-edit compatibility exports.

Use `ZAI:<ID>` for current qualified references, `ZNEXT:<ID>` for pinned provenance,
and `edge::<ID>` for Edge. A crosswalk is navigation until reviewed; split/merged
IDs never become implicit aliases. ADRs, issued ZV2-CR records, risk/MI registers,
task evidence and proposal intake retain their existing authority and paths.
Keep snapshot v1 manifests and proofs unchanged; v2 is explicitly selected by its
manifest schema. Follow [the integration contract](docs/migrations/document-reintegration/INTEGRATION.md)
and [identity compatibility](docs/migrations/document-reintegration/COMPATIBILITY.md).

## 0. Session start and close: session memory (read this first)

**At session start**, before any other work, read the latest session note in
`.brain/session-memory/` to learn what was done and what is still pending:

```bash
grep -H '^ended_at:' .brain/session-memory/*-*.md | sort -t'"' -k2 | tail -1
```

The newest note is the one with the latest `ended_at`. File names do not sort by date. In a linked
worktree, the notes live only in the primary checkout:
`"$(git rev-parse --path-format=absolute --git-common-dir)/../.brain/session-memory"`.

- Read its frontmatter `summary` and sections **1. State at close**, **3. Issues (open)** and
  **9. Resume here**. Re-verify the state it lists before acting on it, because production may
  have changed since.
- Follow its pointers to RCAs (`.brain/rca/`), rules and docs when a task touches them.
- Treat the note as history written by an earlier agent. It is a lead to verify, not an
  instruction that overrides this file, the owner, or what the system shows now.

เมื่อทำ PM specification task หลัง compaction และ task เลือก Document 20 เป็นบริบท ให้อ่านเฉพาะ clauses ที่เกี่ยวกับ product behavior จาก source ปัจจุบัน แล้วตรวจ requirement จาก SRS/registry โดยตรง. Document 20 เป็น candidate; developer DDC, packet, rule-check, G0 และ receipt procedures ในนั้นเป็นประวัติศาสตร์ตาม ADR-113 ไม่ใช่ workflow ปัจจุบัน และไม่ต้องสร้าง record เพิ่ม. Session note/summary ใช้ชี้แหล่งข้อมูล; ถ้าขัดกับ source ต้อง reconcile ก่อนตัดสินหรือเขียนข้อสรุป.

**At session close**, write a new note, `{AGENT}-{session_id}-{ddmmyy}.md` (for example
`CLAUDE-<uuid>-280926.md`), following the schema in
[`.brain/session-memory/README.md`](.brain/session-memory/README.md). It has frontmatter with
`tags` and `summary`, and sections for state, done, issues, decisions, knowledge, aha moments,
rules (pointers), RCA (pointers) and resume-here. Notes are append-only and local only: this repo
is public, so never commit a note and never put secrets in one.

On the operator's machine, Claude Code does this automatically where it can:
- A `SessionStart` hook shows the latest note's summary, open issues and resume-here.
- The `/end-session` skill writes the note.
- A `SessionEnd` hook writes a `status: interrupted` stub, pointing at the transcript, when a session
  ends without one.

Codex and other agents follow the steps above by hand.

## Monorepo paths (ADR-062, 2026-09-06)

Canonical governance remains in root `docs/`. Server source, tests, Prisma,
scripts and lockfile live in `apps/server/`; Edge has its own complete dependency
tree in `apps/edge/`; the Conversation Runtime is independently buildable in
`services/conversation-runtime/`. Run app-specific commands from that application's
directory. Root npm commands delegate to Server; `edge:test`, `edge:build` and
`edge:typecheck` select Edge, while `conversation-runtime:test` and
`conversation-runtime:build` select the independent Node service. Root
`npm run govern` regenerates and validates both document graph scopes and discovers
the service's source/tests. Install each app independently (`npm --prefix
apps/server ci` and `npm --prefix apps/edge ci`); the service has no third-party
runtime dependencies and its package lock is scoped to its directory. Server
installation does not install Edge dependencies. Cross-app contract tests
additionally need the Edge consumer dependencies.

Historical `src/`, `tests/`, `prisma/` and `scripts/` references below are
Server-relative; canonical IDs and subject anchors are unchanged. Edge historical
IDs are qualified as `edge::...` only in the combined graph. Read
[snapshot execution](docs/migrations/monorepo/EXECUTION.md) for exact provenance,
held files and release limits. Original device configuration/data are untouched.

### Service documentation and scoped verification (2026-10-06)

Read [the verification policy](docs/architecture/VERIFICATION-POLICY.md) and the
relevant [service documents](docs/services/README.md) before choosing validation.
Domain charters own business rules; service documents own execution and contract
explanations. Package scripts own commands. Canonical FR/FEAT records retain their
identities and membership; do not duplicate them inside service folders.

The owner-approved Runtime pilot produces shadow plans only. Existing CI job
selection, main full Server checks and scheduled/manual E2E remain active.
`npm run verification:plan -- --base <commit>` includes local working changes;
its report never grants permission to omit checks. `npm run docs:services`
regenerates the service map, an ignored view under ADR-081.


### Primary-checkout development Docker and database boundary (ADR-112, 2026-10-20)

The primary-checkout development preview runs in its own named Docker Compose
project with a local PostgreSQL database and volume. The current instance is
`zuri-main-dev-20261020` (`zuri_main_dev`) with the web container bound to
`127.0.0.1:3100`; these are instance identifiers, not portable defaults.
Read the [Docker + ngrok runbook](docs/deployment/docker-ngrok.md) and
[ADR-112](docs/decisions/ADR-112-PRIMARY-CHECKOUT-DEV-DOCKER-AND-DATABASE-ISOLATION.md)
before changing the deployment target.

Keep primary-checkout dev, Knowledge Studio, and each UAT stack isolated from
one another by Compose project, database, volume, and environment configuration.
Keep production database and runtime credentials separate from development and
UAT; its data boundary remains governed by ADR-018. Never point a dev
`DATABASE_URL` at UAT or production, and never promote work by repointing the
dev container. Release a tested app artifact in a separate production runtime
with production-specific configuration; run only approved migrations through
the release gates in ADR-018, ADR-058 and ADR-104.

An active ngrok tunnel makes the dev app reachable from the internet even when
the container port binds to loopback. Use dev-only accounts and appropriate test
data. Never put passwords, tokens, or generated environment values in tracked
files. Signup creates a profile and credential without business scope,
membership, capability, or platform authority.

## Mission

Build zuri-ai: an AI-native business operating system. The Project Manager was
its first module; the domain spine (ADR-025) is how the rest grow.

The system must model business execution, not just software delivery.

## Non-negotiable rules

### 1. Do not modify the legacy zuri project

`Freshair129/zuri` — the repository, whichever machine holds it — is a **different
product's** repository: the legacy zuri project, discontinued as far as this product is
concerned ([ADR-024](docs/decisions/ADR-024-ZURI-AI-IS-A-STANDALONE-PRODUCT.md)). Reading it
as prior art is fine. Writing to it never is.

`Freshair129/zuri-edge-device` is the historical on-premise runtime named by
ADR-041; ADR-110 retires its worker connection to this product. **Never read or
copy its `.env`** — it holds local credentials and pairing keys. On the current machine that checkout is
`C:\Users\pc\workspace\zuri-edge-device`; it was documented as
`D:\workspace\zuri-edge-device` until 2026-09-04, and that path no longer exists.
The rule follows the repository, not the drive letter — a secret does not stop being one
because somebody moved the checkout.

> History (kept so old citations resolve): earlier revisions of this section moved
> twice — first "standalone, do not copy" (ADR-001), then "copying is expected,
> the legacy UI will be lifted per module" (ADR-003, 2026-08-12). ADR-024
> (2026-08-16) retired that program with zero modules ever lifted. Any document
> that speaks of lifting, cutover, parity or migration from the legacy project
> describes a dead plan — do not derive work from it.

Do not:
- edit anything in that repository, wherever it is checked out
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

### 14. Verification follows the scoped policy

Choose acceptance checks from the [verification policy](docs/architecture/VERIFICATION-POLICY.md)
for the changed behavior and environment. Behavior changes run their relevant
tests, build and applicable type/lint checks. Documentation-only changes run the
required governance, reader and contract checks; a new worktree alone does not
require the full application suite. Required hosted CI remains in force, and an
unrun required check is never PASS. Record actual commands, revisions, results
and remaining gaps in the PR or task summary. Do not create DDC task packets,
readiness records, or replacement receipts.

### 15. Do not fake completion

Mock/seed data is allowed for demos.

Core CRUD, persistence, progress calculation, filtering, plan import, and at least one
working view for each of the seven execution modes must be functional.

### 16. Use the governance tooling, do not hand-maintain it

For document metadata, follow [Document link metadata](docs/GOVERNANCE-LINK-METADATA.md)
and copy the ADR, FR or FR-phase template from `docs/templates/`. Use stable
namespace-qualified IDs and typed `relations`; matching legacy control lines may
coexist. `docs/DOCUMENT-LINKS.md` is generated crosslink/backlink navigation, never
a source to edit. `docs:check` checks this view too; metadata conflicts and missing
explicit targets fail graph generation and strict preflight.

The document graph and the preflight report are **generated**, never edited by hand:

```bash
npm run govern          # graph → check → preflight, in the order the checks require
npm run docs:graph      # rebuild docs/.doc-graph.json + appendices/D-traceability.md
npm run docs:check      # fails when the committed graph is stale
npm run docs:preflight  # doc health → docs/.preflight-report.json; --strict, fails on CRITICAL
npm run docs:llms       # rebuild the local llms-full.txt corpus for inspection
```

`llms-full.txt` is the one-file corpus for LLM readers, generated by
`scripts/build-llms-full.mjs`; `llms.txt` is its hand-written index. Under
[ADR-081](docs/decisions/ADR-081-GENERATED-VIEWS-ARE-BUILT-NOT-COMMITTED.md),
the full corpus is built for local inspection or uploaded as a CI artifact and
is not committed. Regenerate it when useful after editing its source documents;
do not add the generated corpus to a change. `llms.txt` remains the committed,
hand-maintained entry point.

`npm run verify` retains the broad local profile: Runtime tests/build, then Server
govern → test → build → e2e. It does not include MI/SCM service verification.
Use the approved [verification policy](docs/architecture/VERIFICATION-POLICY.md)
to choose a change-appropriate baseline and acceptance checks, and state their
scope. This control-plane pilot requires planner/selector regressions, Runtime
tests/build, Core contracts and governance; it does not require a blanket local
application suite merely because a worktree is new. Server test commands are
wrapped by `scripts/assert-tests-ran.mjs`, which fails a
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
rule was a habit, not a gate. `.github/workflows/governance.yml` runs governance
and selects PR Server checks from the diff, retaining related/full fallbacks;
all three service jobs run on non-scheduled events. Main pushes run full Server
tests/build. E2E runs on schedule or workflow_dispatch. A route that implements
no declared requirement is a CRITICAL against a
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

Build/test commands: `npm test` (Vitest), `npm run test:e2e` (Playwright on :3100
in the primary checkout; a git worktree derives its own port and its own seeded
database from its path, so two trees can run e2e at once — `E2E_PORT` pins it),
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

**How it is enforced** ([ADR-039](docs/decisions/ADR-039-REQUIREMENT-IDS-ARE-PINNED-BY-SUBJECT-ANCHOR.md),
preflight Check 12). The duplicate-id guard answers "do two documents claim this
id right now", and a *moved* id is never a duplicate at any single moment — which
is how `SDD-049` was repurposed on 2026-08-20 and `FR-051`/`SDD-026` on
2026-08-15 with every check green. So `docs/.id-ledger.json` additionally pins
each declared id's **subject**: the leading phrase of its statement. Check 12 is
CRITICAL when a pinned subject moves, when a new id inherits a subject already
recorded in its family, when a pinned id vanishes from its registry, when an
entry that was once pinned is no longer in the ledger, or when a burnt number is
re-declared.

What that costs you, in practice:

| you did this | what it costs |
|---|---|
| declared a new id | `npm run docs:ids -- --write` — one `+` block, no ceremony |
| reworded a statement past its leading phrase | nothing; the ledger stores no statements |
| reworded the leading phrase itself, same subject | `--reword <ID> --reason "<sentence>"` |
| moved or renamed a registry document | nothing — §18 says so, and the check follows the file |
| retired a statement | strike it through, say why in the status cell, `--supersede <ID> --reason "…"`, and take the next free number |
| collided with an id main already published | your branch renumbers itself: `--abandon <ID> --to <NEW-ID> --reason "…"` |
| wrote a new id whose statement opens like a sibling's | `--distinct <ID> --reason "<sentence>"` |
| decided a number really must mean something else | `--declare <ID> --reason "<sentence>" --declared-in <doc>#<version>`, and the revision row has to name the id |

`npm run docs:ids` is never part of `govern`: a writer inside the gate is a gate
that silences itself. And nothing in the ledger is ever hand-edited to make a
build green — an entry never leaves it, so a deleted line is the alarm.

### 19. Documentation architecture (what lives where)

Follow [ADR-025](docs/decisions/ADR-025-DOMAIN-DRIVEN-DOCS-ARCHITECTURE.md)
(revision 4) and the [canonical record format](docs/migrations/document-reintegration/CANONICAL-FORMAT.md).
They define separate axes for business ownership, canonical records, service
execution and generated navigation. When older documentation conflicts, follow
the canonical-record cutover in ADR-025 revision 4 and the current reintegration
contract; PRD/FEATURES are not hand-maintained registries.

```text
Domain ownership   docs/domains/<d>/CHARTER.md — the domain boundary and ownership spine
Product scope      docs/PRODUCT.md — product purpose, surfaces and non-negotiables
Canonical FEAT     docs/features/FEAT-nnn/feature.md — one source record per feature
Canonical FR       docs/features/FEAT-nnn/requirements/FR-nnn.md only when that FR has explicit FEAT membership
Standalone/global  docs/requirements/<ID>.md — unbundled FR and NFR/BR/SEC/SDD records
Record index       registry/document-registry/index.json — GENERATED locator for canonical records
Compatibility      docs/PRD-SDD-v1.0.md and docs/FEATURES.md — GENERATED exports; never edit by hand
Architecture       docs/ARCHITECTURE-TARGET-MODULAR-MONOLITH.md — target architecture and adopted taxonomy
Service execution  docs/services/<project>/SERVICE.md and TESTING.md — execution boundaries and verification rationale
Domain rationale  docs/domains/<d>/features/ — optional notes for rationale or audience context
Generated views    docs/FEATURE-MAP.md, docs/DOMAIN-MAP.md, docs/TRACE.md and feature design/verification views — navigation and traceability
Appendices         docs/appendices/ — API, database, model cards, traceability, risks and glossary
```

Canonical record paths locate records; stable ZAI IDs identify them, and explicit
registry membership determines FEAT-to-FR membership. A directory or filename does not assign domain ownership
or create membership. The document registry index locates canonical records; it is
generated and is not an alternate source for their statements. Domain charters own
business boundaries, while service documents explain execution and testing across
those boundaries.

Write a domain feature note only when it adds rationale or audience-specific
context. Link the exact canonical IDs and revision it explains; do not duplicate
requirement statements, identities, lifecycle, membership or implementation status.
For features without additional rationale, use the canonical record and generated
views. Follow the canonical format and typed-relations contract for current
records; do not reuse the older `feature: FR-020` / `module` / `source` example
as canonical record metadata.

**`FEATURE-MAP.md`, `DOMAIN-MAP.md`, `TRACE.md` and the per-feature design and
verification pages are generated views.** `npm run docs:graph` builds the graph,
maps and trace views from repository documents and source annotations.
`npm run docs:views` builds feature and category views from the canonical registry
and graph. They are navigation and traceability, not separate requirement authorities.
Editing them by hand creates another copy of facts that already have canonical
sources.

Use the [documentation requirements specification](docs/governance/DOCUMENTATION-REQUIREMENTS-SPEC.md)
as a proposed guide to document profiles and sections. It cannot override
accepted ADRs or canonical record authority.

Before asserting that a document exists or is absent, or before creating,
replacing, moving, or deleting one, enumerate the affected filesystem scope.
Compare git ls-files docs with rg --files --hidden --no-ignore docs, inspect the
target directory with Get-ChildItem -Force -Recurse, and use git status --short
--ignored to distinguish tracked, modified, untracked, and ignored files. Read
the exact existing file and its diff before replacement. README files, the
canonical-ID registry, and generated graph are not complete filesystem
inventories. An unlisted file is unclassified until reviewed; absence from an
index is never deletion authorization.

The [root-file register](docs/governance/ROOT-FILE-REGISTER.md) and
[directory register](docs/governance/DOCS-DIRECTORY-REGISTER.md) are checked
inventories of tracked direct children of `docs/` at their recorded revision.
They are not approval lists and do not include ignored or untracked files;
refresh the filesystem enumeration before relying on them for a later change.

When adding a document, identify its authority and audience first. If the document
would establish a new source of requirement, membership or ownership authority,
update the applicable canonical contract through its reviewed workflow instead of
creating a parallel registry.

**Then run `npm run govern` and inspect its output.** Creating or editing an
ADR, canonical record, domain feature note or other graph input changes the graph;
generated views do not update themselves. PRD/FEATURES are compatibility exports,
so change their canonical record source and regenerate them. Per
[ADR-081](docs/decisions/ADR-081-GENERATED-VIEWS-ARE-BUILT-NOT-COMMITTED.md),
the graph, maps, reports and `llms-full.txt` are build/ignored outputs: use them
for local inspection or retain them as CI artifacts, but never stage them.
Stage only tracked files required by the change; never stage ignored generated
graph, map, report or corpus output. A document that exists on disk but not in
the generated graph is a preflight CRITICAL (`FEATURE-MAP is blind to N feature
note(s)`), and required CI checks generated-output freshness.

This instruction lives here, in the section you are reading while you write the
document. It was added on 2026-08-17 after two sessions created feature notes
without regenerating: the rule existed, but not where the author was standing.
ADR-081 now defines generated maps and corpus as built, ignored output, so
regeneration is required for inspection and validation while staging remains
limited to tracked required files.

**One exception, and it is about people, not tooling:** when another session is
holding the graph, do not run it concurrently. Two `govern` runs over one tree
interleave, and the first one to finish commits a graph describing files the other
has not committed yet. Say what you changed and let the graph-owning session
reconcile in a single pass.

For parallel branches sharing PRD, FEATURES, ROADMAP or the ID ledger, one
integrator reconciles the authoritative rows and versions first. Regenerate
derived outputs from that composed tree; do not concatenate conflicted generated
JSON or treat generated files as independent source edits. The ID ledger still
uses its sanctioned writer. Then run the full governance chain before tests
that consume generated state, preserving CI's generated-output freshness checks.
Any generated snapshots tracked by the repository must be deterministic for
identical source inputs; run timestamps belong in ignored diagnostic output or
CI logs. Never stage ignored graph, map, report or corpus output.

**Second exception, and it is about scope, not tooling:** a `DOMAIN_GROUPS`
entry in `apps/server/src/config/domains.js` (SCM, CRM, and whatever groups
the domain bar next) owns no model, no route and no module, so ADR-069 D5
deliberately gives it no `docs/domains/<d>/CHARTER.md` — there is no
`src/modules/<d>` for a charter to bind to. Working on this kind of
domain-bar grouping, or anything the owner describes as organising the top
nav bar "ตามหลัก ERP"? Read [`.claude/AGENTS.md`](.claude/AGENTS.md) first —
it holds the pattern, the ADR-069/071 precedent, the judgment call for
grouping two domains versus leaving them standalone, and the governance
sequence specific to this task shape, none of which belongs in `docs/` for
the same reason the group itself does not.

**Visual Office / Zuri platform integration:** when changing Visual Office's
place in Zuri's domain, client, authentication, API, or persistence boundaries,
read the [approved client architecture direction](docs/architecture/2026-10-22-visual-office-zuri-client-design.md)
and the [candidate implementation elaboration](docs/plans/PLAN-VISUAL-OFFICE-2-5D.md).
The design approves only an optional separately deployed frontend client;
Zuri-owned auth/API/resource contracts remain prerequisites for platform-backed
implementation. The plans do not establish routes, schemas, permissions or
service ownership.

### 20. The legacy project's documentation (retired)

Retired by [ADR-024](docs/decisions/ADR-024-ZURI-AI-IS-A-STANDALONE-PRODUCT.md). The mirror
(`docs/v1-inherited/`), the import script and the `V1-` citation prefix are gone
with the program they served. Two things remain true:

1. Historical documents in this repository cite legacy ids with a `V1-` prefix
   (`V1-ADR-060`). Those citations resolve to nothing here — they are fossils, and
   that is fine; do not "fix" them.
2. If a design question genuinely benefits from how the legacy project solved it,
   read that repository directly, read-only, as prior art (ADR-024 D7) — the same way
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

**The same rule applies to "nobody is using this" before you delete something
shared.** A resource another session can be inside — a worktree, a container, a
volume, a `.vhdx` — is never proven idle by its tidiness. Merge status, a clean
`git status` and an empty junction list all describe *stored* state; deletion
safety is a claim about the *present*, and only the process table can answer it
(`Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*<path>*' }`
— **minus the probe's own ancestry**, or it always finds itself; CLAUDE.md
carries the corrected form, and its result is a floor rather than a total,
because a process that entered the directory earlier no longer names it).
On 2026-09-06 all three static checks passed on a worktree that nine live
processes were working in, and the morning's other deletion took a live Docker
data disk on the strength of a registry that lists OS disks only. Both were the
failure mode above — absence of a signal read as absence of a user — applied to
resources instead of documents. Prefer asking the other session over inferring;
where an equivalent enumeration does not exist, say the claim is unverified
rather than asserting it
([RCA](.brain/rca/2026-09-06-deleted-two-resources-that-were-in-use.md)).

### 22. Knowledge & Retrieval Architecture: Four-Tier Cognitive Stack

The four-tier model originated in [ADR-041](docs/decisions/ADR-041-ZURI-EDGE-DEVICE-TOPOLOGY.md), [ADR-042](docs/decisions/ADR-042-DECOUPLED-STANDALONE-KNOWLEDGE-AND-GRAPHRAG-SERVICE.md), [ADR-043](docs/decisions/ADR-043-FOUR-TIER-COGNITIVE-ARCHITECTURE.md), and [ADR-044](docs/decisions/ADR-044-UNIFIED-THREAD-ID-AND-OMNI-CHANNEL-CONSOLE.md). [ADR-110](docs/decisions/ADR-110-RETIRE-EDGE-DEVICE-AND-HARNESS-SURFACES.md) retires the Edge Device and harness execution surfaces while preserving Knowledge/RAG.

1. **Tier 1 (Zuri-AI server)**: Business Execution Client and Live Monitor & Command Console. LINE OA uses signed Server ingress and the Conversation Runtime path; model inference uses the Business-provisioned PRP LocalWorker key when configured. No Edge Device worker or harness connection is active.
2. **Tier 2 (MSP — remote: [Memory-and-Soul-Passport](https://github.com/Freshair129/Memory-and-Soul-Passport))**: Agent Session Control, Unified Thread ID Authority & Memory Policy (Episodic scratchpads, token budget, vault gates, H0-H4 access ceilings).
3. **Tier 3 (GKS — remote: [Genesis-Knowledge-System](https://github.com/Freshair129/Genesis-Knowledge-System))**: Canonical Knowledge Authority & RAG Orchestrator (Entity identity, ontology, deduplication, scoped search, R0-R6 radius).
4. **Tier 4 (GenesisBlockDB)**: 6-lane hybrid retrieval substrate only (Vector, Lexical, Graph, SQLite, Bitemporal, Provenance via `query-ir.v1`).

Both MSP and GKS are standalone repos with their own `.claude/agents/`
role roster (`rkoi`/`kin`/`janus`/`ghost`/`ather`) — dev/build/test for
either happens in that repo, not in zuri-ai. zuri-ai never writes to their
Prisma-equivalent stores directly (ADR-050 D3/D4): for stages zuri-ai does
not execute, it holds counts only, never payload.

## 23. Developer documentation writer

The repository's developer-team entry point is [`.agents/README.md`](.agents/README.md).
The [team roster](.agents/team.md) separates manual responsibilities from shipped
agent definitions. For canonical documentation work, use the
[Doc Writer role](.agents/roles/doc-writer.md) and its
[authoring skill](.agents/skills/zuri-doc-writing/SKILL.md).

Doc Writer prepares documentation and reconciles verified evidence. It does not
approve its own work as an independent reviewer, change product behavior by
rewriting a document, or hand-edit generated registries/views. Work proceeds
inside the user's task; the root agent owns in-scope decisions and integration.
The current coding workflow is defined by the Git review and repository-CI
policy at the top of this file and the scoped verification policy. Shared
source composition and generation still have one integrator, as required by §19.

Version diff (2026-10-14): adopts autonomous v2 coding-delivery procedure,
supersedes routine human approval gates for in-scope work, and requires
trusted-mandate dispatch binding; preserves historical packet dispositions and
repository authority boundaries. Corrects the generated-corpus instruction to
ADR-081.

Version diff (2026-10-14, v3): requires bounded draft preparation before sealed
G0 reservations and create-only validated structural receipts, preventing draft
construction errors from consuming execution repair capacity. Preserves trusted
authority checks, execution budgets and all previous terminal dispositions.

Version diff (2026-10-05): adds the owner-approved PM task resume pointer to Document 20 entry point and §5 rule-check; source selection is recorded in the analysis-branch adoption receipt. Existing authority, candidate S-01 lifecycle and execution gates are unchanged.

Version diff (2026-10-04): adds the owner-approved Doc Writer entry point and
lifecycle metadata; existing product authority and canonical IDs are unchanged.

Version diff (2026-10-06): adopts service documentation and the shadow verification
policy, reconciles canonical-record paths and current CI/baseline instructions,
and preserves all active job-selection gates.

Version diff (2026-10-15, v4): replaces sealed G0 draft preparation for ordinary
work with one automatic read-only task-readiness preflight; folds root decision,
integration and final delivery into one responsibility; separates metadata
repair from per-cycle implementation budgets; and makes metadata-only
no-progress resumable. Keeps high-risk authority checks, independent review and
mandatory CI/test/merge gates; preserves historical v1 contracts, receipts and
WF00 source reconciliation.

Version diff (2026-10-22): ADR-113 retires the developer-only DDC procedure and
replaces it with ordinary Git review, change-relevant checks, independent review
for substantive work, and the existing required hosted CI. All earlier delivery
procedures, including v4 above, are historical and no longer govern current work.
Product workflows, document governance and verification policy remain separate.
