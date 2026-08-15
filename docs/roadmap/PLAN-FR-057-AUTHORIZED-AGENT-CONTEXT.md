---
version: "0.2.0b"
created_at: "2026-08-15T00:00:00+07:00,ATHER"
last_update: "2026-08-15T10:00:00+07:00,ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "line-ai"
  doc_type: "implementation-plan"
  scope: "FR-057 / Issue #11"
---

# Implementation plan — FR-057 authorized agent context

## Complexity and risk

Architecture/security change, C-3, HIGH risk. Implementation is limited to the
Zuri-side authorization seam and an MSP adapter contract. No production activation,
MSP schema migration, or Supabase privilege change is included.

## Work order

| Work | Deliverable | Proof |
|---|---|---|
| W0 | Register FR-057, ADR-022, NFR-014, BR-015, SEC-013, SDD-030 | docs graph/preflight |
| W1 | AuthContext and deterministic policy resolver | unit tests for deny-by-default and revocation |
| W2 | Server-owned scope plus GoVibe API-010 `msp_vault_resolve` adapter | API-010 contract tests; no raw vault injection |
| W3 | Bind identity, thread, session and policy to the agent turn | integration tests for group participants |
| W4 | Preserve legacy API-009 adapter behind explicit compatibility mode | migration and fail-closed tests |
| W5 | Consume API-010 resolved IDs/permissions in canonical API-009 memory operations | resolver and conformance tests |
| W6 | Review Supabase/RLS boundary and run full gates | `npm test`, build, docs checks |

## Exit gates

- no private memory retrieval occurs before an allow decision;
- no model or client value changes tenant, business, agent, workspace, project, or vault;
- canonical memory calls API-010 on every turn and use only its returned Workspace
  Private ID for private API-009 operations;
- same multi-principal group fixture proves private isolation;
- identity/membership revocation denies on the next turn;
- all existing FR-021..029 and MSP adapter tests remain green;
- documentation graph and preflight are regenerated and clean;
- production LINE binding and MSP rollout remain disabled.

## Rollback

Disable the structured private-memory path and use bounded current-turn context or
the reviewed compatibility adapter. Preserve audit receipts and do not delete legacy
MSP data during rollback.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.2.0b | 2026-08-15 | beta | Approved API-010 canonical resolver implementation plan | working-tree | ATHER |
