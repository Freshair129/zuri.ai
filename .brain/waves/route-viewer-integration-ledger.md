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

## Worker worktree setup protocol

1. Spawn with `isolation: "worktree"`.
2. `cp ../zuri-ai/.env .env` — `.env` is gitignored, absent from a fresh
   worktree, and vitest reports "Environment variables loaded from .env" when it
   is there.
3. `npm install --no-audit --no-fund` (~64s). **Not** a junction — see C1.
4. `npm test` and `npm run build` only. Never `test:e2e`, `govern` or `verify` —
   all three are singletons owned by the integrator.

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
| Architect | 🔄 running | fable5 | `.brain/waves/route-viewer-design.md` |
| Wave 0 (serial, lands first) | ⏸ | controller | helper + FR-072 row + pre-threaded shared tests |
| Workers ×3 | ⏸ | sonnet | one wave each, own worktree |
| Verify gates | ⏸ | opus | per wave |
| Integration | ⏸ | controller + opus | baseline −19, `govern` ×1, `verify` ×1 |
