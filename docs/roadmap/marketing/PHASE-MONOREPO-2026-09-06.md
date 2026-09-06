---
version: "0.1.1b"
created_at: "2026-09-06T22:35:00+07:00,RWANG,3f4fd4d2"
last_update: "2026-09-06T23:04:00+07:00,RWANG"
status: beta
superseded_by: null
attributes:
  domain: marketing
  doc_type: phase-report
---

# Marketing continuation on the published monorepo

Operations is the next approved Marketing slice. Before adding code, fetched main
5ab5df9f requires reconciliation: ADR-062 relocates Server into apps/server, and
Warehouse publishes IDs that this unpublished Marketing branch had independently
allocated. Complexity C-3, risk HIGH; user continuation covers this prerequisite.
No product scope, execution mode, permission, external action or production data changes.

## Plan and acceptance

1. Preserve published Warehouse subjects; move only this branch's unpublished IDs
   through the ledger writer's documented abandon path.
2. Merge main with rename-aware Git handling. Server code/tests/Prisma/migrations
   follow apps/server; canonical Marketing documents remain under root docs.
3. Regenerate ledgers/graphs with their owner tools, then validate Server tests,
   build, browser and combined governance. Preserve Edge snapshot provenance;
   never read device secrets or mutate the original Edge checkout.
4. Resume Operations only against the reconciled paths/contracts. Do not mark new
   Operations interfaces delivered merely because this integration passed.

| Previous unpublished Marketing ID | New Marketing ID | Published main authority retained |
|---|---|---|
| FR-154 PM handoff | FR-158 | FR-154 Inventory catalogue |
| FR-155 Strategy | FR-159 | FR-155 Inventory stock ledger |
| FR-156 Campaign | FR-160 | FR-156 Recipe / bill of materials |
| FEAT-020 Marketing | FEAT-021 | FEAT-020 Inventory |

FR-157 Content and SDD-086/087/088 remain unchanged. Historical validation in
previous phase reports remains evidence for its original commits, not proof that
the newly merged checkout passes. Local tracking remains 5 DONE /7 IN_PROGRESS/
35 PLANNED until another bounded capability is verified. SmartGift intake remains
unbound and has no actual server import receipt.

## Evidence

Main 5ab5df9f is reconciled locally with the Marketing branch. The merger retains
all ten Marketing and twelve Inventory models; Prisma SQLite/Postgres clients
regenerate successfully. Marketing code and tests now live under apps/server.

| Gate | Verified evidence |
|---|---|
| Server focused integration | 140 passing tests across 23 files |
| Server full suite after migration correction | 4,009 passed, 14 existing skipped, zero failed |
| Migration identity and policy regression | 6 passed; unpublished Content moved from 20260906230000 to 20260906234000 in both stores; SQL unchanged |
| Server production build | PASS; 70 page routes |
| Edge snapshot | Build and typecheck PASS; 913 tests passed, 3 existing opt-in skips |
| Interface and API enumeration | 70 pages; 11 operational domains; 35 navigation entries; 179 API paths / 243 operations |
| Schema and migration coverage | 110 models; 1,418 columns; 48 migration files across the checked trees |
| Combined governance | PASS: zero critical/warnings, 23 baseline INFO; zero duplicate IDs/dangling links |
| Browser | Final full run: 109 passed, 4 existing skipped, zero failed/flaky; includes both Content flows after FR-058 file fixtures |
| Plan review | 47 items, 158 acyclic dependencies, 100 unique interface mappings; weights/statuses unchanged |

The full-suite gates caught two integration defects before publication:
[duplicate migration identity](../../../.brain/rca/2026-09-06-marketing-monorepo-migration-version.md)
and [Content browser fixture eligibility](../../../.brain/rca/2026-09-06-marketing-content-browser-source-fixture.md).
The production Content fingerprint check was correct and remains unchanged.

Desktop 1280×720 and mobile 390×844 Content screenshots were reviewed; page links,
review/approval lifecycle, production references and scoped controls passed.

Evidence logs are local ignored files under test-results/marketing/monorepo-*.log;
the Edge test/typecheck results were independently reported by the Luna max agent.
No release, push, production migration or provider action was performed.

## Next bounded work

MKT-W1-OPERATIONS remains PLANNED: Intake, Calendar, Approvals and Handoffs plus
new intake, intake detail and handoff detail (seven approved interfaces, four route
shapes). Calendar must consume the protected PM roadmap owner port. Handoff detail
must use validated Marketing-to-PM receipt projection; no duplicate task, stock or
conversation records. Integration completion does not change those task statuses.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | under review | Record required published-main path and ID reconciliation | See git history | RWANG |

| 0.1.1b | 2026-09-06 | beta | Record integrated Server/Edge checks, migration and browser fixture RCA corrections; Operations stays planned | See git history | RWANG |

Version diff 0.1.0b → 0.1.1b: prerequisite integration verified; tracking 0.6.1b → 0.6.2b adds integration evidence without closing an Operations task.
