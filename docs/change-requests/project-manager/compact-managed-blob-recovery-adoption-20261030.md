---
id: ZAI:COMPACT-MBR-OR0-ADOPTION-20261030
title: Compact OR0 recovery and backup transfer canonical adoption
doc_type: change-request
status: approved
superseded_by: null
version: "0.1.1"
approved_on: "2026-10-30"
source_revision: "047bb9c5f0e30fcbfd8d5cdeb326342035e25c92"
implementation_authorized: false
relations: [{"type":"references","target":"ZAI:COMPACT-MBR-OR0-CONTRACT-20261029"},{"type":"references","target":"ZAI:COMPACT-MANAGED-BLOB-RECOVERY-PLAN-20261029"},{"type":"references","target":"ZAI:ADR-115"}]
---

# Compact OR0 recovery and backup transfer canonical adoption

## Approval

On 2026-10-30 the owner explicitly selected canonical adoption of OR0 recovery
and transfer/backup on a new branch in the existing isolated clone, with tests
and independent review, while retaining the candidate plan and unqualified AI.
This note records that instruction as approval of the two exact statements below
and their source-bound contract envelope for canonical documentation. It is not
application implementation, activation, qualification or production authority.

The approved source is the [OR0 contract proposal v0.2.0](compact-managed-blob-recovery-or0-20261029.md)
as committed at `047bb9c5f0e30fcbfd8d5cdeb326342035e25c92` (PR #765).
Use that exact committed version, not later intake edits, for this adoption.
The earlier proposed note remains historical design provenance; this separate
approval does not retroactively relabel its version or any earlier review.

## Scope and canonical ownership

Issue two new standalone authored-v2 FR records through the sanctioned
[record-migration writer](../../migrations/document-reintegration/CANONICAL-FORMAT.md#additive-authored-records--approved-writer-scope-2026-10-05).
The canonical records own their statements, with delivery `planned`; this note
is their approval/provenance input, not another requirement registry. Check fresh
main, existing/burnt/reserved IDs and the actual filesystem before selecting IDs.
No FEAT membership is assigned. Keep all existing IDs, subject anchors, source
rows and approval histories unchanged, including FR-045, FR-072 and FR-075.

PM/File Management retains the FileAsset/ProjectFile compatibility cohort.
Per-file recovery requires current Business OWNER authority and persisted-session
fences; installation backup/replacement retains FR-075 installation-operator
authority and all existing protected-family, credential and erasure refusals.
Standalone Files/FileOperation ownership and grants are unchanged. A byte port,
uploaded manifest or possession of a backup grants no new authority.

## Exact statements approved for issuance

### Managed-blob recovery

> Managed-blob operator recovery on a Compact PostgreSQL target lets a currently authorized Business owner prepare, preview, stage and explicitly confirm one existing active Asset/catalog FileAsset using exact persisted content evidence. The operation preserves identity, scope and consumer links while atomically committing one ref/version, durable result and redacted audit under current persisted-session and ownership fences. Durable operation custody distinguishes ambiguous external writes from failed writes; unqualified provider retries are refused, known cleanup is exact and scoped, and missing post-commit bytes fail closed as recovery-required. Installation restore, changed bytes, cross-scope moves and AI qualification are not conferred.

### Managed-blob backup transfer

> Managed-blob backup transfer preserves complete original-byte and metadata evidence for reserved recovery refs through a bounded operator export/preview/ confirm workflow, excluding source runtime authority and control state. A validated package binds every FileAsset/ProjectFile ref and byte witness; target-local jobs derive verified immutable refs from trusted target selection and commit their mapping with the authorized metadata replacement, audit and durable result. Existing snapshot refusals remain enforced. Recovery activation requires this supported backup round trip; transfer does not grant per-Business authority or qualify whole-installation restore, AI or production.

## Adopted contract envelope and acceptance

The source's transport/descriptor and strict bytes/scope/config bounds, current
session/OWNER and installation-operator decisions, durable operation/job custody,
lease/epoch and UNKNOWN outcomes, scoped cleanup/erasure accounting and shared
export/import exclusion are the reviewed design envelope for these statements.
The transfer contract includes its closed manifest and canonical TAR bytes,
target-local mapping with snapshot row versions preserved, normal Backup UI
and direct snapshot-consumer compatibility, and Phase B reserved-ref refusals.
No source journal, lease, credential, uploaded grant or destination map becomes
target authority. Source-provider conditionality proofs remain prerequisites
for retry admission; absence of proof means quarantine, not a relaxed retry.

Adopt the source's acceptance families as required future proof: native authority
and metadata races; real-byte/provider and custody/crash/cleanup cases; supported
HTTP/UI/CLI boundaries; local/Asset/catalog compatibility; and a complete
disposable TEST product recovery/export/new-target restore/content-read round
trip, including source-provider absence after export. Contract adoption and
document tests do not provide any of those runtime results.

Normal recovery outside the explicitly admitted disposable qualification lane
must wait for supported complete backup transfer. Preserve each installation's
separate restore/provenance admission, protected-family policy and current
authority; uploaded hashes are consistency evidence, not trusted provenance.
Full PostgreSQL installation restore and off-host failure-domain proof remain
separate gates, not implicitly covered by these two planned requirements.

## Migration and implementation boundary

First commit this approval source, then bind its exact revision/version/digest
and fresh base/index/ledger digests in a new migration manifest. Run read-only
planning and independent candidate review before explicit apply. Only the
sanctioned writer may issue records, invoke the ID writer, seal approval evidence
and generate the issuance receipt and compatibility exports. Never hand-edit
the ledger, generated registry/exports, immutable approval copy or receipt.

Reconcile the candidate plan, proposal navigation and parent Task7 links after
successful issuance; regenerate registry, graph and views serially and run
governance plus applicable migration/reader/provenance tests. Review the composed
patch independently. Any failed or PARTIAL application must retain its recovery
receipt and be reconciled explicitly rather than hidden by cleanup or ID reuse.

The [implementation plan](../../plans/COMPACT-MANAGED-BLOB-RECOVERY-20261029.md)
remains **candidate**, `implementation_authorized: false`. All application tasks,
models/routes, native/provider and product round-trip tests are unimplemented/
NOT_RUN here. Aggregate operatorRecovery and AI profiles remain
**NOT_QUALIFIED**. No Knowledge checkout, worktree, shared runtime/database,
live LINE, production, migration execution or deployment is selected.
Here record migration means documentation issuance only, not a database migration.

## Version diff and parent impact

0 -> 0.1.0: records the owner's canonical-adoption selection for the two exact
subjects from source v0.2.0. Adds no new behavior beyond that reviewed envelope.
ADRs and existing canonical subjects remain unchanged; the parent plan gains
issuance references while retaining all implementation/qualification gates.

0.1.0 -> 0.1.1: serialize the same typed relations as one YAML flow-array line
for the sanctioned approval reader's flat frontmatter grammar. No relation,
statement, authority, implementation or qualification meaning changes. The
earlier read-only plan refused the multiline source before any record apply.
