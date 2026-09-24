---
domain: file-management
version: "0.1.0b"
status: beta
last_update: "2026-09-24T00:00:00+07:00,Codex"
module: services/file-management
owns_code:
  - services/file-management/**
owns_models:
  - FileRecord
  - FileVersion
  - FileOperation
  - FileUsageReference
owns_routes: []
---

# Domain charter — file-management

Files owns private original bytes, immutable FileVersions, file lifecycle,
storage mappings, safety/derivative metadata and exact-version file receipts.
Its standalone service is `services/file-management/`.

## Boundaries

- Every protected operation resolves the current actor and target scope through
  an authoritative capability port. Files does not copy Identity, Membership,
  Project access or CRM consent as a substitute authority.
- Tenant is the isolation boundary and Business is the default file owner.
  Cross-Business sharing requires an explicit grant with actions, recipient,
  expiry and revocation.
- The S3-compatible provider stores bytes. Files stores exact bucket/key/object
  version, SHA-256, byte length, detected media type and provenance. An object
  key without a verified provider version is not an immutable FileVersion.
- `FileAsset`, `FileLink`, `ProjectFile` and local workspace mounts remain
  Project Manager-owned compatibility records until a cohort migration is
  reviewed and rehearsed. The new service does not directly read or write those
  tables.
- CRM owns MessageAttachment, consent, retention and unsend. LINE/Integration
  owns signature and media acquisition. They submit scoped, idempotent capture
  requests and own whether an attachment remains accessible.
- Knowledge owns KnowledgeSource, admission, ingestion, 17-stage processing,
  query, citations and publication. Files provides exact version references and
  storage status, never a Knowledge success claim.
- Integration owns PipelineRun, PipelineStep, events, gates and SotDecision.
  Files consumes their versioned read/decision ports and does not copy ledgers.
- Project Manager owns Repository bindings, GovernanceSnapshot and the current
  Git provenance verifier. Git-authored documents stay canonical in Git;
  generated views stay read-only.
- Files does not own product, pricing, inventory or policy truth. It may present
  an owner-provided projection or submit an owner-specific change request.
- All external effects have stable operation identity and a reconciliation
  path. Metadata withdrawal, exact-version purge, provider deletion and CRM
  unsend remain separate, authorized operations.

## Public contract

`file-management.v1` is the provider-neutral boundary for exact original
upload/read/version/history, capture, typed attachment, usage-reference and
lifecycle operations. Requests are strict and bounded. Scope and grants are
verified by an authority provider; provider failures fail closed.

Files exposes stored FileVersion facts separately from downstream Knowledge,
pipeline, review, provider and business-effective state. Unknown or stale owner
state remains unavailable rather than being inferred from a file's latest
timestamp.

## Transition state

The charter describes the approved target boundary. Existing callers remain on
their current Project Manager, CRM and Knowledge owners until a reviewed
consumer migration assigns one writer per cohort. No production schema,
provider configuration, MinIO volume or business data is changed by this
charter.
