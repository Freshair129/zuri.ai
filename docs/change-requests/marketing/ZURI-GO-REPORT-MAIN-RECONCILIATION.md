---
doc_type: intake-note
title: Marketing report records — main-first identity reconciliation
status: approved
superseded_by: null
version: "0.2.0"
date: "2026-10-05"
complexity: C-3
risk: HIGH
---

# Main-first reconciliation before report receiver coding

Owner approved the main-first reconciliation/combined-format contract and both physical designs on 2026-10-05 in the current conversation. This approval covers implementation and exact-manifest preparation/review; no live operation is authorized. This is a concrete recovery proposal after the final fresh-main check, not permission to rewrite an issued ID. [RCA](../../../.brain/rca/marketing-report-branch-id-collision.md) records the evidence. Main `077796622233bf9f35905f7eac226f0963760dcb` publishes ZAI:FR-278 as executive LINE OA dashboard; task issuance `cdb9518bc50019e876c15c6b1f6c1c98af84f65a` issued the same key for report-only credential. Main also adds a reviewed-migration v1 record workflow; this branch adds authored v2. Both approved format documents call themselves v0.2.0 but describe different additions. A text merge or choosing one parser would not settle the identity/provenance conflict.

## Proposed choice and tradeoff

Preserve the already merged main identities and dashboard unchanged. Preserve this task branch, its four issued record blobs, manifest/frozen approval/receipt and reviewed commits as historical branch-qualified evidence. Begin a clean reconciliation branch from fresh main; carry only reviewed compatible tooling, intake/design and history references, then propose a new governed issuance for the four report subjects under fresh never-used IDs. Do not import the old branch's active index/ledger/exports over main, silently rename its FR-278, replay its old manifest on a new base or turn old receipt hashes into current hashes.

| Option | Effect / tradeoff |
|---|---|
| Main-first clean reconciliation — recommended | Protects published dashboard/API/test identity; costs one explicit new governed record migration plus mixed-format qualification. Old branch issuance stays auditable but is not active-main authority |
| Pause receiver work until an owner coordinates all issuers | Preserves both branches without changes; cannot enable receiver coding or merge until identity ownership is settled |

Renumbering main's dashboard or treating the two FR-278 subjects as aliases is not a proposed shortcut: it would modify a published pinned identity and its native annotations. Fresh report IDs must exceed every used/reserved/burnt ID from both histories and any newly published work. Candidate numbers are intentionally not issued here. All four old task subjects remain history, not implicit aliases to the eventual replacements; Go references need an explicit reviewed transition to the new qualified IDs.

## Bounded reconciliation sequence

1. Owner selects main-first reconciliation and authorizes fresh issuance under a single coordinated issuance lane. Recheck main, clean target worktree, latest ledger and all reservations; preserve current branch evidence and user WIP.
2. Draft a unified canonical-format revision retaining initial source-preserved v1, main's reviewed-migration v1 and reviewed authored v2 provenance. Preserve every published main row/identity and historical snapshot/proof version. Review the parser/writer/query/view/snapshot compatibility diff before code; existing approvals do not silently approve a different combined format.
3. Produce a fresh manifest from that reviewed composed base, linking unchanged receiver intent and the approved new migration decision. Review exact unused IDs/rows/digests and original-history preservation before apply. Use sanctioned writers, not direct index/ledger/export edits. The old APPLIED receipt remains immutable historical evidence, never an authority to apply on the new main.
4. Generate registry/graph/views/corpus and verify mixed provenance, source preservation, deliberate drift refusals and competing-base collisions. Rebind Go references through approved documentation; no application schema or credentials are touched.
5. Independent composed review and owner-approved record publication precede the physical-design/application phase. Resolve the Business machine policy, backup restriction and first-claim age clock in the paired physical proposals; native SQLite/PostgreSQL acceptance stays required after coding. PR merge and live operations retain their separate gates.

## Unified format contract proposed for approval

The combined format revision is proposed as v0.3.0 rather than relabelling either divergent v0.2.0 document. It extends consumers additively and keeps each record's existing provenance dialect explicit:

| Record dialect | Required provenance / verifier rule |
|---|---|
| Initial v1 `source-preserved` | Exact pinned source revision/path/row hash; preserve original bytes/identity. Snapshot verifies its original source revision |
| Main v1 `reviewed-migration` | No fabricated historical source_revision; retain migration_base_revision and approved migration_document, row hash and published subject. Snapshot verifies reviewed-addition provenance instead of requiring initial-source equality |
| Authored v2 | Retain exact manifest/base/index/ledger/approval revision/version/path/digests and subject/row/statement hashes; derive snapshot provenance/cache key from all proof inputs; never coerce into v1 |

Canonical index version 2 may represent the mixed records while retaining the original pinned sourceRevision. Parser APIs must expose dialect-specific optional provenance rather than assign a fake common source; registry/query/views/readiness/snapshot consumers must accept and validate all three. Main's existing published reviewed records and feature memberships survive exactly; the record writer remains the only source of projection slots/index/exportOrder. Explanatory digest refresh does not rewrite a row hash. Old snapshot/proof v1/v2 manifests retain their exact existing interpretation; extending provenance inputs must not relabel a stored proof.

Concrete existing-main prerequisite: at `07779662`, `apps/server/src/modules/project-manager/application/governance-source-verifier.js` line 616 requires every record.sourceRevision to equal index.sourceRevision, while reviewed-migration FR-278 intentionally has no source_revision. Independent read-only parser reproduction confirms that equality is false. Treat this as an existing-main compatibility gap to qualify under the new reviewed contract, not permission to remove the check indiscriminately or claim snapshot acceptance. Tests must cover reviewed migration provenance, initial-source tamper denial, historical capture/replay/proofs and authored proof inputs together.

Writer execution remains plan → independent exact-manifest review → apply via existing add-only ID writer → immutable receipt → no-write reapply, with fail-closed collisions/base/hash/path/boundary checks. New writer/parser changes require isolated fixtures for all three dialects, unsupported-version denial, proof-cache invalidation, reserved IDs from both histories and competing-branch allocation refusal. Coordinate issuance through the owner lane; these checks do not themselves create a distributed lock. Preserve an explicit non-reuse record for branch-only IDs through the reviewed reservation mechanism before future allocations. No unreviewed hand edit of published ledger/index/exports is authorized.

Do not run `--abandon FR-278` against main: that key now names its published dashboard, and the existing abandonment writer cannot distinguish two subjects sharing one key. Preserve the old batch at its original branch/revision; never burn main's current identity to resolve this collision. Main at the inspected revision has 540 records/748 pins, preserving all 539 original canonical digests and all 747 original pins; its 216 changed original index exportOrder values reflect the inserted reviewed FR slot. This is legitimate generated ordering, not permission to rewrite row provenance.

Recorded owner approval of this proposal authorizes implementation of this combined tooling contract and preparation of a fresh manifest for the unchanged four receiver subjects. Independent manifest review must still settle exact fresh IDs/base/digests before issuance; if intent or published identity meaning must change, return to owner review. Approval does not authorize merging this conflicted branch, real migration/provisioning/send/deployment or bypassing physical/native acceptance gates.

## Acceptance and current limits

Main FR-278 and all main initial/published pin metadata must remain exact. All old task evidence must remain recoverable at its original commits and hashes. Both reviewed-migration and authored provenance must survive registry/query/views/snapshot verification without accidental `source-preserved` labeling. New IDs must be uniquely coordinated and issued only once; no downstream alias is inferred. Document-only checks do not satisfy native receiver/sender runtime acceptance.

Current physical designs are review-ready against `fcb7ade3` and Go `f06ef4d3`, but their task-branch FR references cannot be presented as identities on main `07779662`. Latest-main integration is BLOCKED pending this decision; no conflicting merge/reissue was attempted. The successful earlier `3506129f` integration remains historical qualification, not evidence for the new main. No database, deployment, runtime or credential operation is part of this proposal.

Version diff 0 → 0.1.0: records the concurrent-ID/root-format conflict and proposes main-first recovery with immutable history, fresh coordinated issuance and mixed-format review. Does not allocate, rename, retire, alias or supersede a canonical identity.

Version diff 0.1.0 → 0.2.0: records owner approval and activates the combined tooling/physical scope; historical evidence and main IDs remain unchanged. Fresh worktree starts at main07779662. Candidate IDs will be reviewed before issuance.

