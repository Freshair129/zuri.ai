---
id: QA:PM-PHASE-B-CRM-INDEPENDENT-REVIEW
title: Independent review of Project Manager Phase B CRM PostgreSQL closure
version: "0.1.2b"
status: beta
created_at: "2026-09-17T18:12:41+07:00,Luna Max"
last_update: "2026-09-17T18:25:00+07:00,Luna Max"
superseded_by: null
attributes:
  doc_type: verification-report
  domain: crm
  scope: SEC-034 legal-hold and CustomerArchiveKey erasure serialization
  complexity: "C-3 / HIGH"
  evidence_level: "INDEPENDENT SOURCE REVIEW plus ISOLATED LOOPBACK POSTGRESQL 17"
relations:
  - type: references
    target: QA:PM-PHASE-B-CRM-CLOSURE-PROPOSAL
  - type: references
    target: QA:PM-PHASE-B-CRM-CLOSURE-HANDOFF
  - type: references
    target: QA:PM-PHASE-B-CRM-POSTGRES-PROOF
  - type: references
    target: ZAI:RCA-2026-09-17-CRM-HOLD-AUDIT-ATOMICITY
---

# Verdict

**PASS for the bounded isolated PostgreSQL closure, with synthetic-lab limits.**
The pre-fix P1 stale-snapshot race reproduced in attempt 06. The frozen source
fix now causes the same transaction to receive PostgreSQL `40001`, which is
mapped to the existing 503/retryable transaction error; the post-fix attempt 12
passed all 14 cases, including logical Customer-field preservation around a
hold-only operation.

# Reviewed source and contract boundary

Reviewed against the approved CRM closure proposal/handoff, `SEC-034`,
`SEC-031`, `ADR-093 D6`, the CRM charter, and the integrated source baseline
`052821a79a5c3c9bc0f2c841068c5a07de53db36`; final source hashes are listed
below:

- `apps/server/src/modules/crm/chat-evidence-archive-service.js`
- `apps/server/src/modules/crm/chat-evidence-legal-hold-service.js`
- `apps/server/src/modules/crm/chat-evidence-archive-expiry-service.js`
- `apps/server/src/modules/identity/erase-principal.js`
- `apps/server/tests/integration/crm-archive-legal-hold.test.js`

The shared helper at `chat-evidence-archive-service.js:557-618` rejects an
unknown provider, requires a transaction boundary, binds the Customer to
Tenant, acquires PostgreSQL `FOR UPDATE`, marks the parent row with
`UPDATE ... SET "id" = "id" ... RETURNING "id"`, validates the marker result,
and maps only known serialization/deadlock or SQLite lock codes to the
existing retryable transaction error. The hold path at
`chat-evidence-legal-hold-service.js:114-153` inserts the hold and
`LEGAL_HOLD_RECORDED` audit through that boundary. The key path at
`chat-evidence-archive-service.js:637-646` checks the active hold and deletes
the scoped key inside the callback. Identity calls that seam at
`erase-principal.js:190-195` using the containing transaction; expiry reuses
the central seam.

# Resolved P1-CRM-STALE-SERIALIZABLE-HOLD

## Pre-fix evidence

The pre-fix real-service failure is recorded in
`phase-b-crm-postgres-proof-attempt-06.json` and `.log`. A runtime
`Serializable` transaction established its snapshot with an audit count before
waiting on the tenant-bound Customer lock. An administrator `ReadCommitted`
blocker held that lock, then called the actual `recordCustomerLegalHold` with
its transaction client and committed an active hold plus its audit. The runtime
transaction acquired the lock, read the hold relation from its stale snapshot,
returned `{destroyed:true, hold:null}`, deleted the archive key, and committed.
The final database contained the active hold but no key. This was a concrete
source-level data-integrity failure, not a direct-fixture-only result.

## Post-fix verification

The parent-row marker runs immediately after the lock on both actual hold and
key writers and before any child decision/read. In the same interleaving,
PostgreSQL raised SQLSTATE `40001` (`could not serialize access due to
concurrent update`). The helper surfaced
`ARCHIVE_CUSTOMER_LOCK_UNAVAILABLE` with status 503 and `retryable: true`,
retaining the raw provider cause. The supplied transaction rolled back, and
the key and hold remained consistent. The hold-only lock case compared every
logical Customer column before and after the marker and found no change.

The final proof is `phase-b-crm-postgres-proof-attempt-12.json` and `.log`:
14/14 cases passed, including the runtime non-bypass role, persisted owner
Membership, both lock winner orders, hold/audit rollback, cross-tenant redacted
refusal, Identity key deletion, Identity late-audit rollback, and source hash
stability.

# Closure assessment

The observed P1 is closed for this provider/transaction boundary because:

1. both actual service writers execute the marker before child decisions;
2. known PostgreSQL `40001`/`40P01`, Prisma `P2034`, and SQLite busy/locked
   codes map to the existing `ARCHIVE_CUSTOMER_LOCK_UNAVAILABLE` 503/retryable
   error, while unexpected audit/domain errors propagate unchanged;
3. the full supplied transaction rolls back, with no partial hold, key, or
   audit state; and
4. ReadCommitted lock winner behavior and logical Customer fields remain
   unchanged in the bounded proof.

No automatic retry was added. Public HTTP serialization-error mapping,
production role configuration, deployment, and production credentials remain
outside this independent loopback proof.

# Limits and non-findings

This is isolated PostgreSQL evidence only. The runtime role is a local fixture
role, and all scope rows, barriers, and databases are synthetic and dropped
after each run. The proof does not establish production grants, deployment,
public HTTP session transport, or production provider settings. The Node
harness now exits nonzero for semantic failure and exited 0 for the final
14/14 run; consumers should retain the JSON/log as the detailed evidence.

No unrelated CRM inventory or source changes were reviewed. No source,
schema, migration, route, or production file was edited by this verifier.

# Final hashes

| File | SHA-256 |
|---|---|
| `chat-evidence-archive-service.js` | `E69F9BBAF24A542E477094A9288B5C1F4291110B399B45B6D5B882B274364FC6` |
| `chat-evidence-legal-hold-service.js` | `497B14471D6C2FA4BB3D461A6B36F94F658C378605E19ABE94FCBCB1D21DB32F` |
| `erase-principal.js` | `4F846153BFB85ECE34C5243ECAF16C026224D8913979F6D5DCAF03667E6124F7` |
| `chat-evidence-archive-expiry-service.js` | `E7553595A396574F7EB2F8481F3480BA0B96B8E091FAC8011324E7EDEFE63843` |
| `crm-archive-legal-hold.test.js` | `28CA55DACF15D714F29593819E14D73C90313AE0205CBBA4FA75DEC4B23364F2` |
| `phase-b-crm-postgres.cjs` | `F51F97B69C4423F4047C64B7F28CAF0A0D04486CA1E75BB54EEEB0E0041F49CF` |
| `phase-b-crm-postgres-proof-attempt-12.json` | `D3F8BACB56816F87888BA60F23B876C5B6A6E4A4C7A59A4EF77081507D70A2FB` |
| `phase-b-crm-postgres-proof-attempt-12.log` | `E1EA6A7B9729B904691906743A4521DED397A54AEBB329279DBD0033C70BE4C0` |

# CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | need review | Independent source and real-service PostgreSQL gate; stale Serializable hold/key race is P1 | 052821a79a5c3c9bc0f2c841068c5a07de53db36 | Luna Max |
| 0.1.1b | 2026-09-17 | beta | Parent-row MVCC marker verified; real-service PostgreSQL closure 14/14 | working tree | Luna Max |
| 0.1.2b | 2026-09-17 | beta | Existing 503/retryable conflict wrapper and semantic harness exit guard verified | working tree | Luna Max |
