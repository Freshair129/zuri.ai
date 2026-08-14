---
feature: FR-051
module: project-manager
source: v2-native
version: "0.2.0b"
created_at: "2026-08-14T04:53:45+07:00,ATHER"
last_update: "2026-08-14T06:59:37+07:00,ATHER"
status: "beta"
---

# FR-051 — Production Supabase tenant isolation

**Risk:** HIGH
**Decision:** ADR-018
**Change envelope:** ZV2-CR-004

## Rationale

An application filter on `business_id` is not a production isolation boundary. SmartGift therefore
uses stable internal Portfolio, Tenant and Business UUIDs, composite ancestry constraints, a private
`zuri_core` schema and forced RLS. The LINE read role can see only the reserved SmartGift scope.

The curated DuckDB export remains the provenance source for this first import. Import SQL validates
the reconciliation SHA-256 and row count, writes the target Tenant/Business UUIDs itself, records the
bootstrap batch and appends a deterministic artifact audit event. Supabase remains the operational
relational store; GenesisBlockDB is not replaced or made an implicit Supabase extension.

## Delivery state

The migration is applied to production project `qcnmhyglarzcpudjorzc`. The approved artifact has 74
rows and 74 distinct product codes under the reserved Tenant, Business and bootstrap batch. Remote
proof confirms forced RLS/grants, cross-scope denial, exact audit SHA-256, null price/currency, and
no warning/error advisor findings. A logical pre-apply backup exists; project PITR is not enabled.

## Verification

- `tests/unit/supabase-production-isolation.test.js`
- `tests/unit/postgres-business-knowledge.test.js`
- `tests/python/test_build_business_knowledge_import.py`
- `supabase/tests/production_import_post_apply_inventory.sql`

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | beta | Local migration, scoped reader and reconciled import implemented; remote cutover gated | working-tree | ATHER |
| 0.2.0b | 2026-08-14 | beta | Production migration, isolation and 74-row import evidence complete | working-tree | ATHER |
