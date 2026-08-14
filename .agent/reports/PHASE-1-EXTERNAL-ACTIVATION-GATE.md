---
version: "0.3.1b"
created_at: "2026-08-14T09:10:00+07:00,ATHER"
last_update: "2026-08-14T11:40:00+07:00,ATHER"
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

One secret-redacted live production isolation probe ran with the dedicated runtime credential from
Windows Credential Manager. No binding change, provider request or LINE call occurred. The last
known binding state is historical evidence only and was not promoted to current truth.

## DIG status

The frozen graph is acyclic. A1-A3 were safe to run in parallel. A5 depends on corrected and
approved A1/A2 evidence. A6 is the hard join of A2-A5; A7 and A8 are strictly serial after it.

| Node | Size | Status | Reviewed evidence |
|---|---:|---|---|
| A0 DIG/authority | S | PASS | 720 nodes / 1333 edges / 0 dangling at freeze |
| A1 production corpus mapping | M | BLOCKED | audit PASS_WITH_WARN; no positive case maps to approved rows |
| A2 live isolation prerequisites | M | PASS | exact project pooler credential and pinned CA verified; live isolation report PASS |
| A3 canary/receipt/recovery prerequisites | M | BLOCKED | review confirms missing controlled paths/evidence |
| A4 cross-lane integration | S | PASS_WITH_WARNINGS | findings agree; historical/live states separated |
| A5 real evaluation/live isolation | L | PARTIAL/BLOCKED | live isolation PASS; real provider evaluation remains blocked by A1/provider inputs |
| A6 controlled binding activation | L | BLOCKED | hard join not satisfied |
| A7 signed canary | M | NOT_RUN | A6 not satisfied |
| A8 Phase 1 acceptance | S | BLOCKED | no truthful live receipt |

## Confirmed blockers and remediation

1. The Golden corpus is a placeholder: all 14 positive cases reference seven `SG-*` codes absent
   from the approved 74-row artifact. All seven numeric allowlists lack support in the approved
   code/name/category-only dataset.
2. **REMEDIATED LOCALLY:** the runtime isolation probe previously compared production `text`
   columns with `uuid` parameters and resolved a protected table name without schema permission.
   The approved RCA fix now passes a dedicated-loopback PostgreSQL 17 role/RLS regression. This
   does not satisfy the live production gate.
3. **REMEDIATED LIVE:** the dedicated unprivileged credential is read process-locally from Windows
   Credential Manager. The 2026-08-14 probe sees 74 exact-scope rows, zero foreign/cross-Tenant
   rows, no direct grants and no permitted mutation; the transaction is rolled back.
4. Historical evidence says PITR is disabled and provider physical backups are unavailable. This
   is not fresh approval and no rollback rehearsal artifact exists.
5. **REMEDIATED LOCALLY:** FR-055 now provides a dedicated-role, HMAC-only, DB-time CAS installer
   and routing-first rollback path. It has not been applied or executed in production.
6. **REMEDIATED LOCALLY:** a strict redacted `zuri-cli` artifact/receipt adapter exists. No live
   post-LINE artifact exists, so transport acceptance remains `NOT_RUN`.
7. Exact destination, approved provider/model and pinned external `zuri-cli` canary evidence remain
   operator inputs and may not be inferred.

## Verification

| Check | Result |
|---|---|
| Independent review A1 | PASS_WITH_WARN; gate BLOCKED |
| Independent review A2 | WARN; gate BLOCKED/NOT_RUN |
| Independent review A3 | PASS_WITH_WARNINGS; A6/A7 BLOCKED |
| Focused local tests | PASS — 4 files / 28 tests, including PostgreSQL 17 integration |
| FR-055 W1-W4 local implementation | PASS — strict contracts, operator migration/CLI, redacted adapter and composed PostgreSQL 17 proof |
| Production database isolation | PASS — secret-redacted dedicated-login probe through Supavisor session pooler |
| Production provider/LINE | NOT_RUN |

Supabase's current guidance still supports the chosen boundary: use a dedicated service role/login,
least privilege and RLS; physical backups/PITR and restoration readiness must be verified as real
provider state, not inferred from local code.

## Approved remediation boundary

The owner approved the RCA and gate packet. The bounded implementation state is:

1. probe SQL and PostgreSQL-backed regression — **complete locally**;
2. owner-approved 20-case production corpus mapping — **BLOCKED on owner content choices**;
3. secret-safe binding installer and redacted receipt contract — **ADR-020/FR-055 W0-W4 complete locally; production apply and live receipt NOT_RUN**; and
4. LINE remote execution — **disabled** until recovery, destination and provider gates pass.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | beta | W0-W1 read-only audit and cross-review complete; external activation blocked | working-tree | ATHER |
| 0.2.0b | 2026-08-14 | beta | Owner-approved probe remediation passes PostgreSQL 17 locally; external activation remains blocked | working-tree | ATHER |
| 0.3.0b | 2026-08-14 | beta | FR-055 W0-W4 complete locally with composed PostgreSQL 17 proof; external activation remains blocked | working-tree | ATHER |
| 0.3.1b | 2026-08-14 | beta | Dedicated production login and live 74-row isolation proof pass; provider, binding and LINE gates remain blocked | working-tree | ATHER |
