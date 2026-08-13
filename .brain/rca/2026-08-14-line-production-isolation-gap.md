---
version: "0.1.0b"
created_at: "2026-08-14T05:10:00+07:00,ATHER"
last_update: "2026-08-14T05:10:00+07:00,ATHER"
status: "beta"
attributes:
  domain: "data-security"
  doc_type: "root-cause-analysis"
  scope: "FR-051 production LINE knowledge isolation"
---

# RCA — LINE production isolation gap

## Symptom

The Phase 1 pilot passes local contract tests but cannot safely be enabled against the designated
production Supabase project.

## Evidence

- `public.business_knowledge` lacks `tenant_id` and grants `service_role` direct SELECT.
- the runtime requires `SUPABASE_SECRET_KEY`, whose role bypasses RLS.
- `/api/agent/line-webhook` accepts caller-selected `tenantId` and `businessId`.
- no database-enforced LINE binding maps the channel destination to Tenant/Business scope.

## Root cause

FR-047–050 proved the bounded knowledge/provider/answer/delivery ports as a pilot, while the
production Tenant and channel-binding boundary remained a separately gated architecture decision.
The adapter and route therefore retained pilot authority assumptions that are invalid in production.

## Why it escaped detection

The initial tests verified allow-listed fields, RLS enablement and transport bearer validation, but
did not assert private-schema placement, composite Tenant/Business ancestry, least-privilege role
identity, or rejection of caller-selected scope.

## Proposed prevention

- register FR-051/SDD-026/SEC-010 and test the production boundary explicitly;
- move knowledge to `zuri_core`, add Tenant-leading composite constraints and forced RLS;
- resolve scope only through an active server-owned LINE binding;
- replace secret-key REST reads with parameterized direct-Postgres reads using a bound read role;
- keep remote migration and LINE enablement disabled until inventory, backup and negative probes pass.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | beta | Root cause and prevention boundary recorded before implementation | working-tree | ATHER |
