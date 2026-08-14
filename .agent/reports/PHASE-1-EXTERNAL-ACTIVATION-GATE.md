---
version: "0.1.0b"
created_at: "2026-08-14T09:10:00+07:00,ATHER"
last_update: "2026-08-14T09:10:00+07:00,ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "line-ai"
  doc_type: "phase-report"
  scope: "ZV2-CR-006 A0-A4 read-only activation gate"
---

# Phase 1 external activation gate packet

## Outcome

W0 and the three parallel W1 audits are complete and independently reviewed. The preparation
packet passes, but production activation is **BLOCKED**. A5-A8 remain `NOT_RUN` or `BLOCKED`.

No production query or mutation, credential access, binding change, provider request or LINE call
occurred. The last known binding state is historical evidence only and was not promoted to current
truth.

## DIG status

The frozen graph is acyclic. A1-A3 were safe to run in parallel. A5 depends on corrected and
approved A1/A2 evidence. A6 is the hard join of A2-A5; A7 and A8 are strictly serial after it.

| Node | Size | Status | Reviewed evidence |
|---|---:|---|---|
| A0 DIG/authority | S | PASS | 720 nodes / 1333 edges / 0 dangling at freeze |
| A1 production corpus mapping | M | BLOCKED | audit PASS_WITH_WARN; no positive case maps to approved rows |
| A2 live isolation prerequisites | M | BLOCKED | review confirms SQL type defect and absent live prerequisites |
| A3 canary/receipt/recovery prerequisites | M | BLOCKED | review confirms missing controlled paths/evidence |
| A4 cross-lane integration | S | PASS_WITH_WARNINGS | findings agree; historical/live states separated |
| A5 real evaluation/live isolation | L | NOT_RUN | predecessors blocked |
| A6 controlled binding activation | L | BLOCKED | hard join not satisfied |
| A7 signed canary | M | NOT_RUN | A6 not satisfied |
| A8 Phase 1 acceptance | S | BLOCKED | no truthful live receipt |

## Confirmed blockers

1. The Golden corpus is a placeholder: all 14 positive cases reference seven `SG-*` codes absent
   from the approved 74-row artifact. All seven numeric allowlists lack support in the approved
   code/name/category-only dataset.
2. The runtime isolation probe compares production `text` columns with `uuid` parameters. The RCA
   is `.brain/rca/2026-08-14-runtime-isolation-probe-id-cast.md`; live execution is prohibited until
   reviewed remediation and a PostgreSQL-backed contract test exist.
3. A dedicated unprivileged runtime credential and fresh live isolation report are unavailable in
   this execution context.
4. Historical evidence says PITR is disabled and provider physical backups are unavailable. This
   is not fresh approval and no rollback rehearsal artifact exists.
5. No reviewed secret-safe path exists to install binding destination/credential hashes and enable
   exactly one canary.
6. No redacted post-LINE receipt artifact exists; current schema ends at dry-run
   `EVIDENCE_VERIFIED`.
7. Exact destination, approved provider/model and pinned external `zuri-cli` canary evidence remain
   operator inputs and may not be inferred.

## Verification

| Check | Result |
|---|---|
| Independent review A1 | PASS_WITH_WARN; gate BLOCKED |
| Independent review A2 | WARN; gate BLOCKED/NOT_RUN |
| Independent review A3 | PASS_WITH_WARNINGS; A6/A7 BLOCKED |
| Focused local tests | PASS — 3 files / 26 tests |
| Production provider/database/LINE | NOT_RUN |

Supabase's current guidance still supports the chosen boundary: use a dedicated service role/login,
least privilege and RLS; physical backups/PITR and restoration readiness must be verified as real
provider state, not inferred from local code.

## Required approval before code remediation

Approve the RCA and this gate packet to open the next bounded change:

1. correct the probe SQL to the deployed `text` contract and add a PostgreSQL-backed regression;
2. define the owner-approved 20-case production corpus mapping;
3. specify a secret-safe binding installer and redacted live receipt contract; and
4. keep remote execution disabled until recovery, credential, destination and provider gates pass.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | beta | W0-W1 read-only audit and cross-review complete; external activation blocked | working-tree | ATHER |
