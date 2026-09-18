---
title: Project Feature Phase B integration report
version: "0.2.0b"
status: beta
created_at: "2026-09-17T19:22:04+07:00,RWANG,base 052821a7 and 892f23f3"
last_update: "2026-09-17T20:28:51+07:00,RWANG"
attributes:
  domain: project-manager
  scope: FR-252 and separately approved CRM transaction closure
  complexity: C-3
  risk: HIGH
  evidence_level: local-and-isolated-provider
---

# Project Feature Phase B — integration report

## Scope and authority

The owner approved Phase B implementation and the Luna Max worker / independent
Luna Max verify / root integration workflow. The separate CRM closure proposal
v0.1.0b was approved with "อนุมัติแก้ CRM ตามข้อเสนอ". No repeated approval is
pending for either implementation scope.

Phase B adds explicit Project Feature authority, Domain contributions, WorkItem
allocation, requirement bindings, verified Governance Snapshots, mutation
receipts, CSRF-protected writers and the Project Feature UI. Domain View
(FR-251) and Feature View (FR-252) remain separate projections. It does not
implement the entire future Workforce, Agent Fleet or Provider Registry design.

The CRM correction places hold and audit in one transaction and serializes hold
and archive-key destruction through the existing Customer row. A logical no-op
row update creates an MVCC conflict for stale Serializable transactions. Existing
503 error shape is retained; CRM has no schema, route or role expansion.

The integration starts at local W1/W2 commit `052821a7` and main `892f23f3`.
Current upstream `0c7fd884` adds only the production cold-archive compose
overlay; final composition will retain it. No production service, database,
archive mount or environment file was changed during these checks.

## Provider evidence retained with this report

| Gate | Result | Scope and portable evidence |
|---|---|---|
| CRM hold/audit and key destruction | 14 PASS; independent Luna Max PASS | [Frozen PostgreSQL proof](fr252-phase-b/phase-b-crm-postgres-proof.json): actual CRM/Identity service paths, lock ordering, stale-snapshot refusal, rollback and tenant refusal. |
| Feature mutation authority | 19 PASS; independent Luna Max PASS | [Frozen PostgreSQL proof](fr252-phase-b/phase-b-w4-authority-expiry-postgres-proof.json): lock waits, post-lock Session/grant expiry, CAS, idempotency, graph and rollback. |
| Current Feature read services | 18 PASS | [Current frozen PostgreSQL proof](fr252-phase-b/phase-b-w3-current-postgres-proof.json): scoped reads, unbound/deduplicated Work counts, default evidence port, pagination, refusal and no writes. |
| 177-model offline recovery | 22 positive + 15 adversarial PASS | [Frozen CLI proof](fr252-phase-b/phase-b-integrated-final-cli-proof.json): exact six PM and two Pricing families, reviewed inclusion/exclusion inventory and clean-target restoration. |

These runs use a task-owned PostgreSQL 17 container on loopback with synthetic
data and a non-superuser, non-RLS-bypass fixture login. They do not establish
production grants, public HTTP contention behavior or deployment readiness.
The older 175-model recovery and pre-composition read proofs remain historical.

## Local composition evidence

- Final full Server suite after the focus correction: **6376 PASS, 32 SKIP,
  zero failures** (752 passing files and six skipped files).
- Final optimized Server build: **PASS**, including compile, lint/type and
  static-page generation checks.
- Selected browser coverage: **45 checks passed in the composed run**, including
  warmup, while one privacy fixture failed. After its one-line locator fix,
  **two targeted privacy tests passed** (one is a repeat of an earlier pass).
  All 45 selected product cases therefore have passing execution evidence on
  identical product code; the failed combined run remains FAIL. There are zero
  skips or flaky outcomes. Coverage includes FR-250 navigation, existing navigation
  reachability, FR-251 Domain View, FR-252 Feature reads and owner mutations.
  This includes unmocked browser/CSRF/API/SQLite CRUD, uncertain in-flight intent
  retention across closure and another save, exact reconciliation identity,
  aggregate/detail refusal privacy, keyboard focus and 390px layout.
- Source inventory: **2266 source, test, schema and configuration files**
  remained unchanged from before the final Server run through the 45-pass/one-fail
  browser run. Only the privacy browser-test locator changed before the targeted
  recheck; product, schema and other test source stayed identical. The targeted
  run also has an unchanged before/after inventory.
- Independent Luna Max reviews: frozen CRM and PM provider proofs PASS; the
  [UI source review](fr252-phase-b/phase-b-w5-ui-final-review.md) is supplemented by
  the later [focus/fixture follow-up](fr252-phase-b/phase-b-w5-focus-followup-review.md),
  which identifies the current Forms and View hashes. These static reviews do
  not claim to have run root's browser commands.
- Current focused security/API/read/provenance/Swagger: 111 tests in twelve
  files plus eleven Identity tests in two files; Forms/picker coverage is 25/25
  and is also included in the full suite above.
- Edge TypeScript build and 54 Project/Work/conversation contract tests pass.
- Final governance and corpus verification are recorded below after the
  canonical documentation reconciliation.

Machine-readable counts, source hashes and raw-report digests are retained in
[local verification](fr252-phase-b/phase-b-local-verification.json). Provider
proofs above remain synthetic loopback evidence, separate from production.

### Preserved unsuccessful attempts

The first W5 mocked DELETE receipt had the wrong HTTP method; strict product
receipt validation was retained. The first full composed browser run later
finished with 42 pass and four failures: an actual nested-dialog focus return
defect, a supporting-Domain fixture selecting the primary Domain, an untyped
503 fixture expecting a typed refusal, and a page-wide positive privacy locator
matching both the row and drawer. The source correction and three test repairs
retain the original security, uncertain-intent and focus requirements.
That failed run's trace/screenshot archive has SHA-256
B28A38D2D6C40260F2A6073A8684C6F899217632755FCEF1BFB58C9EC64BB6F6.
Historical failed and terminated runs are not reclassified as passing runs.

## Remaining release gates

The local implementation, independent reviews and final governance gate are complete. Hosted CI, exact merge revision, production migration
dry-run, actual runtime grants and production smoke evidence remain separate.
No Phase B implementation is deployed. The wider Workforce, Agent Fleet and
Provider Registry design remains outside this delivered slice.

## Version diff

0.1.0b → 0.2.0b: record frozen final Server/build/browser evidence and independent
focus closure; retain failed attempts and hosted/production boundaries.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.2.0b | 2026-09-17 | beta | Close frozen local implementation and independent gates while retaining actual failed-run evidence and release limits | 052821a7 + 892f23f3 | RWANG |
| 0.1.0b | 2026-09-17 | under review | Assemble local and isolated-provider evidence before final UI freeze | 052821a7 + 892f23f3 | RWANG |

## Final governance gate

Governance passes with zero CRITICAL, one existing warning and 24 INFO findings.
The generated LLM corpus is current. Both bundled runtime projections remain
byte-identical after final document reconciliation, so the recorded optimized
build uses the same runtime inputs. No ignored generated corpus or diagnostic
log is force-added to the implementation commit.
