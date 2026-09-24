---
id: ZAI:ADR-107
title: File Management service and exact-version FilePort
version: "1.0.0"
status: approved
created_at: "2026-09-24T00:00:00+07:00,Codex"
last_update: "2026-09-24T00:00:00+07:00,Codex"
author: Codex (implementation owner)
attributes:
  doc_type: architecture-decision
  domain: file-management
  scope: file-records-originals-lineage-and-sot-boundary
relations:
  - type: relates_to
    target: ZAI:ADR-016
  - type: relates_to
    target: ZAI:ADR-061
  - type: relates_to
    target: ZAI:ADR-072
  - type: relates_to
    target: ZAI:ADR-073
  - type: relates_to
    target: ZAI:ADR-075
  - type: relates_to
    target: ZAI:ADR-093
---

# ADR-107 — File Management service and exact-version FilePort

**Status:** Approved for local implementation on 2026-09-24. Review, merge,
provider activation, migration and production cutover remain separate gates.

**Risk:** HIGH. This boundary touches private bytes, Business authorization,
cross-domain references, deletion/retention and Git-backed source changes.

## Context

The repository has Business-scoped `FileAsset` and `FileLink` metadata in the
Project Manager domain, local workspace mounts, S3-compatible object storage
adapters, a SmartGift upload that stores a blob before Knowledge admission,
CRM `MessageAttachment` rows that currently carry no bytes, durable Knowledge
artifact and ingestion lineage, Integration-owned `SotDecision`, and
Project-Manager-owned `GovernanceSnapshot` and Git provenance verification.
These are related file use cases, not one current owner or one transaction.

The requested Files process must perform file operations independently of
Next.js and keep exact original bytes accessible when downstream processing is
missing, failed or withdrawn. It must not take over CRM message meaning,
Knowledge execution, pipeline evidence, Git credentials or another domain's
canonical business data.

## Decision

### D1 — Independent Files executor

`services/file-management/` is the Files process and the only new executor for
the versioned FilePort use cases. It owns its service entrypoint, transport,
file metadata repository, storage adapter and file lifecycle. It must build,
run and test without importing or starting Next.js, Conversation Runtime, Work
Management, Edge, MSP or GKS. It receives external capabilities through typed
ports and does not read a shared Prisma client or another service's tables.

The Zuri web application may keep authentication, browser navigation and a
bounded BFF/transport adapter. The BFF cannot reimplement file business rules.
An unavailable or unauthenticated authority provider fails protected
operations closed; a fixture provider is for isolated tests only.

### D2 — Files identity, immutable versions and operation receipts

Files owns `FileRecord`, immutable `FileVersion` identities, upload/capture
operation receipts, provider storage locators, derivatives produced by an
identified producer, file safety state and file-use references. A version
records its FileRecord, tenant and owner Business, declared and detected media
types, byte length, SHA-256, exact provider key/version, creation time and
provenance. Updating current pointers never mutates a prior version.

Every retryable write has a stable operation identity, request digest, actor
and resolved scope, expected bytes/hash, state, attempts, result IDs and a
safe error. It reconciles an uncertain provider or metadata response by that
same identity before creating a second object or version.

The existing `FileAsset`/`FileLink` and ProjectFile surfaces remain
compatibility records until an approved, rehearsed migration moves a consumer.
The transition has one writer per data cohort and no untracked dual writes.
The original local-workspace behavior from ADR-016 remains supported through
an explicit adapter; it is not silently treated as a MinIO object.

### D3 — Exact, private object storage

MinIO remains an existing S3-compatible infrastructure dependency, not a Files
domain or image layer. Original bytes are written to a private bucket through
an injected StoragePort. The provider must return an exact immutable version
identifier; Files verifies byte length and SHA-256 and stores that exact
locator. Reads and citation resolution request the stored version, never the
latest key. A provider that cannot return or read an exact version reports
unsupported/unavailable and does not claim `VERIFIED`.

Original, sanitized preview and other derivatives have distinct version and
provenance records. A derivative never replaces the original. File deletion,
withdrawal, metadata erasure and exact-version purge are separate operations;
purge requires retention, legal holds, references, active operations and
consumer acknowledgments to be checked by their owning authorities.

### D4 — Authorization is a port; sharing is explicit

Tenant remains the isolation boundary and Business remains the default owner
boundary. The Files process resolves actor and scope through an authoritative
capability port for each operation. Upload, read, download, new-version,
attach, share, trash, restore and purge are separate actions. Knowing a file
ID, hash, object key, Git commit or `OWNER` link grants no access. An attach
requires both a Files grant and a target-domain grant. Cross-Business sharing
requires an explicit recipient, action set, expiry and revocation record; a
null Business is never a wildcard.

The Files service does not copy Identity/Membership or Project/Work grants into
its database as an independent authority. Caches, previews, indexes, upload
receipts and downloads are partitioned and reauthorized against current scope.

### D5 — CRM and LINE remain the attachment authority

CRM continues to own Message, MessageAttachment, ConversationEvent, consent,
retention and unsend behavior. LINE/Integration continues to own webhook
signature verification, channel credentials and provider media acquisition.
The LINE owner submits a bounded, authenticated capture request and bytes
through FilePort; Files never fetches an arbitrary URL or receives a channel
secret. CRM links the resulting exact FileVersion only after current
message/business authority succeeds.

Capture is idempotent across webhook redelivery and process restart. An unsend
or retention action revokes access through CRM's authoritative reference and
does not allow an older capture event to resurrect it. A chat image is not
automatically a Knowledge source, SOT document or approved business fact.

### D6 — Knowledge and pipeline keep their own lineage

Knowledge keeps KnowledgeSource, KnowledgeIngestion, admission, policy,
17-stage execution, query, citation and publication ownership. Integration
keeps PipelineRun/Step/Event/Gate and SotDecision ownership. File Management
stores exact document/version identities and exposes typed lineage references;
it does not copy those ledgers or report their state from file-storage state.

The read model distinguishes `FILE_STORED`, `KNOWLEDGE_ADMITTED`,
`PROCESSING`, `PROCESSING_FAILED`, `PUBLISHED` and `STATUS_UNAVAILABLE` only
when the authoritative owner supplies the corresponding evidence. A missing
Business Knowledge binding does not block an authorized Files write and never
falls back to another Business. StorageBinding and KnowledgeRuntimeBinding
remain separate registries. A citation resolves its recorded file version and
hash, not the current version pointer.

### D7 — SOT control is a bound-source module of Files

The browser-facing SOT module is a Files consumer that presents four distinct
source kinds: Git-authored document, managed binary document, canonical data
view and generated view. A binding fixes owner, Business scope, canonical
source identity, allowed paths/fields, version provider, approval rule,
effective rule and processing consumers. The manager cannot supply an
arbitrary repository URL, branch or local path.

Files reuses the current Git provenance verifier and GovernanceSnapshot read
contract, and calls provider and approval owners through typed ports. It does
not move `GovernanceSnapshot`, `SotDecision`, pipeline ledgers, Git credentials
or canonical domain data into Files. A Git-authored source is read at an exact
verified commit/path/blob; a MinIO copy is a snapshot, never a competing
editable canonical copy. Generated graph, trace and index documents are
read-only. A missing provider or write grant yields `LOCAL_ONLY`/`NOT_SUBMITTED`
when local drafts are allowed, never a fabricated Git revision.

Save, submit, business review, provider checks, merge, business-effective
revision and Knowledge publication are distinct receipts and states. Reviews
bind to an exact digest and base; self-approval and stale approvals are
refused. Restore creates a new proposal from an old exact version and never
rewrites history.

### D8 — Versioned contracts and phased transition

The service boundary is `file-management.v1`. Strict requests carry operation
ID, correlation ID, deadline, expected revision where relevant and bounded
payload metadata; responses report exact FileVersion, operation receipt and
typed outcome. Raw Prisma rows, browser-selected authority, arbitrary URLs,
credentials and LLM-provided scope do not cross the boundary.

Delivery follows independent review gates:

1. **T0:** reproduce and fix the Business A/B catalog outcome without waiting
   for service extraction.
2. **T1:** FilePort contract, private original upload/read, exact versions,
   durable receipts and an independent service/component proof.
3. **T2:** LINE capture and CRM attachment handoff after the LINE owner
   approves the contract.
4. **T3:** exact Knowledge/pipeline lineage and separately verified
   multi-Business routing; external runtime changes require their owners.
5. **T4:** bound SOT source read/history/diff, then draft/review/conflict/restore
   vertical slices.
6. **T5:** consumer migration, access/recovery matrix, disposable data
   migration and rollback rehearsal, governance and CI integration.

No production deploy, migration, live LINE media fetch, business-document
publication, provider merge or cutover is authorized by this ADR.

## Ownership map

| Capability | Current authority | Files boundary |
|---|---|---|
| FileAsset/FileLink and local file manager | Project Manager | Compatibility adapter until cohort migration; no direct table reads from the new process |
| Message and attachment meaning, consent, unsend | CRM | CRM issues and revokes typed links |
| LINE signature, account and media fetch | LINE/Integration | Authenticated capture request and bounded bytes only |
| Knowledge sources, admission, 17 stages, citations, publication | Knowledge | Exact FileVersion references and status projection only |
| Pipeline runs, gates, SotDecision | Integration | Typed read/submit capability only |
| Git provenance and GovernanceSnapshot | Project Manager | Verified source projection; existing owner remains authoritative |
| Canonical product, pricing, stock and policy data | Owning domain | Read projection or owner-specific change request |
| Original and derivative bytes | MinIO/S3 provider | Files stores exact version mapping and safety/provenance metadata |

## Alternatives and consequences

- Keeping all new file use cases in Next.js would preserve the current tight
  runtime coupling and is rejected.
- Turning `FileAsset` into a generic foreign key to CRM, Knowledge and
  Integration would transfer their authority and cascade behavior to Files;
  typed references are used instead.
- Copying every Git document to an editable MinIO version would create two
  canonical histories; Git stays canonical for Git-authored content.
- Moving Knowledge or pipeline tables into Files would duplicate their
  ledgers and break their existing owners; they remain behind ports.
- A broad Files role or Tenant-wide grant would violate current Business
  isolation; action-scoped current authority is required.

## Verification

Local unit, component, contract, image-build and image-start evidence are
reported separately from hosted CI, provider conformance, user UAT and
production. An unrun external owner/provider gate is `NOT_RUN` or `BLOCKED`,
not inferred from mocks or service files. Every migration rehearsal uses
disposable state and compares exact IDs, versions, hashes, links, receipts and
access outcomes.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0 | 2026-09-24 | approved | Establish independent Files ownership, exact-version FilePort and non-overlapping CRM/LINE/Knowledge/Integration/SOT contracts | working-tree | Codex |
