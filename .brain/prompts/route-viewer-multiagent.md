# Session prompt — repay the `route-viewer` baseline (23 routes), multi-agent

Paste everything below the line into a fresh session in `D:\zuri-ai`.

---

## Mission

23 route files export a mutating verb (POST/PATCH/PUT/DELETE) and resolve **no
request viewer**. Each one is a write nobody can attribute. They are recorded as
accepted debt in `docs/.route-viewer-baseline.json`, and that list **may only
shrink**.

Repay all 23. "Repaid" means the route resolves a viewer **and** the service
behind it refuses the write when that viewer lacks authority. A route that
resolves a viewer and passes it to a service that ignores it is worse than the
debt, because the baseline shrinks while nothing is guarded.

## Orientation (read before planning)

- `CLAUDE.md` and `AGENTS.md` — repository rules. §16 and §19 of AGENTS.md govern
  the doc graph.
- `npm run verify` is the definition of done: test → build → govern → e2e.
- JavaScript + Zod, **not** TypeScript. SQLite dev DB. Windows.
- Scope chain: Portfolio → Tenant → Business → Workspace(=Space) → Project.
  `docs/zuri_workspace_system.md` is the authority on what each name means; note
  that schema `Workspace` is the thing the product calls **Space**.

## The 23 routes, by the service behind them

| Service | Routes |
|---|---|
| `work-service` | `work`, `work/[id]`, `containers`, `containers/[id]` |
| `project-service` | `projects`, `projects/[id]`, `workstreams`, `workstreams/[id]`, `milestones`, `milestones/[id]`, `gates`, `gates/[id]` |
| `dependency-service` | `dependencies`, `dependencies/[id]` |
| repositories | `repositories`, `repositories/[id]`, `repositories/link`, `repositories/link/[id]` |
| `scope-service` | `scope`, `workspaces/[id]` |
| files | `projects/[id]/files`, `projects/[id]/files/[fileId]` |
| `backup-service` | `backup/import` |

Group work by **service**, not by route. Routes sharing a service share an
authorization question, and answering it once per service is what stops the same
predicate being written eight times — which is how two of the three existing
copies came to be wrong.

## Non-negotiable rules (each was learned expensively; do not rediscover them)

1. **Authorization is `ownsBusiness(viewer, businessId)`** from
   `src/modules/identity/viewer-authority.js`. Never `viewer.role`, never
   `visibleBusinessIds`. `role === 'OWNER'` is a per-principal label that is true
   for anyone who owns any Business anywhere; mistaking it for per-Business
   authority produced three privilege escalations
   (`.brain/rca/2026-08-16-global-role-is-not-per-business-authority.md`).
2. **For Project-scoped writes the Business comes from the Space**, not the
   Project: `workspace.businessId`. See `project-team-service.js` and
   `import-authorization.js` for the two existing correct examples.
3. **The viewer is a required argument that throws when omitted.** Precedent:
   `authorizeImportTarget()` and `classify()`'s mandatory `scope`. The failure
   mode for wiring a new surface without authorization must be a loud crash at
   wiring time, not a quiet write.
4. **Never add an entry to a baseline.** `docs/.route-viewer-baseline.json` may
   only shrink. Same for `.enum-copy-baseline.json`,
   `.client-mutation-baseline.json`, `.viewer-fixture-baseline.json`.
5. **Build test viewers with `makeViewer()` / `ownsElsewhere()` / `makeDevViewer()`**
   from `tests/factories/viewer.js`. A hand-built viewer is a preflight CRITICAL.
   `ownsElsewhere()` is the attacker shape: global role OWNER, target Business
   visible but owned elsewhere.
6. **Every refusal test needs a control** proving the refusal is caused by the
   missing grant and not by something incidental — same plan, same target, a
   viewer who *does* own it, and it succeeds.
7. **A refusal must not become an enumeration oracle.** Prefer answering exactly
   as for a resource that does not exist. `import-authorization.js` documents the
   pattern.
8. **When a check fires on something that is not what it names, fix the check**
   in the same change — never restructure the code to dodge it, and prove any
   loosening in both directions with a planted control
   (`.brain/rca/2026-08-17-a-guard-that-teaches-a-workaround.md`).
9. **`docs:check` does not see stale generated views.** The authoritative local
   check is `npm run govern` followed by
   `git diff -- docs/FEATURE-MAP.md docs/DOMAIN-MAP.md docs/TRACE.md docs/appendices/D-traceability.md`.
10. **One session owns the graph.** Do not run `govern` while another session is
    writing; two runs over one tree interleave.
11. **Requirement ids are keys.** Never renumber, reuse or recycle. If this work
    needs a new FR, declare it in `docs/PRD-SDD-v1.0.md` *before* the code.

## Does this need an FR?

Decide once, in planning, and record the answer.

- Adding a guard that enforces an **already-declared** rule (SEC-001, SEC-008,
  BR-001) is a defect fix — no new id.
- Any route where the guard **removes a capability someone could previously
  use** needs an FR, because that is a behaviour change. FR-065 is the worked
  precedent, including what to do when the authority question has no answer yet:
  refuse with a reason that names the missing authority rather than inventing a
  rule.

---

# Agent topology and gate contracts

Four roles. Each gate has an explicit contract: what it receives, what it emits,
what it may touch, and what makes it reject. **A gate that cannot reject is not
a gate** — if a role never returns REJECTED, it is decoration.

## 1. Planner — `fable5`

**Receives:** this prompt, the 23-route list, the repository.

**Emits** `.brain/waves/route-viewer-plan.md`:

- routes grouped into waves by service, each wave independently shippable and
  verifiable
- per wave: the authorization question in one sentence, the predicate that
  answers it, the routes affected, the FR decision (needed / not needed, with
  the reason)
- explicit ordering, with the dependency stated — a wave that changes a shared
  service signature must precede waves that call it
- for each wave, the **control test** that will prove the refusal is causal

**May touch:** `.brain/` only. **No source, no tests, no docs/.**

**Rejects (returns BLOCKED) when:** a route's authorization question cannot be
answered from existing declared rules and no owner decision exists. Do not invent
authority. Name the missing decision and stop — FR-065 clause (b) is the
precedent for how to write that up.

**Acceptance:** every one of the 23 routes appears in exactly one wave; no wave
mixes two authorization questions.

## 2. Architect — `fable5`

**Receives:** the planner's wave file.

**Emits** `.brain/waves/route-viewer-design.md`:

- the **one** predicate/helper per authorization question, with its module path,
  signature, and failure behaviour (throw vs typed refusal, status code, message)
- where it is called from: the **service**, not the route handler. State this
  explicitly per wave, because the import work proved that guarding at the
  handler misses alternate paths into the same service
- what each route handler changes (usually two lines: resolve viewer, pass it)
- the refusal's disclosure decision per wave — indistinguishable-from-absent, or
  an explicit reason, and why
- migration note for existing tests that call the service without a viewer

**May touch:** `.brain/` only.

**Rejects when:** the plan asks for the same predicate in two places, or asks for
a guard in a route handler where the service has more than one caller.

**Acceptance:** a worker can implement a wave from this document without making
an authorization decision of their own. If a worker has to decide *who may do
this*, the design is incomplete.

## Parallelism — 3 workers, and the three things that make it break

Three workers run concurrently. Naively that corrupts the tree, because three
things in this repository are **singletons**, verified before this was written:

| Singleton | Evidence | Consequence |
|---|---|---|
| the e2e suite | `playwright.config.js` — port `3100` hardcoded, `reuseExistingServer: false`, one `file:./e2e.db` | two concurrent runs fight over the port and the database |
| `npm run govern` | rewrites `docs/.doc-graph.json` and the generated views | two runs interleave; the first to finish commits a graph describing files the other has not committed. This happened twice on 2026-08-17 and cost a reverted commit |
| `docs/.route-viewer-baseline.json` | every worker would edit it | a guaranteed three-way conflict on one small file |

Unit and integration tests are **safe** in parallel — `tests/setup.js` injects a
per-run database under `prisma/.test-dbs/`.

So the rules are:

1. **Each worker runs in its own git worktree.** Spawn with
   `isolation: "worktree"`. Workers never share a working tree.
2. **Workers run `npm test` and `npm run build` only.** Never `npm run test:e2e`,
   never `npm run govern`, never `npm run verify`.
3. **Workers do not touch the baseline.** Each reports the routes it repaid; the
   integrator makes one edit at the end. This turns a certain conflict into a
   single deliberate change.
4. **Wave 0 is serial and lands first.** Any predicate more than one wave needs
   is written, tested and merged **before** the three workers start. Otherwise
   three workers invent three versions of it, which is the exact defect this
   whole effort exists to remove.
5. **Waves in flight must not share a source file.** The planner assigns by
   service for this reason. `project-service` owns eight of the 23 routes and is
   one wave — do not split it across workers to balance the load.

**Integration, after all three return and each has passed its verify gate:**

- merge the three worktrees onto one branch, one at a time
- make the single baseline edit removing every repaid route
- run `npm run govern` **once**, commit whatever it rewrites
- run `npm run verify` **once**, on the merged result
- an integration verify gate (`opus`) re-checks the merged diff against the same
  9 checks, plus: **no wave's guard was weakened by another wave's merge**

A wave that passed alone and fails merged is the interesting case. Do not fix it
in the merge commit — send it back to its worker with the failure.

## 3. Worker — `sonnet`, ×3 in parallel, one wave each

**Receives:** one wave from the plan plus the matching design section. **Never
more than one wave.**

**Does:**

1. Write the failing test **first** — the attacker (`ownsElsewhere()`) is refused,
   the owner succeeds (the control), nothing is written on refusal.
2. Implement the predicate and wire the service.
3. Wire the route handlers.
4. Update existing tests that call the service without a viewer. Prefer a
   file-local `const asOwner = (...) => service(..., { viewer })` wrapper over
   editing every call site by hand.
5. Run `npm test` and `npm run build`. Paste the real counts.
6. Report the routes it repaid, as a list, for the integrator's single baseline
   edit. **Do not edit the baseline** — three workers editing one small file is a
   guaranteed conflict.

**Runs in its own git worktree** (`isolation: "worktree"`). Never runs
`test:e2e`, `govern` or `verify` — all three are singletons and belong to the
integrator.

**May touch:** the files named in its wave and their tests. **Not another wave's
files. Not the baseline. Not the preflight scripts. Not requirement ids.**

**Must report, verbatim and unedited:** the red state before the fix (how many
tests failed and why), and the green state after. A worker that reports only
green has not shown the test proves anything.

**Rejects when:** implementing the wave requires an authorization decision the
design did not make. Stop and return to the architect — **do not choose.**

## 4. Verify gate — `opus`, runs after every wave

**Receives:** the wave's diff, the worker's report, the design section.

**Checks, in this order — any failure returns REJECTED with the specific reason:**

| # | Check | Fails when |
|---|---|---|
| 1 | **The guard is real** | the service can still be called without a viewer and write; the viewer is optional; the route resolves a viewer the service ignores |
| 2 | **The predicate is the shared one** | `ownsBusiness` is re-implemented, inlined, or replaced by a `role` check |
| 3 | **The control exists and is causal** | no test where the same call succeeds for an owner; refusal could be explained by a malformed fixture, a missing record, or a nonexistent id |
| 4 | **Nothing is written on refusal** | no assertion that the row count is unchanged |
| 5 | **The baseline only shrank** | any entry added or reworded to fit |
| 6 | **Viewers come from the factory** | any hand-built viewer literal |
| 7 | **No oracle** | the refusal distinguishes a real resource from a fabricated one where the design said it must not |
| 8 | **Verification is real** | `npm test` / `npm run build` output not pasted, or counts inconsistent with the diff; a skipped suite reported as passing |
| 9 | **Scope** | files outside the wave touched; the baseline edited; `govern`, `verify` or `test:e2e` run by a worker |

**Emits:** `APPROVED` or `REJECTED: <check #> — <specific evidence>`. Never
"looks good". A rejection names the file and line.

**Explicitly:** re-run `npm run verify` itself rather than trusting the worker's
paste. `scripts/assert-tests-ran.mjs` exists because an exit code of 0 once meant
the suite did not run.

---

## Wave completion

A wave is done, **in its worktree**, when its verify gate returns APPROVED and:

- `npm test` and `npm run build` are green, with counts pasted
- the commit message states what could be done before and cannot now

The wave is done **for real** only after integration: baseline shrunk by exactly
its routes, `govern` critical 0 / warning 0, `verify` green including e2e with no
flaky, and the integration gate APPROVED.

Commit per wave. Code changes go through a PR. Small doc/CI changes may go
straight to `main` — no branch protection, and CI runs on push to it. A PR whose
diff is documentation-only skips the e2e job automatically, so it costs ~2m40s
rather than ~10m; a diff touching `src/`, `tests/`, `prisma/` or `.github/` runs
everything.

## Overall done

`route-viewer` reports **0 remaining**, the baseline file is empty or deleted,
and `npm run verify` is green.

If any route cannot be repaid without an owner decision, **stop and say so** with
the FR-065 pattern: state what authority is missing, refuse to invent it, and
leave that route in the baseline with the reason recorded. Repaying 21 honestly
beats repaying 23 by guessing at two.
