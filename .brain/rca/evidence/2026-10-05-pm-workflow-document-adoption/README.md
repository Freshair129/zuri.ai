---
status: active
superseded_by: null
version: "0.1.0"
---

# PM workflow amendment: analysis-branch adoption

The owner's repeated direct `approve` after the prepared patch handoff is used
to complete the document amendment in the existing analysis worktree. Document
20 and AGENTS.md are now edited there; this is a branch-local document adoption,
not an update to local main or the originating machine. Receipt recording time,
source hashes and exact outputs are in [manifest.json](manifest.json); the user
message's exact timestamp is UNKNOWN.

## Source selection and version diff

The old branch Document 20 v0.1.0b is preserved byte-for-byte in
[Document20.branch-preimage.md](Document20.branch-preimage.md). Its source SHA-256
is `244792688df0daa70ca9c73b74b49f85fc16ba49346622b6afe12130254c7524`.
AGENTS' preimage is preserved in [AGENTS.branch-preimage.md](AGENTS.branch-preimage.md).

The selected Document 20 baseline is the hash-verified
[v0.9.32b snapshot](../2026-10-05-pm-spec-handoff/source/20-MULTI-AGENT-DELIVERY-PLAN.md),
SHA-256 `f502e5e97e0a30bbbacdd187af0a01d69093e368a523755249406a6c4c067ab2`.
The previously reviewed [amendment](../2026-10-05-pm-workflow-document-amendment/README.md)
adds D-1 through D-5. The final source adds explicit branch source selection,
version/last-update metadata and a version-diff record. This selection does not
claim the snapshot is the latest remote source. The current originating-machine
document remains UNKNOWN.

Document version **0.9.32b → 0.9.32b-rca.1** identifies the branch-scoped
amendment. It does not reserve the next global sequential version. The actual
branch diff also includes refresh from its older v0.1.0b to the selected baseline;
that refresh is not presented as newly authored role/gate or product policy.

| Change | Location |
|---|---|
| Rule navigation and exact-source task/resume entry | Document 20 entry point before §1 |
| Rule-check/resume record tied to applicability | Document 20 §5 |
| Claim/clause/counterevidence reconciliation | Document 20 §5 |
| Retry classification, evidence and existing decision authority | Document 20 §10 |
| Receipt-time history notice and current-state selection | Before Document 20 §14 |
| Session-resume pointer without duplicate rules | AGENTS.md §0 |
| Branch lineage, version and closed-authority record | Document 20 header and §13; AGENTS version diff |

The original two-round clause and all original §14-to-end historical bytes are
preserved from the selected baseline. Canonical identity, delegated roles and
owner/G0/SPEC gates are unchanged relative to that baseline. Candidate/plan
JSONs and all prior evidence packs are unchanged; no candidate is rebound to the
new document bytes. Older reviewed document hashes are historical for this
branch and need affected-read-set review before future promotion.

## Validation and limits

Exact output hashes and executed verification results are in the manifest and
the final verification receipt. Independent review of the prepared amendment
does not automatically approve these new final bytes.

Current branch contracts and Document 08 are older context. Historical links
in the selected baseline may point to artifacts absent from this branch. Their
original locators are preserved; link existence is checked and missing inherited
targets are recorded, not reconstructed or silently presented as current.

Govern/test/build and operational adoption remain NOT_RUN. The governance HOLD
and its fresh exact 13-path snapshot/separate Astra lift requirement persist.
Any authorized corpus-only refresh is recorded separately and does not lift the
governance HOLD or establish product acceptance.

`candidateOnly=true`, `dispatchable=false`, `implementationAuthorized=false`.
No application implementation, candidate edits, registration, main update,
merge, push, deployment or remote cutover occurs in this adoption.

## Handoff

Use the edited Document 20 and AGENTS.md in this analysis branch for subsequent
document review. For transfer elsewhere, reconcile the approved additive clauses
with that checkout's current source, preserve its unrelated changes, allocate its
actual successor version and refresh affected evidence explicitly. Do not copy
this branch's historical review state into a new candidate acceptance.

0.0 → 0.1.0: records owner-approved branch adoption and source selection with
preserved branch preimages. Broader composed governance and agent adoption remain
separate verification work.
