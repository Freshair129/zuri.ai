---
version: "0.1.0b"
created_at: "2026-09-06T20:00:00+07:00,RWANG,f125ff1f"
last_update: "2026-09-06T20:00:00+07:00,RWANG"
status: under review
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
native Marketing routes 2 → 5; tracking version 0.4.0b → 0.5.0b.

## Verification record

| Gate | Evidence / status |
|---|---|
| Integrated main baseline | 3,897 Vitest tests passed, 14 skipped at a7b5d9ed |
| Foundation checks | 8 tests passed: non-empty backup, private PG migration policy, navigation and warmup |
| SQLite migration | Previous full schema → additive Campaign migration: one added table, none removed, integrity OK and zero FK violations |
| Non-empty migration | Existing PlanVersion row unchanged byte-for-byte; new initiative association inserted with valid FK and default OPEN/version 1 |
| PM tracking envelope | Published JSON Schema with date formats passed; 47 items, 158 acyclic dependencies, all 100 interface mappings |
| Campaign service / browser / build / governance | Pending integrated implementation; no local completion claim yet |

Detailed command outputs live in the worktree's ignored `test-results/marketing/`.
Test fixtures and isolated migration databases are verification evidence only;
they are not a SmartGift server import.

## Tracking boundary

MKT-W1-CAMPAIGNS is IN_PROGRESS. Current plan has 3 DONE design items, 8 partial
IN_PROGRESS items and 36 PLANNED items. No additional completed weight is claimed.
The user selected SmartGift by name; instance URL and Workspace remain unresolved.
Server dry-run, import receipt and read-back have not occurred.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | under review | Record Campaign contract, foundation and pending integration gates | See git history | RWANG |
