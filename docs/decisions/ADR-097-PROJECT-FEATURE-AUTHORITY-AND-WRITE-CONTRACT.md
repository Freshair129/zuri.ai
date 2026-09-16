---
id: ZAI:ADR-097
title: Project Feature authority and scoped write contract
version: "0.1.2b"
status: beta
created_at: "2026-09-17T02:46:11+07:00,RWANG,approved e5ccfd7a"
last_update: "2026-09-17T03:23:00+07:00,RWANG"
author: RWANG
attributes:
  doc_type: architecture-decision
  domain: project-manager
  complexity: C-3
  risk: HIGH
relations:
  - type: relates_to
    target: ZAI:ADR-025
  - type: references
    target: ZAI:ADR-096
  - type: references
    target: ZAI:FR-252
  - type: references
    target: ZAI:PM-PHASE-B-FEATURE-IMPLEMENTATION-PLAN
---

# ADR-097 — Project Feature authority and scoped write contract

**Status:** Owner approved the Phase B specification at commit
`e5ccfd7a8051cce551b95453b7435ac850f66d9d` through explicit `approve` on
2026-09-17. This decision registers that approved design without changing it.
Independent frozen-packet verification and B2 governance remain implementation
entry gates. Approval does not claim a working Feature surface or authorize a
production migration, credential change or runtime activation.

## Context

FR-251 projects existing Workstream execution Domains. It cannot supply the
separate Feature authority requested by the owner: explicit outcomes, primary
and supporting Domains, WorkItem relationships and immutable requirement pins.
Reusing tags or labels would create false identity and double-count shared work.
The approved detailed plan is
[plan 24](../architecture/project-manager-system/24-PHASE-B-FEATURE-IMPLEMENTATION-PLAN.md).

## Decision

1. FR-252 owns the Project-scoped Feature behavior as one shared requirement,
   with ordered P1–P4 delivery slices. Project Manager owns its six logical
   records: ProjectFeature, FeatureContribution, FeatureWorkLink,
   RequirementBinding, GovernanceSnapshot and ProjectFeatureMutationReceipt.
   Identity owns the reusable API-write CSRF issuer/verifier used by this slice.
   There is no new operational Domain or FEAT bundle.
2. The selected [data contract](../architecture/project-manager-system/contracts/phase-b/data-model.candidate.json)
   and [OpenAPI](../architecture/project-manager-system/contracts/phase-b/openapi.candidate.json)
   define fields, bounds, routes, receipts and errors. Their candidate filenames
   describe the design artifact format; this approval record is the authority
   for the selected behavior. Other candidate PM surfaces remain unapproved.
3. All reads, writes and receipt replay validate the full Project/Workspace/
   Business/Tenant chain. Live session, Identity-owned CSRF, explicit configured
   Origin, scoped idempotency, Project locking, aggregate CAS and one atomic
   AuditEvent protect mutations. Invalid scope is a redacted refusal.
4. Allocation is per WorkItem across its active Feature links. Derived state,
   exact graph ETag membership, complete-set replacement and explicit deletion
   cohorts follow plan24. No Feature calculation changes weighted Workstream
   progress. Restore refuses allocation overflow atomically.
5. Requirement evidence comes only from the bounded server-local Git verifier
   admitted through an operator Repository checkout binding and actual scoped
   ProjectRepository. Persist only VALID evidence. Features start empty; no
   tags, titles or readiness snapshots synthesize authoritative Feature rows.
6. Use existing SQLite and PostgreSQL adapter seams; validate schema parity,
   protected backup families, restore order and actual RLS/grants. Additive
   rollback disables the Feature surface/writer while retaining evidence.
7. Activate only the Project Delivery Design Features view and its accessible
   detail drawer after implementation gates. Preserve FR-250/251 navigation,
   Inventory, Team, Resources/Risks meanings, Import and all seven Work views.
   Workforce, providers, MCP, fleets and other planned views are outside FR-252.

## Alternatives and consequences

Tag-derived Features and using the Domain projection as a registry were rejected
because their identities and ownership differ. A new graph-state table was
rejected: the Project lock and canonical tombstone-inclusive Feature digest
provide the selected concurrency boundary. Active-only uniqueness was rejected
in favor of reserved Feature codes and deterministic child UUID revival.

The Project lock deliberately serializes Feature writes. The initial bound is
200 non-deleted Features per Project. RETIRED is terminal but supports authorized
metadata/relationship edits, delete and restore, retaining lifecycle and CAS.
This is the approved initial contract, not a performance or scale claim.

## Verification and production boundary

At approval, 33 DTO/schema fixtures and three rendered diagrams passed locally;
governance had zero critical findings and two existing warnings. Runtime,
migration, authorization, race and product-browser proof are NOT_RUN for Phase B.
Independent re-review is still required; root cannot label its own composition
an independent PASS.

The implementation-entry audit reconciles two mechanical contract omissions
without changing the approved behavior: selected data model v0.2.2b allows only
VALID snapshot persistence and a non-null sourceManifest, as decision 5 and
plan24 already require; selected OpenAPI v0.3.2b documents the issuer's
403 CSRF_INVALID refusal when its existing Origin policy is not satisfied.
The independent reviewer must include these corrections in the entry verdict.

The bounded re-review additionally requires ProjectRepository and its complete
hierarchy before snapshot restore, the already-required 422 Feature capacity
refusal on restore, and consistent Business-owner-only snapshot listing.
Plan24 v0.3.3b, data v0.2.3b and OpenAPI v0.3.3b reconcile those points and bound
cursor/ETag output to the existing 4096-character input limit. A separately
reviewed W1 RLS policy artifact is an explicit pre-DDL/adapter gate, approved by
the independent verifier and root. Identity P2 can proceed after overall entry
review while this database gate remains held. These are enforcement details of
the approved authority, not permission for production access changes.

The [runtime-role RCA](../../.brain/rca/2026-09-17-pm-release-runtime-role-carry-forward.md)
records the pre-existing bypass-RLS connection. A separately reviewed real-role
isolation proof must close before any Phase B production write or migration.
No grant, credential, scheduler, archive or knowledge activation is included.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.2b | 2026-09-17 | beta | Reconcile frozen re-review restore/list/response gaps and make the independent/root W1 policy gate explicit | 61e28ac9 | RWANG |
| 0.1.1b | 2026-09-17 | beta | Align selected data/OpenAPI artifacts with approved VALID-only evidence and issuer Origin refusal; behavior unchanged | 50b5e1dd | RWANG |
| 0.1.0b | 2026-09-17 | beta | Register the owner-approved Phase B design and preserve verification/production gates | e5ccfd7a | RWANG |
