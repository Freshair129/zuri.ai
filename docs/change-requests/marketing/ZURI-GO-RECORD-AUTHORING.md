---
doc_type: intake-note
title: Governed authored-record migration for the Marketing report receiver
status: approved
superseded_by: null
version: "0.2.0"
date: "2026-10-05"
complexity: C-3
risk: HIGH
---

# Authored records — migration proposal, before tooling changes

The owner approved the [receiver contract](ZURI-GO-REPORT-RECEIVER.md). This separate proposal addresses a verified governance-tool gap, not a change to the approved report behavior. It is an intake, not an issued requirement or an executed record migration. Application receiver/sender code remains gated on issued parent records.

## Evidence and parent/peer impact

At parent baseline `332b88c9277ee0995798f125f99d5343e7d493f0`, `parseCanonicalRecord` and `parseCanonicalIndex` in `apps/server/scripts/document-registry-format.mjs` accept only version 1 and `source-preserved`. `loadRecords` in `tools/document-registry.mjs` loads index entries and requires every record's source revision to equal the historical index revision. `--write` cannot discover or issue a new record. `--adopt` reads pinned historical blobs and refuses changed compatibility exports. Thus none of these commands can honestly issue the receiver's new authored statements.

The [canonical format](../../migrations/document-reintegration/CANONICAL-FORMAT.md) and [consumer policy](../../migrations/document-reintegration/CONSUMERS.md) require a separately reviewed record migration. Hand-editing the generated index/ID ledger, changing pinned row hashes, or declaring new behavior source-preserved would contradict that policy. The affected consumers include document query, views, graph, preflight and governance snapshot capture/replay/proof verification, so this is C-3/HIGH even though no application database changes in this tooling slice. The snapshot verifier currently compares record/index historical revisions and legacy row provenance; widening the shared parser alone does not make authored snapshots safe or readable.

## Proposed bounded change

Keep all 539 initial records, their exact rows, provenance, IDs and anchors intact. Add support for genuinely authored records through a reviewed migration manifest and one sanctioned writer. Do not perform a wholesale rewrite of the existing corpus.

| Area | Proposed contract |
|---|---|
| Canonical format | Read existing version-1 source-preserved records unchanged; introduce version-2 authored records with explicit lifecycle, stable namespace/family/ID/anchor, statement payload digest and reviewed proposal/base revision provenance. Never use historical `source_revision` to imply new statements existed in the initial migration. |
| Index | Version 2 can enumerate both version-1 imported and version-2 authored records; retain the original import revision as historical metadata and validate provenance per record. Existing version-1 indexes remain readable. Indexes and compatibility exports remain generated views. |
| Migration input | A source manifest names the approved proposal/version, expected base/index digest, requested new subjects, intended export section and exact candidate IDs after a fresh collision check. It cannot overwrite or retire existing records in this first slice. |
| Writer | Plan/check first; explicit apply validates the entire manifest, namespace/family/path safety, ID collisions against all issued/burnt/reserved IDs, anchors, statement digests and base preconditions before any tracked writes. Use the existing sanctioned ID-writer mechanism; never patch the ID ledger directly. |
| Failure/idempotence | A conflict or stale base leaves existing tracked sources intact. Identical applied migration is a verified no-op; changed content under the same migration identity fails. Any partial filesystem failure must be surfaced with a recovery receipt and the exact remaining diff; no false atomic-filesystem claim. |
| Membership/export | Add only three receiver requirement records and one design record described by the approved intake. Do not assign them to an existing feature implicitly or modify its pinned membership row. Export new records into a clearly marked authored section, preserving the original row bytes/order. |
| Provenance | Append a receipt identifying proposal revision, source manifest digest, before/after index digests, newly issued IDs and checks. Approval, record issuance and application delivery remain distinct. |

## Implementation boundaries after approval

Primary code paths are `apps/server/scripts/document-registry-format.mjs`, `tools/document-registry.mjs` and narrowly scoped writer tests under `tools/tests/`. Add a manifest parser/writer only if needed to keep the existing generator readable. Integrator updates directly affected query/graph/preflight/view consumers and `apps/server/src/modules/project-manager/application/governance-source-verifier.js` only where their version/provenance assumptions require it. Snapshot capture/replay must validate each record's appropriate provenance, identity and statement digest, rather than comparing every record to the initial import revision. Preserve existing snapshot manifests and proof semantics; snapshot schema versions are distinct from canonical record/index versions. Document the authored format and sanctioned command in the existing canonical-format and consumer chapters.

No application auth/routes/Prisma schema, database migrations, live provisioning, Deployment, imported row statements, unrelated requirements or generic governance framework changes are included. Application work resumes only after the issued receiver records and their physical contracts have passed review and governance.

## Acceptance before issuing records

1. Existing version-1 corpus/parser/export tests still pass; all 539 original IDs, rows and anchors match the baseline.
2. A fixture can plan/apply the four authored records, generate deterministic projections and query their correct namespace/statement/provenance.
3. Reject unsupported versions, forged import provenance, duplicate/reserved/burnt IDs, wrong family, escaped paths, stale base/digest, unsupported membership edits and changed reapplication. Failure fixtures preserve pre-existing tracked bytes.
4. Identical reapplication is a no-op. Fixture recovery clearly reports an injected filesystem failure; it never reports successful issuance from partial output.
5. Read-only registry/query checks and generated graph/views include authored records without weakening existing critical checks. The sanctioned ID-writer and full governance pass on the composed migration.
6. Historical snapshot manifests, capture/replay and proofs remain compatible. Mixed imported/authored snapshot fixtures resolve correct namespace/statement digests; reject forged provenance, record/index versions and hashes without accepting absent legacy fields as valid authored provenance. A canonical version change must not silently relabel a snapshot schema version.
7. Independent architecture review pins the exact tooling/manifest candidate before real record issuance. Receiver/sender runtime acceptance remains NOT_RUN in this slice; snapshot verifier checks are required compatibility tests.

## Decision and handoff

The owner approved this additive authored-record support on 2026-10-05, separately from the receiver contract. The integrator may implement/test the bounded writer and prepare the receiver's four-record manifest at fresh main. No IDs are allocated by this approval; actual issuance remains subject to the independent review and acceptance checks above. The Doc Writer role itself does not issue IDs or change tooling; implementation and sanctioned writes are serialized integrator work under this approval.

## Version diff

0.1.0 → 0.2.0: records the owner's explicit tooling-scope approval. Tooling tests, independent implementation review and actual record issuance remain pending; no runtime operation is authorized by this metadata change.

0 → 0.1.0: documents the current format/writer limitation, an additive authored-record migration, preservation rules, implementation boundary and concrete acceptance checks. No code, issued ID, generated registry or database change.
