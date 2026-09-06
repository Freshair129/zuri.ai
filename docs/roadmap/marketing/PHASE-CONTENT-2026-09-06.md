---
version: "0.1.1b"
created_at: "2026-09-06T21:40:00+07:00,RWANG,5ab8bf6a"
last_update: "2026-09-06T22:26:00+07:00,RWANG"
status: beta
superseded_by: null
attributes:
  domain: marketing
  doc_type: phase-report
  scope: "FR-157 Content and Creative"
---

# Marketing Content — phase evidence

The bounded Content and Creative slice is locally implemented and verified from
user-approved CR-018. Complexity C-3; risk HIGH. The
[pinned contract](../../domains/marketing/features/FR-157-content-creative.md)
covers MKT-UI-016/017/018/058/059/077.

## Delivered behavior

| Interface | Native behavior |
|---|---|
| Briefs | Business-scoped collection, working search, creation and real detail links |
| Production | Board/list projects actual authorized PM task status and dates; shared tasks retain each brief identity |
| Library | Only current approved outputs with active rights and a matching authorized source file |
| New brief | Objective, audience, message, claims, outline, acceptance and evidence; real source/rights/Project/task controls |
| Brief detail | Immutable revision/history, independent human review, exact approval/rejection/revocation and archive |
| Asset detail | Requested immutable revision, matching source/rights/review and current eligibility; historical files never substitute the newest source |

Content owns creative intent, revisions, reviews, decisions and declared rights.
Files owns bytes and file state/version/fingerprint. PM owns production work and
schedule. One output file and one Project/task pair may be bound per revision.
Approval uses exact content hash and parent CAS sequence, with expiry and live
file/rights rechecks. Human review is available; automated Team refinement and
external publication remain later gates.

## Architecture and version diff

Three GPT-5.6 Luna max lanes delivered core/API, six interfaces and owner read
adapters. Root integrated schema, additive migrations, backup, navigation,
inventories, tests and governance in isolated worktrees. The primary checkout,
production database and external provider accounts were not modified.

Main be9e1440 was integrated in b2656bcb. Foundation is 5ab8bf6a, sequence schema
bbcb5dcc, adapter f2b9228e, core 1d132170, historical-source correction a760e520,
and final UI correction 57483225. Final report/graph commit is in git history.

- Content contract 0.1.1b → 0.1.2b clarifies selected-version references and phase precedence.
- PRD 1.159.0b → 1.160.0b introduced FR-157/SDD-088 through the ledger writer; 1.160.1b records local proof, with subjects unchanged.
- Charter 0.2.0b → 0.3.0b adds four Content models; 98 total models, 1,277 columns.
- Interface Inventory 1.7.0b → 1.8.0b: four additional route shapes, six interfaces; 69 page routes and 34 operational navigation entries.
- API Appendix 1.43.0b → 1.44.0b: four handlers/six operations; 165 paths and 218 operations in the machine inventory.
- Tracking 0.6.0b → 0.6.1b closes only MKT-W1-CONTENT; full Wave 1 remains open.

## Verification gates

| Gate | Evidence |
|---|---|
| Full integrated tests | 3,971 passed, 14 skipped, zero failures; after core corrections and before final bounded UI corrections |
| Final affected tests | 16 passed: Content UI, navigation, warmup and canonical backup restore/read |
| Existing browser regression | 106 passed, 4 skipped, zero flaky; all specs except Content, isolated root port 3148 |
| Content browser | 3 passed: shared warmup plus two authenticated lifecycle/mobile cases, zero flaky, on final root port 3148; independently passed on 3117 |
| Combined browser coverage | 108 unique passing cases and 4 skipped; the warmup passed in both cohorts and is counted once here |
| Final build | PASS after all source corrections, without a concurrent dev server in the same tree |
| Visual/accessibility | Reviewed desktop 1280x720 and mobile 390x844 screenshots; no horizontal overflow/page errors; keyboard End preserves active-tab focus |
| Nonempty backup | All four Content tables restore in FK order; canonical payload/hash and review/decision evidence remain readable through the service |
| Additive SQLite migration | Previous 94-table fixture: all 6 existing rows unchanged; exactly 4 new tables; integrity OK, zero FK violations |
| PostgreSQL parity | Generated 98-model schema and private runtime RLS migration supplied; not applied to production |
| Plan contract | Strict JSON Schema PASS; 47 tasks, 158 acyclic dependencies, 100 unique interface mappings |
| Final governance | PASS: 0 critical, 0 warning; 23 existing baseline INFO notices |

The Content browser cases use real application APIs and controls for source and
PM selection, revision 2/history, independent review, approval, Library-to-asset
navigation and revocation. Fixtures are synthetic; no live SmartGift import or
provider integration is implied. Detailed logs, migration proofs and screenshots
remain under ignored test-results/marketing/.

## Findings closed before delivery

[Integration RCA](../../../.brain/rca/2026-09-06-content-integration-inventories.md)
records the missing OpenAPI paths, duplicated PM enum, null decision fields and
keyboard remount cause. Full tests initially caught the route omission; governance
caught the enum copy. Neither gate was weakened.

[Historical-source RCA](../../../.brain/rca/2026-09-06-marketing-content-asset-reference-projection.md)
records why asset detail incorrectly selected the newest source for an old version.
Regressions cover distinct old/current files and rights, quarantined/deleted old
sources, review hash mismatch, phase precedence and sequence-only authority.
Independent architecture review found the core corrections resolved those findings;
the final UI consumes the requested-version references without a current-source fallback.

## Tracking and release boundary

MKT-W1-CONTENT is locally DONE. The plan now contains 5 DONE, 7 IN_PROGRESS and
35 PLANNED items. Codes, weights, 158 dependencies and all 100 interface mappings
are preserved. Task counts are not an actual PM progress percentage.

SmartGift is the requested Business name; instance/session and Workspace remain
unverified. No server dry-run, transactional plan import or receipt exists.
Production migration, CI/release, provider account activation and automated Team
runtime are separate open gates. This phase does not close full Marketing delivery.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | under review | Record approved Content foundation and open implementation gates | See git history | RWANG |
| 0.1.1b | 2026-09-06 | beta | Record six locally verified interfaces, RCA corrections and bounded task completion | See git history | RWANG |
