# CLAUDE.md — working guide for this repository

Read this first, then `00-START-HERE.md` and `AGENTS.md` for the full spec pack.
This file is the short version: where things are, what to run, what never to touch.

## What this repo is (as of 2026-08-16)

This repo is **zuri-ai** — a standalone, AI-native business operating system.
It is **not** a version of any other product ([ADR-024](docs/ADR-024-ZURI-AI-IS-A-STANDALONE-PRODUCT.md)).

- **Scope chain**: Portfolio → Tenant (isolation) → Business → Workspace → Project.
- **LINE is the primary surface** (AI-native intake); the web app is the back-office
  console for detail, complex edits and audit.

Current state: the Project Manager MVP, all four intake surfaces, and the LINE/AI
stack are done (57 FRs, all with code and tests). The live delivery state is
`docs/roadmap/ROADMAP-zuri-v2-lab.md`.

**Historical vocabulary — read this before reading old documents.** Files written
before 2026-08-16 (ADR-001…023, ZV2-CR-001…008, older notes) call this product
"Zuri V2" and a legacy project "V1", because an early plan intended to lift that
project's UI. That plan was retired by ADR-024 with **zero** modules ever lifted.
Those words in history are labels, not instructions: there is no migration, no
cutover, no parity work, and nothing here descends from `G:\zuri`. Never derive
work from them. Id strings keep their historical letters (`ZV2-CR-007` stays
`ZV2-CR-007`) because ids are immutable keys (AGENTS.md §18).

## Hard rules (these do not bend)

| Rule | Why |
|---|---|
| **Never modify anything under `G:\zuri`** | It is a different product's repository (the legacy zuri project). Reading it as prior art is fine (ADR-024 D7); writing to it never is |
| **Never read `D:\workspace\zuri-command-agent\.env`** | It holds LINE OA secrets |
| **External ids are never primary keys** | Internal UUID + human `code` + `ExternalRef` mapping (BR-002) |
| **Never execute anything that arrives in a plan/envelope** | Plans are data (BR-007, SEC-002) |

## Layout

The app was flattened to the repo root (2026-08-12) — one Next.js app + the spec pack
in one tree, one `docs/`. (It began as a nested `zuri-v2-lab/` lab; historical docs
still cite that path as a record.)

```
docs/                     spec pack + ADRs + module docs (PRD-SDD, appendices, roadmap) — one tree
src/app/(pm)/             UI routes      src/app/api/   route handlers
src/modules/project-manager/
  application/            services (the only place that writes)
  progress/               pure calculators + roll-up (no I/O, no clock)
  import/                 the one intake pipeline every surface ends at
src/modules/{crm,identity,agent,knowledge}   LINE/AI stack (ADR-007: ingest · P3 gate · agent · GKS)
src/lib/                  db, ids, validation/enums.js (enum source of truth), shell-mode.js, db-boundary.js
prisma/schema.prisma      SQLite dev/test; schema.postgres.prisma + postgres/ for Supabase (FR-030)
tests/{unit,integration,e2e}
scripts/                  doc governance generators + Postgres cutover
contracts/                JSON Schema + sample envelopes
```

## Toolchain

```bash
npm run dev            # dev server (use the preview tool, not a raw shell, when available)
npm run build          # production build — must stay clean
npm test               # Vitest: unit + integration (own SQLite db per run, prisma/.test-dbs/)
npm run test:e2e       # Playwright against the dev server on :3100
npm run db:seed        # idempotent demo data   |  db:reset = drop + reseed
npm run docs:graph     # rebuild docs/.doc-graph.json + Appendix D from the filesystem
npm run docs:check     # CI guard — fails when the committed graph is stale
npm run docs:preflight # doc health: control blocks, links, coverage, appendix drift
```

Run `docs:graph` **and** `docs:preflight` after any change that adds a route, a
model, a requirement or a document. Both write machine-readable reports
(`docs/.doc-graph.json`, `docs/.preflight-report.json`) that the roadmap and
GoVibe Mission Control read.

### Where documentation lives (ADR-004)

```text
docs/PRODUCT-V2.md              Layer 0 — what zuri-ai is (surfaces, scope chain, rules); historical filename
docs/ai-system/                 LINE + AI: intent pipeline, prompts, PDPA, model lifecycle
docs/ADR-*.md                   decisions (ADR-024 = current direction, ADR-004 = this structure)
docs/PRD-SDD-v1.0.md            the Project Manager MODULE — the FR/NFR/BR/SEC/SDD registry
docs/FEATURE-MAP.md             GENERATED index of every feature — never hand-edit
docs/features/FR-0xx-*.md       one note per feature that has rationale worth recording
docs/appendices/                A api · B db · D traceability (generated) · E risks · F glossary
docs/roadmap/                   live delivery state (GoVibe Mission Control reads this)
```

Feature notes declare their feature in frontmatter (`feature: FR-020`), so the map
links them by id — moving or renaming a note never breaks anything. Write one only
when there is a real decision to explain; otherwise the feature already appears in
`FEATURE-MAP.md` with its code, tests and task. Full statement: AGENTS.md §19.

### Order of governance work, and the id contract

Whichever step changes the **meaning** of another step's input runs first. Moving
or renaming files never invalidates a plan (it breaks paths, which preflight
reports); changing scope or identity invalidates everything downstream. So:

```text
doc-architect → docs:graph + docs:preflight → implementation-plan → subagent-driven
```

**Requirement ids are keys, not labels.** `FR-xxx` / `NFR-xxx` / `BR-xxx` /
`SEC-xxx` / `SDD-xxx` keep their meaning for the life of the project. Move, rename,
split or merge documents freely — but never renumber an id, never reuse one for a
different statement, and never recycle a dropped one (mark it superseded and leave
the number burnt). Plans, annotations, tests, Appendix D and the doc graph all key
off them. Same rule as ADR-003 §D4 one level up: change the label, never the key.
Full statement: AGENTS.md §18.

### Doc-code annotations

Every non-trivial source file carries these; the graph is built from them, so a
missing annotation shows up as a coverage gap rather than being silently lost:

```js
// @req FR-020 — what user-visible requirement this file delivers
// @spec BR-004, SDD-002 — which rule or design decision it enforces
// @tested tests/unit/shell-mode.test.js — where the proof lives
```

`@req` → functional requirement · `@spec` → business/security rule or design
decision (or a doc path) · `@tested` → test file. Requirement ids live in
`docs/PRD-SDD-v1.0.md`; using an id that is not declared there is a
preflight CRITICAL.

## Conventions worth knowing before writing code

- **JavaScript + Zod at the boundary, not TypeScript** (SDD-008). Nothing but tests
  enforces a contract here — so any endpoint whose consumers already exist gets a
  contract test before its implementation changes.
- **Enums are strings in the database**, with `src/lib/validation/enums.js` as the
  single source of truth. Excel dropdowns, the OpenAPI document and validation all
  derive from it — never hand-copy an enum list.
- **Progress is always recomputed** from pure calculators; `progressCache` is
  advisory. Never report a number a page would disagree with.
- **Every write goes through a service** in `application/`, which records an audit
  event. Route handlers stay thin.
- **Every intake surface converges on one envelope** → validate → semantic check →
  read-only dry run → preview → single transaction → audit (BR-009, SDD-009). New
  surfaces add a converter, never a second write path.
- Thai copy in user-facing surfaces; English for code, ids and technical docs.

## Verifying work

A change is not done until: tests pass, `npm run build` is clean, `docs:graph` and
`docs:preflight` are green, and — for anything visible in the browser — it has been
opened and checked, not assumed.
