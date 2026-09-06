---
version: "0.1.1b"
created_at: "2026-09-06T20:00:00+07:00,RWANG,f125ff1f"
last_update: "2026-09-06T21:03:55+07:00,RWANG"
status: beta
superseded_by: null
attributes:
  domain: marketing
  doc_type: phase-report
  scope: "FR-156 Campaign initiative and receipt-bound PM execution projection"
---

# Marketing Campaigns — phase evidence

This continuation implements the Campaign slice of the already approved
[Marketing design](../../change-requests/CR-018-MARKETING-DOMAIN-DESIGN.md).
The binding [FR-156 contract](../../domains/marketing/features/FR-156-campaign-initiatives.md)
covers seven interfaces, MKT-UI-006–011 and MKT-UI-076. It does not close the full
Marketing domain, provider ingestion or automated Team refinement.
Complexity C-3; risk HIGH: persistence and cross-domain authorization.

## Architecture and version diff

Campaign has a distinct internal initiative UUID and one Strategy plan. Its
date/offer/condition brief extension is included in immutable reviewed content.
Existing Strategy hashes are preserved by keeping absent extensions absent.
The selected persisted handoff is explicit; authorized PM roadmap data supplies
Plan and Timeline. Results remains unavailable without measurement evidence.
Closure records a reason and affects the Marketing initiative only.

Three GPT-5.6 Luna max agents work in separate core, UI and PM read-adapter
worktrees. Root owns schema, migration/backup, navigation, registries and final
verification. Primary checkout is reference-only. No production database or
provider account is changed.

Main published FR-153 for LINE LIFF while this branch's Strategy declaration was
unpublished. The branch moved Strategy to FR-155 before merging main, preserving
the published LINE meaning; FR-154 remains PM handoff. FR-156/SDD-087 are new
Campaign declarations, recorded through the ledger writer. No published ID was
reassigned. PRD version 1.158.0b → 1.159.0b adds Campaign; Marketing tables 5 → 6;
native Marketing routes 2 → 5; tracking version 0.5.0b → 0.5.1b.

## Verification record

| Gate | Evidence / status |
|---|---|
| Integrated main baseline | 3,897 Vitest tests passed, 14 skipped at a7b5d9ed |
| Foundation checks | 8 tests passed: non-empty backup, private PG migration policy, navigation and warmup |
| SQLite migration | Previous full schema → additive Campaign migration: one added table, none removed, integrity OK and zero FK violations |
| Non-empty migration | Existing PlanVersion row unchanged byte-for-byte; new initiative association inserted with valid FK and default OPEN/version 1 |
| PM tracking envelope | Published JSON Schema with date formats passed; 47 items, 158 acyclic dependencies, all 100 interface mappings |
| Focused service checks | 25 tests passed across Campaign integration, contract, route and Strategy compatibility coverage |
| Full integrated tests | 3,930 passed, 14 skipped, zero failed; 467 passing test files / 4 skipped |
| Integrated build | PASS after final schema reconciliation; campaign-build-final.log |
| Focused browser | After final link fix: 3 passed (warmup + 2 Campaign journeys), no retries; prior combined Strategy/Campaign 8 passed |
| Visual and keyboard | PASS: desktop 1440px and mobile 390px; List/Board/form/detail, detail tabs with End/ArrowLeft, no horizontal overflow or page errors |
| Full browser regression | PASS: 106 passed, 4 skipped, zero failed/flaky; isolated 3148 database, fail-on-flaky enabled |
| Governance | PASS after final schema reconciliation: 0 critical, 0 warning, 23 baseline INFO |

Full testing first caught a duplicate migration prefix and working-copy CRLF
schema drift. Campaign migration moved to the free `20260906220000` prefix, its
SQL stayed unchanged, and canonical PostgreSQL generation added the Campaign
model/inverse relations. The second full test run passed. [RCA](../../../.brain/rca/2026-09-06-marketing-campaign-schema-integration.md).
Receipt projections now use the same authorized PM adapter for list phase,
selection and detail; a restored fixture without PM import provenance is retained
in backup but correctly unavailable in the Campaign projection. [RCA](../../../.brain/rca/2026-09-06-marketing-campaign-receipt-projection.md).

The final browser review found collection links using an API URL. The page helper
now has a distinct name; browser tests activate both List and Board links before
asserting the Brief page. [RCA](../../../.brain/rca/2026-09-06-marketing-campaign-link-target.md).
Hinted/select labels in the browser test now match real accessible names; no
application authorization rule or test timeout was weakened.
[RCA](../../../.brain/rca/2026-09-06-marketing-campaign-e2e-locator.md).
After that UI correction, 16 Strategy/Campaign unit tests and the production build
passed again. The 3,930-test full run predates only this bounded navigation fix.

The first full browser run had 105 passes, 4 skips and one obsolete search
expectation treating Campaigns as reserved. The corrected assertion retains the
Commerce exclusion and proves Campaign navigation; the next full run passed.
[RCA](../../../.brain/rca/2026-09-06-marketing-campaign-search-regression.md).
Final application integration is e44d482b; schema reconciliation is 1fd2e75e.
Visual evidence is retained locally in test-results/marketing/campaign-visuals/.

Detailed command outputs live in the worktree's ignored `test-results/marketing/`.
Test fixtures and isolated migration databases are verification evidence only;
they are not a SmartGift server import.

## Tracking boundary

MKT-W1-CAMPAIGNS is DONE against its bounded initiative/PM identity acceptance.
Current plan has 4 DONE items (3 design, 1 Campaign), 7 partial IN_PROGRESS and
36 PLANNED items. Wave 1 gates remain open. These are local delivery records,
not a server-calculated PM progress percentage.
The user selected SmartGift by name; instance URL and Workspace remain unresolved.
Server dry-run, import receipt and read-back have not occurred.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | under review | Record Campaign contract, foundation and pending integration gates | See git history | RWANG |
| 0.1.1b | 2026-09-06 | beta | Record final local Campaign verification, corrected navigation checks and bounded task completion | See git history | RWANG |
