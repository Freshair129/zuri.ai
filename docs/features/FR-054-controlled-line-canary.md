---
feature: FR-054
module: agent
source: v2-native
version: "0.1.0b"
created_at: "2026-08-14T07:58:02+07:00,ATHER"
last_update: "2026-08-14T07:58:02+07:00,ATHER"
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

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | beta | Owner-approved controlled-canary readiness contract | working-tree | ATHER |
