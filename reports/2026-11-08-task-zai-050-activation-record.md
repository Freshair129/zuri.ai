---
record: TASK-ZAI-050 production activation
title: TASK-ZAI-050 production activation record skeleton
doc_type: verification-evidence
version: "0.2.0"
status: draft
activation_status: PREPARED_NOT_EXECUTED
prepared_at: "2026-11-08"
last_update: "2026-11-17"
prior_art:
  - docs/plans/GENESISRAG17-EDGE-DEPLOYMENT.md
  - .brain/reports/2026-09-27-task-zai-050-dod-review.md
  - docs/decisions/ADR-119-REMOVE-SMARTGIFT-AND-GOVIBE-FROM-ZURI.md
---

# TASK-ZAI-050 — Production activation record skeleton

This is a blank operator record. P1 did not access the production host, inspect
production credentials, apply migrations, activate a runtime, publish a corpus,
or switch a LINE account. ADR-119 later superseded the SmartGift/ADR-075 scope. Complete the fields below only from a future authorized
production-host operation on an independently authorized in-scope target, and retain its source artifacts. No Business/account target is selected here.

## Historical attributed evidence

MSP §6 at revision `520ac7109b032d11a6b15b87720b58380173ba7f` records
operator-attested evidence dated 2026-10-24: d0 image qualification, restored
canary, production publication/query/denial/persistence, and 42/42 tests in the
composed MSP acceptance image. The underlying private artifacts were not inspected
for this record. This is historical MSP evidence, not current Zuri-source or
production-host proof and not TASK-ZAI-050 DoD completion.

## Current production evidence — all NOT_VERIFIED

| Field | Value / evidence pointer |
|---|---|
| Production host, operator identity, date/time and Bangkok timezone | `NOT_VERIFIED` |
| Zuri web image digest, release label and source revision | `NOT_VERIFIED` |
| MSP, GKS and GenesisBlock image digests/source revisions and embedded pins | `NOT_VERIFIED` |
| Runtime ownership, service health and active transport | `NOT_VERIFIED` |
| Four TASK-ZAI-050 knowledge migration ledger rows and apply dates | `NOT_VERIFIED` |
| Backup identity and isolated restore evidence | `NOT_VERIFIED` |
| Separately authorized in-scope Business document ID, source version and admission record | `NOT_VERIFIED` |
| Qualified publication receipt, generation and evidence hash for the separately authorized target | `NOT_VERIFIED` |
| Real Business-document query, cited answer, run ID and receipt hash | `NOT_VERIFIED` |
| Production model/provider readiness and real LINE delivery | `NOT_VERIFIED` |
| Separately authorized LINE Business/account scope, persisted authority and current mode/version | `NOT_VERIFIED` |
| Activation action, actor, audit event and migration-note reference | `NOT_VERIFIED` |
| Recovery/rollback action, actor, audit event and verified restored state | `NOT_VERIFIED` |

## Task state and approvals

- Acceptance criterion: **unchecked**; production migration-ledger rows are not verified.
- Success criterion: **unchecked**; activation, publication receipt and cited query are not verified.
- Exit criterion: **unchecked**; it requires one real, separately authorized in-scope Business document admitted,
  published, queried and cited on production. No target is selected here; the fixed/synthetic corpus is not a substitute.
- Named approver remains `Owen`. Owen-named approval: pending — not exercised in P1; requires production-host evidence.

No field in this skeleton records a completed activation. Attach exact production
receipts and operator evidence before changing task criteria or status.
