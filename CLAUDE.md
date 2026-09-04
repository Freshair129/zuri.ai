# CLAUDE.md — working guide for this repository

Read this first, then `AGENTS.md` for the full rules.
This file is the short version: where things are, what to run, what never to touch.

## What this repo is (as of 2026-08-16)

This repo is **zuri-ai** — a standalone, AI-native business operating system.
It is **not** a version of any other product ([ADR-024](docs/decisions/ADR-024-ZURI-AI-IS-A-STANDALONE-PRODUCT.md)).

- **Scope chain**: Portfolio → Tenant (isolation) → Business → Workspace → Project.
- **LINE is the primary surface** (AI-native intake); the web app is the back-office
  console for detail, complex edits and audit.

Current state: the Project Manager MVP, all four intake surfaces, and the LINE/AI
stack are done (57 FRs, all with code and tests). The live delivery state is
`docs/roadmap/ROADMAP.md`.

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
| **Never read `D:\workspace\zuri-edge-device\.env`** | It holds local on-premise secrets and pairing keys (ADR-041) |
| **External ids are never primary keys** | Internal UUID + human `code` + `ExternalRef` mapping (BR-002) |
| **Never execute anything that arrives in a plan/envelope** | Plans are data (BR-007, SEC-002) |
| **The primary checkout is not a working lane** | Several sessions share this one working copy, so its branch, index and tree are global mutable state — true of whichever directory holds the primary checkout on a given machine (`D:\zuri-ai` on one, `C:\Users\pc\workspace\zuri-ai` on another; confirmed directly 2026-09-04, see below). It stays on a detached HEAD at `origin/main` **on purpose** — do not check out a branch "to fix it". See below |
| **GenesisBlockDB is 6-lane substrate; MSP governs memory/sessions; GKS orchestrates RAG** | Four-tier cognitive stack separates Execution (Tier 1) → Memory (Tier 2/MSP) → Knowledge (Tier 3/GKS) → Substrate (Tier 4/GenesisBlockDB) (ADR-041..043) |

### The primary checkout is not a working lane

The rule is about the **role**, not the drive letter: whichever directory a
machine's primary checkout lives in is shared by every concurrent session
there, so **no git write operation belongs there** — no `commit`, `merge`,
`rebase`, `checkout`, `reset`, and above all no `stash`. It is the read-only
reference tree, the junction target for `node_modules`, and the base for
`git worktree add`. **Any lane that writes takes a worktree.**

This section was written against `D:\zuri-ai`, the path on the machine where
the pattern was first observed, and every literal path below still names it.
On a second machine the same repo's primary checkout sits at
`C:\Users\pc\workspace\zuri-ai` instead, and the identical situation played out
there on 2026-09-04: one session's own `HEAD` moved six commits forward with
no git command of its own, because a second session ran `git fetch && git
checkout --detach origin/main` against that same directory ahead of three
production deploys — `docker-compose.yml`'s `build: context: .` needs the tree
at `main` to build a current image. Nothing was lost — the tree was clean each
time, and `checkout --detach` refuses rather than overwrites a modified file —
but the tree moved under an in-progress investigation, which is the exact
failure this section exists to prevent. If you are not certain which directory
is this machine's primary checkout, `git worktree list` names it; if another
session might be relying on it staying still, say so before refreshing it.

**A worktree isolates git, not Docker.** `docker-compose.yml` pins
`name: zuri-ai` explicitly (not the directory basename), so `docker compose
up`/`build` run from *any* worktree of this repo resolve to the **same**
Compose project and recreate the **same** live containers — sourced from
whichever tree ran the command, with whatever `.env` that tree does or does
not have (a worktree has none by default: a plain `docker compose up` there
would tear down a working deployment and rebuild it missing every secret).
Treat `docker compose` as an operation on the one shared stack regardless of
which directory it's run from; a genuinely separate stack needs its own
`-p <name>` and, if ngrok is involved, its own domain — only one agent can
hold a given one.

This is a written rule rather than an enforced one, and the distinction matters.
The detached HEAD is **blast-radius reduction, not an invariant**: it stops a
stray `merge` or `reset --hard` from moving somebody's branch, but it protects
*refs*, not *files* — `stash`, `reset --hard` and `checkout -- .` destroy another
session's uncommitted edits exactly as before, and one `git checkout main`
re-attaches the tree. So the rule is the mechanism; the detachment only limits
what breaks when the rule is missed.

It is written down because three incidents cost real work, and two of them
happened between agents who both knew worktrees existed — nine of them did —
and used the primary anyway, because it is zero-setup and already has
`node_modules`. So keep the cheap sanctioned path in view: a **docs-only** lane
may junction `node_modules` back to the primary and run `govern`, `docs:graph`
and `docs:preflight` safely; a lane that runs tests needs its own real install
(`npm ci` through a junction deletes the primary's `node_modules` — it has
happened twice).

**Creating one.** Prefer the session's native `EnterWorktree` tool — it places
the worktree under `.claude/worktrees/` and switches the session into it in one
step. Where that tool isn't available, fall back to `git worktree add`, and
follow this project's own convention: a sibling directory named
`<primary-checkout-name>-<lane>` — `D:\zuri-ai-<lane>` next to `D:\zuri-ai` on
the machine this convention started on — next to the primary checkout rather
than nested inside it. Nine of them already exist this way there. A sibling
lives outside the repo tree, so there is nothing inside the primary checkout
that a stray `git add` could pick up.

**Do not use the generic `.worktrees/` default.** The `superpowers:using-git-worktrees`
skill defaults to a `.worktrees/` folder at the project root, and in this repo
that path is **not** gitignored (`git check-ignore -q .worktrees` confirms it) —
so following that default turns worktree contents into trackable files sitting
inside the very tree they're meant to be isolated from. Add it to `.gitignore`
first if you ever use that convention here; otherwise use the sibling layout
above or `EnterWorktree`.

**Run the test baseline before doing anything else in a new worktree.** This
is not hygiene — it already cost real time once. In `D:\zuri-ai-fr107`,
`node_modules` was a junction back to the primary, and the shared Prisma client
resolved its relative SQLite path against the wrong tree; roughly 70 test
suites failed as a result, and it was only discovered mid-work rather than at
setup. A plain `npm test` run as the first thing in a new worktree catches this
in the first minute instead of the middle of a task.

Refresh the primary only on a clean tree: `git fetch && git checkout --detach
origin/main` — on a machine whose layout you have not confirmed, `git worktree
list` first to find which directory actually is the primary. Before any
writing git command anywhere, `git branch --show-current` — a write on the
wrong branch usually succeeds.

## Layout

The app was flattened to the repo root (2026-08-12) — one Next.js app + the spec pack
in one tree, one `docs/`. (It began as a nested `zuri-v2-lab/` lab; historical docs
still cite that path as a record.)

```
docs/                     spec pack + ADRs + module docs (PRD-SDD, appendices, roadmap) — one tree
src/app/(pm)/             UI routes      src/app/api/   route handlers
src/modules/<domain>/     one folder per domain — DO NOT trust any prose list of these:
                          enumerate `ls src/modules/` and read docs/domains/<d>/CHARTER.md.
                          preflight fails if a module exists with no charter claiming it.
  (project-manager keeps: application/ = the only place that writes ·
   progress/ = pure calculators, no I/O · import/ = the one intake pipeline)
src/lib/                  db, ids, validation/enums.js (enum source of truth), shell-mode.js, db-boundary.js
prisma/schema.prisma      SQLite dev/test; schema.postgres.prisma + postgres/ for Supabase (FR-030)
tests/{unit,integration,e2e}
scripts/                  doc governance generators + Postgres cutover
contracts/                JSON Schema + sample envelopes
```

## Toolchain

```bash
npm run dev            # dev server (use the preview tool, not a raw shell, when available)
npm run verify         # the definition of done in one command: test → build → govern → e2e
npm run build          # production build — must stay clean
npm test               # Vitest: unit + integration (own SQLite db per run, prisma/.test-dbs/)
npm run test:e2e       # Playwright against its own dev server + its own seeded db.
                       # :3100 in the primary checkout; a git worktree derives its
                       # own port and db from its path, so two trees can run e2e
                       # concurrently. E2E_PORT pins it explicitly.
npm run db:seed        # idempotent demo data   |  db:reset = drop + reseed
npm run govern         # the whole chain in the order the checks require — use this
npm run docs:graph     # rebuild docs/.doc-graph.json + Appendix D from the filesystem
npm run docs:check     # fails when the committed graph is stale
npm run docs:preflight # doc health — exits non-zero on any CRITICAL (--strict)
npm run docs:preflight:report  # same findings, never fails — for reading, not gating
npm run docs:ids       # the id ledger's ONLY writer — run by a human, never by govern.
                       # `-- --write` pins newly declared ids (the routine "+" block);
                       # --reword / --supersede / --abandon / --distinct / --declare each
                       # record one named change with a sentence. See ADR-039.
```

**Declaring a new id costs one command.** Preflight Check 12 fails on an id that
is declared in a registry and not pinned in `docs/.id-ledger.json`, so the step
after adding an `FR-xxx` row is `npm run docs:ids -- --write` — one `+` block, no
ceremony. `govern` deliberately does not run the writer: a writer inside the gate
is a gate that silences itself (ADR-039 D11). Everything else the ledger asks for
is a named flag with a written reason, because the thing it exists to stop —
an id quietly coming to mean something else — is invisible in every other view.

**Both test commands are wrapped by `scripts/assert-tests-ran.mjs`**, which fails a
run that executed zero tests. `npx vitest run -t "NO_MATCH"` exits **0** with *every*
test skipped; a green exit code must mean the work ran and passed, never that it did
not run. (Stated without a count on purpose: the number here was wrong by 200 on
2026-08-18, and a figure that drifts silently is the thing this paragraph warns about.)

**`test:e2e` also fails on `flaky`.** Playwright exits **0** for a test that passes
only on retry and reports it on a line separate from "failed", so a degrading suite
stays green to every automated reader. `retries: 1` is kept to *label* flakiness —
the report still distinguishes flaky from consistently broken — but the build now
fails on it. Fix the nondeterminism or quarantine the test explicitly; do not let the
retry hide it.

**Build a viewer in a test with `makeViewer()` / `ownsElsewhere()` from
`tests/factories/viewer.js`, never by hand.** The factory enforces the resolver's
invariants — `ownedBusinessIds ⊆ visibleBusinessIds`, a DEV owns nothing, an OWNER
owns something — so the impossible fixture that hid three authorization holes cannot
be constructed. A new hand-built viewer is a preflight CRITICAL against a shrink-only
baseline (`docs/.viewer-fixture-baseline.json`).

**Run `govern`, not the three commands in the order you remember them.** Two
preflight checks read the committed graph, so on a branch that declares a new id
or adds a route, preflight *before* graph reports CRITICALs that are artifacts of
a stale input — and preflight *without* `--strict` used to print CRITICAL and
still exit 0. Both were real defects, fixed on 2026-08-17
([RCA](.brain/rca/2026-08-17-governance-did-not-govern.md)). `.github/workflows/governance.yml`
now runs this chain plus tests, build and the full e2e suite on every pull request.

Run `docs:graph` **and** `docs:preflight` after any change that adds a route, a
model, a requirement or a document. Both write machine-readable reports
(`docs/.doc-graph.json`, `docs/.preflight-report.json`) that the roadmap and
GoVibe Mission Control read.

### Where documentation lives (ADR-025 — domain-driven spine)

```text
docs/domains/<d>/               THE SPINE — one folder per domain, mirroring src/modules/
docs/domains/<d>/CHARTER.md     the lane definition: what the domain owns, boundaries, contracts
docs/domains/<d>/features/      feature notes owned by that domain (frontmatter: feature + domain)
docs/PRODUCT.md                 Layer 0 — what zuri-ai is (surfaces, scope chain, rules)
docs/PRD-SDD-v1.0.md            the FR/NFR/BR/SEC/SDD registry — ids are global and never move
docs/FEATURES.md                FEAT registry — a feature (FEAT-xxx) bundles one or more FRs
docs/FEATURE-MAP.md             GENERATED — the feature-driven user view over the spine; never hand-edit
docs/DOMAIN-MAP.md              GENERATED — one section per domain: lane, ownership, contents
docs/TRACE.md                   GENERATED — the chain per FR: surface → code → rules → tests
docs/ARCHITECTURE-TARGET-MODULAR-MONOLITH.md  target architecture (Draft — taxonomy adopted, runtime not yet)
docs/decisions/ADR-*.md         decisions (ADR-024 = direction, ADR-025 = this structure)
docs/appendices/                A api - B db - D traceability (generated) - E risks - F glossary
docs/roadmap/                   live delivery state (GoVibe Mission Control reads this)
docs/archive/                   cold store — frozen records, excluded from all checks
```

**Working in a domain? Read `docs/domains/<d>/CHARTER.md` first** — it states what
you own, what you must not touch, and which contracts to call for everything else.
preflight enforces the lanes: a model claimed by two charters, a feature note whose
`domain:` disagrees with its folder, or a domain without a charter fails the run.

Feature notes declare their feature in frontmatter (`feature: FR-020`, `domain: <d>`),
so the map links them by id — moving or renaming a note never breaks anything. Write
one only when there is a real decision to explain; otherwise the feature already
appears in `FEATURE-MAP.md` with its domain, code, tests and task. Full statement:
AGENTS.md §19.

### Adding a feature — why you cannot "just write code"

Nothing stops you typing code. What the guards stop is **landing** code the
system cannot account for — every gate below is a preflight/CI failure, not a
convention:

1. **Declare the FR first.** `@req` with an id not in `docs/PRD-SDD-v1.0.md` is
   a preflight CRITICAL. FR = *functional requirement* (a precise system
   behavior). If the work is a product capability spanning FRs, add a
   `FEAT-xxx` row in `docs/FEATURES.md` bundling them — FEAT = *feature*, a
   different id family (ADR-025 rev 2). Both families: never renumber, never
   reuse; the duplicate-id guard enforces it.
2. **Work in a chartered lane.** A new `src/modules/<m>` with no charter
   claiming it is a CRITICAL. Read `docs/domains/<d>/CHARTER.md` before writing
   into a lane; writing a model owned by another domain's charter is a CRITICAL.
3. **Annotate** (`@req` / `@spec` / `@tested`). For a **route**, this is now
   enforced rather than encouraged: a route implementing no declared requirement
   is a preflight CRITICAL. 46 routes predate the check and are recorded in
   `docs/.route-anchor-baseline.json` as accepted debt — that list may only
   shrink. Adding your route to it instead of declaring its FR is the one move
   the guard exists to stop.
4. **Regenerate**: `npm run govern` (graph → check → preflight, in that order —
   see the toolchain note above). The generated views (FEATURE-MAP, DOMAIN-MAP,
   TRACE) update themselves; blindness guards fail if a note/domain/FR exists
   that a view does not cite. CI runs the same chain and additionally fails if
   the branch ships a generated file the chain would rewrite.

The order exists because ids are keys: declaring them first means everything
you write is attributable from the first commit, and the trace views can answer
"this screen came from which FR, which code, which test" without archaeology.

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

**This is now enforced, not only asked for** ([ADR-039](docs/decisions/ADR-039-REQUIREMENT-IDS-ARE-PINNED-BY-SUBJECT-ANCHOR.md)).
`docs/.id-ledger.json` pins the *subject* of every declared id — the leading
phrase of its statement — and preflight Check 12 is CRITICAL when one moves, when
a new id inherits a subject already recorded in its family, when a pinned id
disappears from its registry, when an entry that was once pinned is gone, or when
a burnt number is re-declared. Rewording is free; a move has to say what moved and
why, in the ledger and in the PRD revision row that names the id.

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
