---
domain: agent
feature: FR-054
module: agent
source: v2-native
version: "0.3.2b"
created_at: "2026-08-14T07:58:02+07:00,ATHER"
last_update: "2026-08-14T11:45:00+07:00,ATHER"
status: "beta"
---

# FR-054 — Controlled LINE canary

## Rationale

A canary joins the highest-risk boundaries: runtime database role, provider credential, binding
identity and LINE delivery. The implementation must therefore produce a dry-run plan and refuse
unsafe prerequisites before an operator can perform the later controlled activation.

## Boundary

- live database isolation proof is required but secret-safe;
- preflight validates exact project, Tenant, Business, binding, provider and golden-report hashes;
- readiness code never mutates the binding or calls LINE;
- receipt semantics stop at `ACCEPTED_BY_LINE`; display/read remain unknown;
- rollback disables routing first and preserves all source/migrated knowledge.

## Delivery state

The dedicated-login probe, secret-redacted CLI, dry-run canary preflight, plan schema and operator
runbook are implemented. The live probe now connects through the approved project-qualified
Supavisor session pooler with the pinned CA and passes the exact 74-row isolation boundary. No
binding mutation or LINE transport was used; the signed single-destination canary remains
`NOT_RUN`.

The approved RCA remediation also passes against PostgreSQL 17 in a dedicated loopback test
database. That is supplementary local contract evidence; the live production report is recorded at
`.agent/evidence/supabase-2026-08-14/runtime-isolation-report.json`.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | beta | Owner-approved controlled-canary readiness contract | working-tree | ATHER |
| 0.2.0b | 2026-08-14 | beta | Probe and dry-run canary tooling implemented; live isolation and LINE canary remain NOT_RUN | working-tree | ATHER |
| 0.3.0b | 2026-08-14 | beta | Approved probe remediation passes unit plus PostgreSQL 17 role/RLS integration; live gate remains NOT_RUN | working-tree | ATHER |
| 0.3.1b | 2026-08-14 | beta | Live dedicated-login isolation passes via project-qualified Supavisor with pinned CA; LINE remains NOT_RUN | working-tree | ATHER |
| 0.3.2b | 2026-08-14 | beta | Redacted live isolation report added to the activation evidence manifest; binding and LINE remain gated | working-tree | ATHER |
