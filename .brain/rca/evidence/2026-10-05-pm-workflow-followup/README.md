---
status: active
superseded_by: null
version: "0.1.0"
---

# PM workflow publication and document follow-up

The owner requested commit/push and continued work. The reviewed RCA, bounded
guard tooling and approved workflow documents were committed and pushed as
`8f513b9494b02f1945827eb8181ce9ede430bb8e` on
`codex/pm-spec-issue-analysis-20261005`; the remote branch SHA was checked after
push. [Publication receipt](publication.json) records the action and scope.
No main update, merge, implementation or runtime activation occurred.

## Document walkthrough

An independent GPT-6-Sol High reviewer applied the new written clauses to eight
synthetic cases at that exact commit. [Walkthrough receipt](walkthrough.json)
records source hashes, clause locators, dispositions, counterevidence and next
permissible actions. Outcome: **8/8 PASS_DOCUMENT_WALKTHROUGH**.

| Case | Expected disposition obtained |
|---|---|
| Summary says there is no retry rule | Reject the absence claim against the existing two-round clause |
| Retry history missing after compaction | UNKNOWN/NEEDS_DECISION; do not infer round zero |
| Rename after two repairs, same acceptance | Cap remains exhausted; name/version does not reset it |
| Unclassified provenance/tool repeat | Hold pending authorized applicability/limit decision |
| Historical counts differ from exact plan | Use selected snapshot values; label old values historical |
| Source hash changed after rule-check | Hold/reverify affected work; preserve old receipt as history |
| Compaction/read timestamp unavailable | Use observable triggers and UNKNOWN; do not invent events/time |
| Document PASS offered as implementation permission | Reject promotion; preserve separate gates and false flags |

This is a document walkthrough by an agent, not a real compaction replay or
measurement of reduced looping. Effective model context and operational
prevention remain UNKNOWN/NOT_RUN. Govern, product tests/build and runtime were
not run.

## Integration preflight and prepared reconciliation

Remote `main` was directly observed at
`332b88c9277ee0995798f125f99d5343e7d493f0` and matched the local ref. A Git
merge-tree dry-run against the published topic commit found one conflicting
path, Document 20, with header and changelog conflict regions. No working-tree
merge was started. [Preflight receipt](integration-preflight.json) pins both
inputs and the isolated patch-application result.

The [reconciliation patch](main-reconciliation.patch) and
[preview](Document20.reconciled-preview.md) preserve the approved D-1–D-5 clauses,
topic lineage/metadata and historical receipts while retaining upstream's
MA-D06/MA-I13 PM execution-trace versus Integration runtime/data-pipeline
ownership refinements and upstream v0.1/v0.2 changelog rows. The exact
[main document preimage](Document20.main-preimage.md) is retained for comparison.
The preview is a proposal and keeps the topic version only to illustrate the
change; an integrator must allocate the actual successor when applying it.

The patch is **not applied**. Full incorporation of `main` also changes six
candidate contracts, outside the existing no-candidate-edit boundary. It must
not be performed as a metadata-only fix. This follow-up neither lifts the
governance HOLD nor rebinds candidate input pins. Reconciliation proposal review
and exact artifact hashes are recorded in this folder's manifest/receipt.

## Historical reference lineage

The adoption report listed two inherited historical targets absent from this
branch. Enumeration of all 49 pinned ZIP payload names located
`contracts/user-direction-receipt-2026-09-29.candidate.json` inside the existing
archive, with exact hash/size matching its payload manifest. Its canonical branch
path is still absent; an archival locator is evidence, not a restored candidate
or current approval. [Reference-lineage receipt](historical-reference-lineage.json)
records the archive member and the bounded search of the other receipt target.
No candidate file was created or altered.

## Next bounded work

The document wording and source review are delivered. Before broader integration,
the integrator must reconcile current parent/peer contracts, allocate an exact
successor, assess affected read sets, and resolve the existing fresh 13-path
snapshot/separate Astra governance lift. Corpus generation still lacks its
generated DOMAIN-MAP input. Real agent adoption needs a scoped observed run;
this walkthrough does not establish effectiveness.

`candidateOnly=true`, `dispatchable=false`, `implementationAuthorized=false`.

0.0 → 0.1.0: records publication, eight-case document walkthrough, a read-only
main integration preflight/proposal and exact historical reference lineage.
