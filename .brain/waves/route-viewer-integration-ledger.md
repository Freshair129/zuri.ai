# `route-viewer` repayment — integration ledger

Started 2026-08-17. Controller: Opus 5. Mission spec:
[`.brain/prompts/route-viewer-multiagent.md`](../prompts/route-viewer-multiagent.md).

**Survives compaction — trust this file over recollection.** Never re-dispatch a
task marked ✅.

## C1 — worktree isolation *is* available, and the ledger's reason it was not is wrong

`2026-08-17-wave-0-1-ledger.md` records "worktree isolation is unavailable in
practice — a fresh git worktree has no `node_modules`, so an agent there cannot
run the tests that would prove its work." That conclusion held Wave 1 to a shared
tree separated by file. It is wrong, and the mission spec's demand for
`isolation: "worktree"` is satisfiable. Measured, not argued:

| Step | Result |
|---|---|
| `git worktree add` + junction `node_modules` → main tree | `npx vitest run tests/unit/viewer-authority.test.js` → **3 failed / 6 passed** |
| same file, main tree (the control) | **9 passed** |
| worktree + real `npm install` (64s, 278 packages) | **9 passed** |

**Why the junction fails, which is the part worth keeping.** `prisma db push`
created the run database under `D:\zuri-wt-probe\prisma\.test-dbs\`, reported
"your database is now in sync", and `assertSchemaApplied` passed. The *client*
then read a different, empty database. `tests/global-setup.js` builds a
deliberately relative datasource URL (`file:./.test-dbs/<run>.db`) because Prisma
resolves it against the schema directory — but the generated client bakes in the
schema directory it was generated in. Junctioned from the main tree, that is
`D:\zuri-ai\prisma`, so the client auto-created an empty SQLite file there and
every `create()` hit a missing table. A real `npm install` runs `postinstall`
→ `prisma generate` in the worktree, so the baked path is the worktree's own.

Consequence: **never share `node_modules` into a worktree by junction or symlink.**
Each worker installs its own.

## C2 — worktrees are not merely allowed here, they are required

Wave 1's five agents shared one tree safely because none of them ran
`npm run build`. This mission's workers each must (mission spec §3.5), and
`next build` writes one `.next/` per tree. Three concurrent builds in a shared
tree corrupt each other. So the shared-tree-separated-by-file protocol that Wave 1
proved is **not** transferable to this wave, independently of C1.

## DONE — 2026-08-18. `route-viewer` 23 → 4, `verify` green.

| Gate | Final |
|---|---|
| `npm test` | 1077 passed, 9 skipped / 140 files |
| `npm run build` | clean |
| `npm run govern` | critical 0 · warning 0 · info 16 |
| `npm run test:e2e` | 45 passed, **no flaky** |
| ratchet | **4 remaining**, each with a named missing decision |

Integration gate **APPROVED** (`59028db`), then found two real gaps in the
controller's own disclosure test, both repaid in `e5e42ab`. Its strongest
evidence: planting `ownsBusiness → true` turned **54 of 81** FR-072 tests red.
The guards are real, not textual.

**Two of three wave families were rejected on first pass.** Neither rejection
came from reading the diff and disliking it — both came from planting a defect
and observing what stayed green. That is the thing to copy from this run.

**What the four remaining routes need is an owner decision, not more work.**
`.brain/waves/route-viewer-plan.md` §BLOCKED and the `blocked_reasons` field in
the baseline state each one. None is repayable by writing a better guard.

## C7 — `isolation: "worktree"` branches from `main`, not from the controller's HEAD

Wave 0 was committed to the branch `fr072-route-viewer-wave0`. All three worker
worktrees were created at `aed93d9` — `main`'s tip — which is exactly one commit
*behind* Wave 0, so none of them contained `project-authorization.js`.
`git merge-base --is-ancestor e89fe37 HEAD` returned false in every worktree.

Worker 1 hit the precondition check written into its brief, stopped without
writing a line, and reported the divergence with the merge-base evidence. That is
the check earning its place: the alternative outcome is a worker inventing its
own predicate because the shared one appeared not to exist — the exact defect
this mission exists to remove, reintroduced by its own tooling.

Fixed by fast-forwarding `fr072-route-viewer-wave0` into each worktree
(`git -C <wt> merge --ff-only`), which preserves each worker's ~64s `npm install`
and needs no push to `main`. A modified `package-lock.json` in a worker's tree is
expected from that install and is not a source change.

**For any future wave dispatch:** either land the prerequisite on `main` before
spawning, or merge it into each worktree immediately after spawning. Do not
assume a worktree inherits uncommitted or side-branch work.

## C8 — Wave 0 pre-threaded two shared test files and created a third it forgot

The design identified `project-core.test.js` and `adaptive-shell.test.js` as the
files several waves would otherwise all edit, and had Wave 0 pre-thread them.
Wave 0 then wrote `tests/integration/project-authorization.test.js`, whose
`beforeAll` builds fixtures with `createContainer`, `createItem`, `createMilestone`
and `createWorkstream` — five waves' services — and did **not** pre-thread it.
Controller's oversight: the rule was applied to the files that existed when the
rule was written, and not to the one the same commit created.

Worker 2 hit it, made the minimal fix (threaded `{ viewer: owner }` into the two
call sites its guard broke), and reported it explicitly under the design's
residual-risk clause. Exactly the requested behaviour.

**Consequence to expect at merge:** Worker 3's waves guard `createMilestone`,
so it will break and fix the *same* `beforeAll` in the *same* file. A conflict
there is expected and mechanical — both sides thread a viewer into different
call sites of one function. Merge serially and take the union; do not treat it
as a wave failing.

## C9 — the no-oracle guarantee rests on a substring, and both gates found it independently

**Integration task, not a wave defect.** Tier A promises that an unowned real
target is indistinguishable from an absent one. Traced end to end, that currently
holds like this:

| Path | Thrown | `handle()` maps to |
|---|---|---|
| unowned real target | `refusal(404, 'Milestone not found')` — explicit `.status` | 404 |
| fabricated id | pre-existing `new Error('Milestone not found')` — **no** `.status` | 404, via `/not found/i` |

Identical status, byte-identical body — so there is no oracle today. Verified
directly by the controller against `_helpers.js`, and independently by the Wave
2/4 gate.

**But the second row is load-bearing on the string "not found" appearing in a
legacy message.** Reword one of those pre-existing checks to, say, "no such
milestone" and the sniff falls through to **500** while the unowned path stays
404 — an enumeration oracle, reintroduced by an innocuous copy edit, and no
current test would catch it. This is also why Worker 3's Tier A assertions had to
be relaxed from status-equality to message-equality: at the raw service layer the
two shapes genuinely differ, and only `handle()` makes them equal.

**Fix at integration (controller):** assert the property where it actually
lives — push both shapes through the same mapping `handle()` uses and require
identical effective status *and* message per repaid target kind. That test fails
on a reword, which the current per-wave assertions do not. Do not weaken the
per-wave tests further; add the boundary-level one.

**Upgraded from "worth tightening" to a REJECTION, on evidence.** The Waves
3/5/6 gate planted the regression rather than reasoning about it — set
`const notFound = false` in `_helpers.js:31` (the explicit-status-only direction
that file's own header says it is moving toward) so a fabricated id yields 500
while an unowned real target yields 404: **a live enumeration oracle**. All 26 of
Worker 3's tests stayed green. The single red in 1040 was an unrelated GET-route
unit test that pins the sniff incidentally.

So the property is asserted **nowhere**, and the claim survives only in code
comments. Check 7 fails for Waves 3/5/6 and the same gap exists in Waves 1, 2, 4
and 7 — the Waves 2/4 gate spotted it as an observation and approved anyway.

**Division of the remedy** (deliberate, and the reason it is not sent back three
times): writing the same oracle assertion into six wave test files is the exact
disease this mission exists to cure — a rule applied by hand at each site,
correct at the sites someone remembered. The controller writes **one**
boundary-level test covering every repaid target kind, plus the planted control
rule 8 requires. Workers fix only what is theirs. The integration gate re-checks
it, so the controller does not mark its own homework.

## C10 — why e2e should survive the guards (checked before merging, not after)

Every e2e write now passes through a guard, so the demo viewer's grants decide
whether the suite still runs. Read from `resolve-viewer.js` rather than assumed:

| Branch | `ownedBusinessIds` | Consequence |
|---|---|---|
| local demo / dev fallback (`!principalId`) | **every Business** | Business-governed e2e flows keep passing |
| `platformGrant` (DEV) | **`[]`** — empty by design | owns nothing; any flow running as DEV would be refused |
| real principal | per-Membership | unchanged |

E2e runs the first branch, so Tier A is satisfied everywhere. **The residual risk
is Tier B, which no grant can satisfy**: a Project in a PORTFOLIO/TENANT Space is
refused for every principal including the demo owner. Any e2e flow that writes to
a shared-Space Project will now fail — correctly, but visibly. The planner found
none; the first full `verify` on the merged tree is the actual proof.

`prisma/seed.js` is unaffected: it builds `WS-PLATFORM` and everything else with
raw `prisma.upsert`, never through the guarded services. That also makes Worker 1's
Prisma-direct fixtures for shared-Space Projects consistent with how the
repository already constructs that state.

## Worker worktree setup protocol

1. Spawn with `isolation: "worktree"`.
2. `cp ../zuri-ai/.env .env` — `.env` is gitignored, absent from a fresh
   worktree, and vitest reports "Environment variables loaded from .env" when it
   is there.
3. `npm install --no-audit --no-fund` (~64s). **Not** a junction — see C1.
4. `npm test` and `npm run build` only. Never `test:e2e`, `govern` or `verify` —
   all three are singletons owned by the integrator.

**Update 2026-08-18 — `test:e2e` is no longer a singleton.** The port and the e2e
database were two hard-coded literals (`3100`, `file:./e2e.db`) in two files, so a
second tree could not run e2e at all, and the two literals had to agree with
nothing making them agree (the failure in
[the bootstrap RCA](../rca/2026-08-14-e2e-database-bootstrap-gap.md)). Both now
come from one decision in `tests/e2e/e2e-target.js`: the primary checkout keeps
:3100, a git worktree derives its own port *and* its own database from its path —
deterministically, so two trees never race — and `E2E_PORT` pins it explicitly.
Proven with a blocker verifiably serving on :3100: the worktree ran the suite on
:3147 against `prisma/e2e-3147.db`. `govern` and `verify` remain integrator-only.

## C3 — the ratchet is textual, so it cannot detect a fake repayment

`scripts/doc-preflight.mjs` check 10 greps each route file for
`/resolveRequestViewer|resolveViewer/`. A route that resolves a viewer and then
ignores it **passes the ratchet**. That is precisely the outcome the mission spec
calls "worse than the debt", and it is why verify-gate check #1 is a human-read
gate on the diff rather than a script. The baseline shrinking is evidence of
nothing on its own.

## C4 — the "before" count, measured on `main` at `aed93d9`

```
Test Files  131 passed | 3 skipped (134)
     Tests  992 passed | 9 skipped (1001)
assert-tests-ran: vitest executed 992 test(s).
```

This is the floor every worker's paste is judged against. A worker reporting
fewer than 992 passing has not added tests, it has stopped running some — which
is verify-gate check #8, and the reason `scripts/assert-tests-ran.mjs` exists.

Note for the end of the mission: **CLAUDE.md says "all 792 tests"** in its
`assert-tests-ran` paragraph. The real number is 992. Stale inventory of exactly
the kind [the drift RCA](../rca/2026-08-16-code-doc-drift-stale-inventories.md)
covers. Out of scope for a wave; fix it in the integration commit.

## C5 — the planner returned BLOCKED (partial): 19 repayable, 4 not

Three of its load-bearing claims were re-verified by the controller rather than
taken on trust, because the whole plan rests on them:

| Claim | Verified how | Result |
|---|---|---|
| FR-072 is next-free | `grep -oE "FR-[0-9]{3}" docs/PRD-SDD-v1.0.md \| sort -u \| tail` | registry tops at FR-071; FR-072 unused anywhere ✓ |
| milestones/gates are **not** behind `project-service` | `ls src/modules/project-manager/application/` | `milestone-gate-service.js` exists ✓ — **the mission spec's own route table is wrong**, and "project-service owns 8 of the 23" is really 4 + 4 across two files |
| `Repository` has no scope field | `awk '/^model Repository /,/^}/' prisma/schema.prisma` | no `businessId`, no `tenantId`, no `projectId` — only `projects ProjectRepository[]` ✓ |

**The 4 blocked routes share one shape**, which is the finding worth keeping:
each is SEC-008's fail-closed rule colliding with a *shipped, declared*
capability. Not one of them can be resolved by picking a predicate.

| # | Route | Missing decision |
|---|---|---|
| B1 | `api/scope` (POST) | who may create Portfolio/Tenant/Business/LegalEntity before any above-Business authority is holdable. Refusing everyone would remove FR-020's live "เพิ่มธุรกิจ" onboarding flow |
| B2 | `api/backup/import` (POST) | what authority governs a whole-database restore. No per-Business predicate reaches it; `isPlatform` is visibility-without-authority (`ownedBusinessIds: []`), so using it would repeat the 2026-08-16 global-label-as-authority defect at platform scale. Refusing everyone removes FR-013's shipped restore |
| B3/B4 | `api/repositories`, `api/repositories/[id]` | what scope owns a `Repository` record. Deriving from its links fails **open**: a fresh Repository has no links, so a links-conjunction is vacuously true = "any authenticated caller". Likely a schema change, which would also close the cross-tenant `listRepositories` read |

Per the mission spec these are recorded and left in the baseline, not guessed.
Final state will be `route-viewer` reporting **4 remaining**, each with a named
decision an owner can act on — not 0.

## Wave map (from the plan; 19 routes across 7 waves + serial Wave 0)

| Worker | Waves | Service files owned | Routes |
|---|---|---|---|
| 1 | 1 → 7 | `project-service.js`, `project-file-service.js` | 6 |
| 2 | 2 → 4 | `work-service.js`, `dependency-service.js` | 6 |
| 3 | 3 → 5 → 6 | `milestone-gate-service.js`, `repository-service.js`, `scope-service.js` | 7 |

Waves 5 and 6 share a *file* with blocked functions (`repository-service.js`
holds the blocked `createRepository`; `scope-service.js` holds the blocked
creators). Those functions stay untouched, and single-file ownership is why that
worker holds both waves.

## Gate log

| Gate | Status | Agent | Output |
|---|---|---|---|
| Planner | ✅ BLOCKED(partial) | fable5 | `.brain/waves/route-viewer-plan.md` |
| Architect | ✅ DESIGN COMPLETE | fable5 | `.brain/waves/route-viewer-design.md` |
| **Wave 0** | ✅ **committed `e89fe37`** | controller | helper + FR-072 + pre-thread |
| Worker 2 — Waves 2, 4 | ✅ **APPROVED**, committed `0ea085e` | sonnet | 6 routes |
| Worker 1 — Waves 1, 7 | ❌ REJECTED check 3 → 🔄 fixing | sonnet | 6 routes |
| Worker 3 — Waves 3, 5, 6 | ❌ REJECTED check 7 → ⏸ blocked on Wave 1 | sonnet | 7 routes |
| Integration | ⏸ | controller + opus | oracle test, baseline −19, `govern` ×1, `verify` ×1 |

### Gate verdicts — both rejections were found by evidence, not by reading

**Waves 2+4 APPROVED.** Gate re-ran and measured 1021/134 itself, matching the
worker. Zero endpoint derivation written by hand; the A/B conjunction control
differs only in `ownedBusinessIds`, so no fixture artefact explains the refusal.

**Waves 1+7 REJECTED — check 3**, `project-business-binding.test.js:74`. The
worker correctly converted a create-test into a refusal test, but left the
downstream `expect(…'PRJ-BIND-SHARED').toBe(false)` in place. That row is now
never created — the only other mention is inside a `rejects` expectation — so the
assertion **passes vacuously and cannot fail**. It was the negative half of
FR-043's proof that `listProjects` excludes ownerless shared-Space Projects, a
filter production still needs because seeded `WS-PLATFORM` holds exactly those.

The same gate **corrected the controller's brief**: there were two Prisma-direct
fixture sites, not three, and both are arrangement rather than subject. It also
ruled the broadened capability removal (refusing *creation* into a shared Space,
not only the move) squarely inside FR-072(b) and mandated verbatim by design
§4 Wave 1 — so it is not worker invention.

**Waves 3/5/6 REJECTED — check 7**, on the planted-regression evidence in C9.

### Worker 3's merge hazard — the mission's "passed alone, fails merged" case

Its three test files build fixtures with bare `createProject(...)`, and its Tier B
fixtures put a Project in a **PORTFOLIO** Space. Once Wave 1 merges, those
`beforeAll` blocks fail — first on the wiring 500, then *irreparably*, because a
shared-Space Project is Tier B 403 for every principal and cannot be built
through `createProject` at all. Per the mission this goes back to its worker, not
into the merge commit. Sequencing: fix Wave 1 → merge Waves 1+7 and 2+4 → merge
that into Worker 3's worktree so it fixes against the real merged tree → re-gate.

## C6 — Wave 0, done and measured (branch `fr072-route-viewer-wave0`, commit `e89fe37`)

| Gate | Result |
|---|---|
| `npm test` | **1005 passed, 9 skipped / 132 files** — exactly the 992 floor + 13 new cases, 131 + 1 files |
| `npm run build` | ✓ Compiled successfully, 25/25 static pages |
| `npm run govern` | **critical 0 · warning 0 · info 16 → PASS** |
| ratchet | still `23 remaining` — correct, Wave 0 repays no route |

**The pre-thread is a verified no-op**, not an assumed one: no existing test moved.

**The helper is proven load-bearing, not merely green.** Planting the exact
historical defect — `viewer.role !== 'OWNER'` in place of
`ownsBusiness(viewer, businessId)` — turned exactly **4 tests red**: all three
Tier A refusals plus the endpoint-chain case. Reverted before commit. A guard
whose tests stay green when you break it is decoration, and this one is not.

Worth keeping: `handle()` in `_helpers.js` sniffs messages for a status when
`err.status` is absent. Its `denied` regex includes `cannot`, and the Tier B
message contains "cannot be authorized for any principal" — so a Tier B refusal
that ever loses its explicit `403` would silently become a **400**. It is set
explicitly, and `requireViewer`'s message was checked against both regexes
(`requires` ≠ `required`) to confirm it really does reach 500.
