---
version: "0.2.2b"
created_at: "2026-08-14T05:18:00+07:00,ATHER"
last_update: "2026-08-14T07:35:29+07:00,ATHER"
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
| JavaScript tests | PASS — 79 files / 414 tests |
| Python tests | PASS — 8 tests |
| Production build | PASS — Next.js 24 static pages, no blocking warning |
| Docs graph | PASS — 677 nodes, 1075 edges, 0 dangling before final evidence refresh |
| Docs preflight | PASS — 0 critical, 0 warning |
| Supabase migration apply | PASS — PostgreSQL 17 local `db reset` applied both migrations |
| Idempotency | PASS — production bootstrap migration reapplied successfully |
| Live isolation probe | PASS — login direct grants denied; exact scope = 1; cross-tenant = 0; read-only = true; transaction rolled back |
| Production target | PASS — linked project `qcnmhyglarzcpudjorzc`, PostgreSQL 17, Seoul, healthy |
| Logical backup | PARTIAL — post-apply scoped logical dump plus SHA-256 manifest captured; it is not pre-mutation evidence and physical backup/PITR is not enabled |
| Remote migrations | PASS — both local migrations recorded remotely |
| Remote import | PASS — 74 rows / 74 product codes, exact Tenant/Business/batch, prices disabled, audit SHA-256 exact |
| Remote isolation | PARTIAL — forced RLS, exact policies, safe role attributes and grants pass static remote inventory; live login-role probe awaits password provisioning |
| Supabase advisors | PASS — no security or performance findings at warning/error level |

## Remaining activation gates

1. provision the dedicated runtime login password in a secret manager and run the live positive/cross-scope/read-only probe;
2. enable an approved physical backup/PITR plan before broader production rollout; the current logical snapshot is post-apply;
3. install one approved model-provider credential/OAuth session;
4. configure destination/credential hashes and activate the binding only for the canary;
5. pass negative and positive LINE canaries plus the approved business golden questions; and
6. keep `ZURI_LINE_BUSINESS_AGENT_ENABLED=false` until the canary is accepted.

Operator note: after all remote apply/query/advisor evidence had passed, the shared Windows CLI
credential reverted to another cached Supabase account. The next remote operation must begin with a
fresh login and target check; this occurred after the committed import and does not change its
recorded database evidence.

## Version diff

| Artifact | Before | After |
|---|---|---|
| ADR-018 | `0.2.0b beta`, remote gated | `0.2.1b beta`, production DB slice deployed |
| ZV2-CR-004 | `0.2.0b beta`, remote gated | `0.3.0b beta`, production schema/import delivered |
| PRD/SDD | `1.33.0` | `1.34.0`, production evidence synchronized |
| Production binding | not created remotely | reserved remotely as `PENDING`; no hashes or traffic |

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | beta | Local implementation and live PostgreSQL isolation proof complete; production access gate open | working-tree | ATHER |
| 0.2.0b | 2026-08-14 | beta | Production migrations and verified 74-row price-disabled import complete; LINE activation gates remain open | working-tree | ATHER |
| 0.2.1b | 2026-08-14 | beta | Corrected backup chronology and separated static isolation proof from pending live-login probe | working-tree | ATHER |
| 0.2.2b | 2026-08-14 | beta | Recorded production-disabled merge readiness separately from unresolved activation gates | working-tree | ATHER |
