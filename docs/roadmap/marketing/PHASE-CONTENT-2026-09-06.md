---
version: "0.1.0b"
created_at: "2026-09-06T21:40:00+07:00,RWANG,5ab8bf6a"
last_update: "2026-09-06T21:40:00+07:00,RWANG"
status: under review
superseded_by: null
attributes:
  domain: marketing
  doc_type: phase-report
  scope: "FR-157 Content and Creative"
---

# Marketing Content — phase evidence

This is the next slice of user-approved CR-018 after Campaign delivery. The
[pinned Content contract](../../domains/marketing/features/FR-157-content-creative.md)
covers MKT-UI-016/017/018/058/059/077. Complexity C-3; risk HIGH.

## Architecture and version diff

Content owns immutable creative brief/review/decision evidence and declared rights.
Files owns bytes and file fingerprints; PM owns production work and schedule.
One output file and one PM Project/WorkItem pair may be associated with a revision.
Every usable Library item requires current exact-version approval, active rights
and a revalidated authorized file. Team runtime and external publication are later gates.

Three GPT-5.6 Luna max lanes own core/API, six interfaces and the owner read adapter.
Root owns schema/backup/migration/navigation, integration and governance. All writes
are in isolated worktrees; primary checkout and production state remain untouched.
Main be9e1440 was integrated in b2656bcb; foundation is 5ab8bf6a.
PRD 1.159.0b → 1.160.0b declares FR-157/SDD-088 through the ledger writer;
charter 0.2.0b → 0.3.0b adds four Content models (Marketing models 6 → 10).
Tracking 0.5.1b → 0.6.0b starts Content, without closing Wave 1.

## Verification gates

| Gate | Evidence / status |
|---|---|
| Foundation backup and migration policy | 4 tests passed, including nonempty Content revision/review/decision restore |
| Additive SQLite migration | Previous 94-table fixture, 6 existing rows preserved; exactly 4 new tables; integrity OK, zero FK violations |
| PostgreSQL parity | Generated schema includes 98 models; private runtime RLS migration supplied, not applied to production |
| Foundation governance | PASS after tracked doc/real backup anchor: 0 critical, 0 warning |
| Full foundation tests | PASS: 3,933 passed, 14 skipped, zero failed |
| Core/adapter/UI tests | In progress in separate worktrees |
| Integrated build/browser/visual regression | Pending implementation integration |
| Final governance and tracking validation | Pending integrated delivery |

Detailed local logs and migration proof are in ignored test-results/marketing/.
No fixture is an actual SmartGift import or provider account integration.

## Tracking boundary

MKT-W1-CONTENT is IN_PROGRESS. Current plan: 4 DONE, 8 IN_PROGRESS, 35 PLANNED.
Task codes, weights, 158 dependencies and all 100 interface mappings remain fixed.
SmartGift is the requested Business by name; instance and Workspace remain
unverified. No server dry-run/import/receipt or actual PM progress is claimed.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | under review | Record approved Content foundation and open implementation gates | See git history | RWANG |
