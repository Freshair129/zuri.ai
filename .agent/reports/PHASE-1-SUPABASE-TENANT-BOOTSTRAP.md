---
version: "0.3.1b"
created_at: "2026-08-14T05:18:00+07:00,ATHER"
last_update: "2026-08-14T10:01:36+07:00,ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "data-security"
  doc_type: "phase-report"
  scope: "FR-051 FR-052 production schema and knowledge import"
---

# Phase 1 report — Supabase tenant bootstrap

## Outcome

The approved ADR-018 / ZV2-CR-004 database slice is deployed to production project
`qcnmhyglarzcpudjorzc`. Both migrations and the approved 74-row price-disabled SmartGift knowledge
artifact are applied and verified. The reserved LINE binding remains `PENDING`; LINE traffic is not
enabled.

## Delivered

- private `zuri_core` schema with reserved Portfolio, Tenant, Business, binding and audit UUIDs;
- composite Tenant/Business foreign keys, tenant-leading indexes and identity-collision abort;
- forced RLS with a `NOLOGIN` SmartGift policy role and an unprivileged separate login role;
- webhook rejection of client-selected Tenant/Business scope;
- HMAC-bound LINE destination/credential resolver with inactive/expired fail-closed behavior;
- direct parameterized Postgres knowledge reader using a short `SET LOCAL ROLE` transaction;
- reconciled DuckDB import SQL with target UUID mapping, SHA-256, row count and audit event; and
- environment template and canonical FR/NFR/BR/SDD/SEC documentation.

## Verification evidence

| Gate | Result |
|---|---|
| JavaScript tests | PASS — 91 files / 468 tests |
| Python tests | PASS — 8 tests |
| Production build | PASS — Next.js generated 25 static pages, no blocking warning |
| Docs graph | PASS — 721 nodes, 1337 edges, 0 dangling after final evidence refresh |
| Docs preflight | PASS — 0 critical, 0 warning |
| Supabase migration apply | PASS — PostgreSQL 17 local `db reset` applied both migrations |
| Idempotency | PASS — production bootstrap migration reapplied successfully |
| Live isolation probe | PASS — login direct grants denied; exact scope = 1; cross-tenant = 0; read-only = true; transaction rolled back |
| Production target | PASS — linked project `qcnmhyglarzcpudjorzc`, PostgreSQL 17, Seoul, healthy |
| Logical backup | PARTIAL — post-apply scoped logical dump plus SHA-256 manifest captured; it is not pre-mutation evidence and physical backup/PITR is not enabled |
| Remote migrations | PASS — both local migrations recorded remotely |
| Remote import | PASS — 74 rows / 74 product codes, exact Tenant/Business/batch, prices disabled, audit SHA-256 exact |
| Remote isolation | PASS — pinned-CA runtime credential provisioned; direct read denied, scoped role assumed, exactly 74 approved rows visible, zero foreign-scope rows and mutation denied |
| Supabase advisors | PASS — no security or performance findings at warning/error level |

## Remaining activation gates

1. enable an approved physical backup/PITR plan before broader production rollout; the current logical snapshot is post-apply;
2. install one approved model-provider credential/OAuth session;
3. configure destination/credential hashes and activate the binding only for the canary;
4. pass negative and positive LINE canaries plus the approved business golden questions; and
5. keep `ZURI_LINE_BUSINESS_AGENT_ENABLED=false` until the canary is accepted.

Operator note: after all remote apply/query/advisor evidence had passed, the shared Windows CLI
credential reverted to another cached Supabase account. The next remote operation must begin with a
fresh login and target check; this occurred after the committed import and does not change its
recorded database evidence.

## Version diff

| Artifact | Before | After |
|---|---|---|
| ADR-018 | `0.2.0b beta`, remote gated | `0.3.1b beta`, production DB plus live runtime isolation verified |
| ZV2-CR-004 | `0.2.0b beta`, remote gated | `0.4.1b beta`, production schema/import/runtime proof delivered |
| PRD/SDD | `1.33.0` | `1.39.0`, activation-readiness and live runtime evidence synchronized |
| Production binding | not created remotely | reserved remotely as `PENDING`; no hashes or traffic |

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | beta | Local implementation and live PostgreSQL isolation proof complete; production access gate open | working-tree | ATHER |
| 0.2.0b | 2026-08-14 | beta | Production migrations and verified 74-row price-disabled import complete; LINE activation gates remain open | working-tree | ATHER |
| 0.2.1b | 2026-08-14 | beta | Corrected backup chronology and separated static isolation proof from pending live-login probe | working-tree | ATHER |
| 0.2.2b | 2026-08-14 | beta | Recorded production-disabled merge readiness separately from unresolved activation gates | working-tree | ATHER |
| 0.3.0b | 2026-08-14 | beta | Dedicated runtime credential and pinned-CA live tenant-isolation/read-only probe passed | working-tree | ATHER |
| 0.3.1b | 2026-08-14 | beta | Refreshed the full-suite and production-build evidence after rebasing onto current main | working-tree | ATHER |
