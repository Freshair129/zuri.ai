---
doc_type: implementation-verification-record
status: reviewed
version: "0.3.0"
source_assessment_revision: "d1a3acb4f9c6827fdf3c78435e6fefb423263665"
---

# Confirmed application gap fixes

The owner authorized application fixes after committing and pushing the
[assessment](README.md). This record separates implemented behavior, local
verification and remaining external acceptance. It issues no new requirements,
product roadmap or delivery dates. Canonical IDs and source-preserved rows are
unchanged; the assessment remains a snapshot of application revision e3474ef3.

## Implemented scope

| Finding | Existing authority | Result |
|---|---|---|
| F01 scope CRUD | FR-001, FR-074/075 | Update/archive Portfolio, Tenant, Business, LegalEntity and Branch through the existing scope boundary. Strict field allowlists and optimistic version claims prevent ancestry changes, lost updates and audit after a failed claim. Workspace update/archive uses the same concurrency protection. |
| F02 responsibility | FR-135 | Asset registration/transfer requires the responsible Person's current active membership in the asset's tenant and Business. |
| F03 allocation | FR-135 | Validate positive quantity, boolean exclusivity, Project/Workstream scope and half-open overlap intervals. Allocation, return and disposal serialize on the asset version; disposed assets cannot be allocated. Disposal details persist in the actual AuditEvent payload. |
| F04 Project Inventory | FR-135 | Add the scoped read-only asset allocation projection, excluding corrupt or foreign-scope rows and leaving shared Projects without private assets. |
| F05 memory erasure | FR-232, ADR-091 D6 | Compose Identity-owned Tier-1 memory erasure into consent decline; tombstone Knowledge candidates and withdraw admitted sources through Knowledge-owned code. Candidate approval/source/ingestion/link/audit changes commit atomically, preventing a late approval from resurrecting erased material. Shared threads follow speaker/message lineage. Preserve identity, login and separate retention-purpose records. |
| F06 context composition | FR-234, SDD-100, ADR-106 | Compose public Knowledge evidence and authorized MSP slices under one budget in both Server and Runtime. Only retained data reaches the provider; persist one content-free canonical receipt before an attempt. Core verifies source/packet bindings and reserved receipt identity. Recheck API-011 private-read permissions before RESOLVED, including withdrawal after durable binding. |

Prepared RECORD slices retained by the composer reach a distinct bounded Runtime
prompt section; they are not reclassified as MSP. Empty RECORD input preserves
the legacy prompt bytes. The published operation schema enforces expressible
packet/reference conditions; executable validators enforce sibling ID/hash
parity and serialized UTF-8 limits. GKS metadata remains in the existing trace,
not in an unbudgeted provider evidence envelope.

FR-127 treats `ConversationAnalysis` as an audited CRM record. Memory-consent
decline preserves it under the existing consent-gated read/write policy;
principal erasure still deletes it. The shared-conversation reader gates by the
owning Customer, not a new per-speaker analysis policy. This patch does not
claim per-speaker CRM analysis denial implemented.

## Verification

Luna Max workers implemented non-overlapping responsibilities. An independent
Luna Max reviewer inspected the composed patch and the corrections it required.
Root integrated the changes and ran shared generators and verification. Server
Vitest runs are serialized because the proof reporter shares a cache path.

| Check | Observed result and scope |
|---|---|
| Scope CRUD and Workspace concurrency | 7/7 and 11/11 targeted tests passed; stale/lost claims write no audit. |
| Asset corrections | Red regressions followed by passing responsibility, interval, projection, return/disposal and persisted-audit checks; final changed-test run below qualifies the composed patch. |
| Schema/migration execution | 4/4 passed, including existing SQLite rows/defaults and a real disposable PostgreSQL migration/reapply check; both Prisma clients regenerated. |
| Erasure and CRM analysis | 4 files / 56 tests passed after the lifecycle correction. Candidate admission fencing and archive-write error metadata also passed their targeted regressions. |
| Final F06 consumers | 8 files / 164 tests passed. Both policy-withdrawal cases reproduced red first, then refused provider/MSP/delivery after the guard. Near-limit tests preserve full 10,000-character questions, actual UTF-8 response bounds and independently computed retained evidence. |
| Runtime | Root independently passed 86/86 Node tests and the 11-source-file boundary build. |
| PostgreSQL acceptance | Root passed all 7 configured files / 71 tests against a disposable embedded cluster. No environment-provided or deployed DB is a test target. |
| Registry/readers and shadow selector | 98/98 documentation regressions and 52/52 verification-planner regressions passed. |
| Final changed-test Server run | Root passed all 28 changed/new test files / 495 tests together on the frozen application patch; zero failed or skipped. |
| Final generation/governance/build | Registry, service map, graph, 96 views, governance and corpus checks passed. Governance reports 0 critical / 4 baseline warnings / 43 informational items. Final Server build passed. |

The independently reviewed application/Runtime freeze contains 70 changed/new
paths against d1a3acb4. Its fingerprint is
`743eeb7208b6042d337592ce7547e3ca89910ddbc5dd5120ddf63dceb18cb78d`:
SHA-256 each UTF-8 file after LF normalization, join ordinal-sorted
`path + space + digest` entries with LF and no final newline, then SHA-256 the
joined text. The reviewer independently reproduced the digest and found no
remaining P1/P2 in the reviewed patch. This binds source review; it does not
claim that the reviewer reran tests.

The broad local diagnostic was interrupted after 245 completed files. It found
seven stale assertions in `conversation-runtime-grounding.test.js` and
`conversation-runtime-legacy-parity.test.js`; those cases were corrected and
passed in the final 164-test consumer run. Earlier interrupted diagnostics are
also not full-suite passes. The newly found permission-fence defect was proved
by two failing regressions before correction. No interrupted run is labeled
PASS, and the composed local checks are not a claim that a fresh full local
Server suite completed.

The existing CI selector forces full Server qualification for the Prisma schema
and migration changes, using its four existing shards. Hosted CI belongs to the
exact pushed commit/PR checks; this local record does not duplicate mutable CI
state. Merge and release remain gated on those checks. E2E was not run locally
and is not counted as passing. The repository's lint command still opens its
first-run configuration prompt; standalone lint is NOT_CONFIGURED, not PASS.

## Remaining boundaries

- F07 and typed CRM/ERP fact read ports remain source/authority reconciliation.
  Record-only provider calls and numeric/code acceptance are not certified;
  the existing answer verifier/fallback remains Knowledge-evidence-only.
- No external MSP/GKS deletion or withdrawal is inferred from a local fake or
  durable pending state. External acknowledgement and live acceptance remain
  distinct. Direct caller fault injection for physical archive cleanup after
  rollback remains a coverage limit, although error metadata and cleanup paths
  were reviewed.
- The three additive scope fields have SQLite and PostgreSQL migrations, but
  no deployed database migration was applied. The Phase B loader binds the new
  schema digest while preserving all 208 table mappings and refusing the former
  same-count schema. Historical recovery evidence remains unchanged.
- Matching Core/Runtime revisions require the documented coordinated drain and
  rollout. Local tests do not establish old-client rolling compatibility,
  production cutover, live provider operation or deployment readiness.
- Four existing governance warnings remain: two absent candidate receipts in
  Document 20, the absent Marketing authored-verification record, and the
  synthetic FR-998 fixture edge. No requirement/receipt was invented to hide them.

## Version diff

0.2.0 → 0.3.0 records the final policy-fence correction, consumer reconciliation,
engine boundaries and exact-head CI qualification without rewriting the original
assessment or its matrix.
