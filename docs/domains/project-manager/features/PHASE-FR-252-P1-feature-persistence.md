---
id: ZAI:FR-252-P1
title: Feature persistence and protected restore
parent_requirement: FR-252
phase_id: FR-252-P1
phase_order: 1
domain: project-manager
version: "0.4.0b"
status: beta
created_at: "2026-09-17T02:46:11+07:00,RWANG,approved e5ccfd7a"
last_update: "2026-09-17T14:38:00+07:00,RWANG"
relations:
  - type: references
    target: ZAI:FR-252
  - type: references
    target: ZAI:ADR-097
  - type: references
    target: ZAI:PM-PHASE-B-FEATURE-IMPLEMENTATION-PLAN
---

# FR-252-P1 — Feature persistence and protected restore

## Entry condition and predecessor

B1 owner approval, B2 registration/governance and independent frozen-packet PASS. Own W1 schema followed by W2 repository/restore interfaces. Production role remediation is a separate gate; no live database mutation is permitted by this slice.

The exact [W1 security policy](../../../architecture/project-manager-system/25-PHASE-B-PERSISTENCE-SECURITY-POLICY.md)
passed independent and root design review on 2026-09-17 (v0.2.2b, including
the optional snapshot same-Project predicate). W1 may
author the bounded local schema/migration and isolated proof. Runtime proof,
W2 protected restore/privacy and production activation are still separate gates.

## Input

The six-record selected data contract, plan24 sections 4/6/8, existing SQLite/Postgres schemas, protected backup families and real parent hierarchy. Reuse the Project lock; do not add a graph-state table.

## Output and next handoff

Additive SQLite/Postgres schema parity, reviewed migration/check/index/RLS definitions, repository ports, protected-family export/validation/restore and tested immutable identity/version behavior. Hand frozen transaction/read interfaces to P3 and restore evidence to root.

## Failure, retry and acceptance

Validate both schemas, execute local isolated adapter and restore tests, reject cross-scope/malformed/missing protected-family snapshots before mutation, preserve legacy compatibility and show rollback retention. No production migration; no unrelated schema cleanup.

Current state: W1_W2_LOCAL_VERIFIED. Both Prisma schemas validate and
the six-table SQLite/PostgreSQL migration twins are implemented locally. Three
SQLite/schema tests pass; actual isolated PostgreSQL 17 non-bypass login proof
passes 129 checks plus 11 schema/policy/grant collision checks. Independent
Luna Max provider review passed at migration hash 9CDC9DEC. The composed
Identity/W1 suite passes 67 tests and the optimized build passes.

W2 repository, reviewed erasure and Identity composition pass 50 focused tests
across eight files. After correcting legacy parent validation and deterministic
test fixtures, the complete Server suite passes 6066 tests with 32 skipped;
the affected regression run passes 92 tests across 16 files. These runs overlap
and are not additive. Governance passes with zero CRITICAL and two existing
warnings; the current optimized build passes. The existing navigation and Domain
browser suite passes 32 cases without retry-only passes.

Actual isolated PostgreSQL adapter proof passes 13 checks. The real offline CLI
passes 18 standard and 11 adversarial checks, including full six-family
roundtrip, the 175-table empty-target proof, prefix-write rollback and inserted
row reconciliation rollback. The final CLI attestation proves unchanged source
bytes during execution. Independent Luna Max review passes W2-A, Identity and
W2-B after frozen-inventory and mandatory-validator corrections. Root accepts
these local gates and hands the frozen repository ports to W3 read/API and UI
workers. Hosted implementation CI and production evidence remain NOT_RUN.

The former missing-backup-coverage CRITICAL is closed by protected-family
coverage. The six immutable/scoped families remain outside the ordinary
destructive importer. Earlier copied-enum and recovery boundary findings are
closed on the composed source and current governance run.
Production runtime proof remains separate from isolated role evidence.
[Recovery and erasure decision 26](../../../architecture/project-manager-system/26-PHASE-B-RECOVERY-AND-ERASURE-DECISION.md)
was approved by the owner at v0.2.1b (SHA DD666532); v0.3.0b records acceptance.
The approved implementation uses offline clean-target recovery and reviewed
field-target erasure. Root owns existing Backup/Identity composition and the
shared inventory. The peer CRM legal-hold serialization finding remains a
separate release gate; this slice preserves its central erasure seam and does
not claim to repair that race. No live database was migrated by this slice.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.4.0b | 2026-09-17 | beta | Close W1/W2 local gate with independent PASS, full Server/build/browser verification and source-frozen actual CLI recovery proof; open W3 handoff | bd99651f | RWANG |
| 0.3.1b | 2026-09-17 | beta | Record current W2 adapter, composition and actual CLI proofs; retain independent recovery and final verification gates | bd99651f | RWANG |
| 0.3.0b | 2026-09-17 | beta | Record decision26 approval and dispatch disjoint W2 implementation with root-owned shared seams | bd99651f | RWANG |
| 0.2.1b | 2026-09-17 | beta | Record W1 isolated proof and independent PASS; retain W2 snapshot-coverage and production gates | bd99651f | RWANG |
| 0.2.0b | 2026-09-17 | beta | Record reviewed W1 policy and local authoring; separate pending W2 recovery and erasure decision | bd99651f | RWANG |
| 0.1.0b | 2026-09-17 | beta | Register slice of the approved Phase B design; no new behavior | e5ccfd7a | RWANG |
