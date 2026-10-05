---
status: approved
superseded_by: null
version: "0.1.0"
---

# Approved PM workflow document amendment

The owner replied `Approve` to the five document amendments D-1 through D-5 in
[RCA v0.1.0](../../2026-10-05-pm-workflow-document-rule-retrieval.md).
This records approval of that wording and a prepared patch; it is not a claim
that canonical source integration, governance or operational adoption passed.
The reply's exact timestamp is unavailable. Receipt recording time is in
[manifest.json](manifest.json).

## Source selection and application state

The analyzed Document 20 is v0.9.32b, raw SHA-256
`f502e5e97e0a30bbbacdd187af0a01d69093e368a523755249406a6c4c067ab2`.
The attached analysis branch holds v0.1.0b; local main holds v0.2.0b. Those older
sources do not contain the same role delegation and receipt history. The
originating machine's current file could not be retrieved: the available Remote
Desktop Commander inventory reported its device offline. That inventory does
not establish whether another transport or the original task is running.

The [patch](workflow.patch) is prepared against the verified v0.9.32b snapshot
and AGENTS.md SHA-256
`c500bb2201f620f97688a70193b88ef3ed73c61171bbe8f7b757dbf74b8a7aaa`.
This task has not applied the patch to canonical files in the branch, local main
or originating checkout; the originating checkout's current contents remain
UNKNOWN. Evidence snapshots are unchanged. No new canonical successor version
is reserved: [Document 20 preview](Document20.preview.md) and
[AGENTS preview](AGENTS.preview.md) retain their preimage metadata and illustrate
the patch only. Relative document links in previews resolve at their target
canonical paths, not in this evidence folder.

## Version diff and scope

| Proposal | Prepared change |
|---|---|
| D-1 | Add a short task/resume entry point with stable anchors pointing to the existing role, gate, packet, ownership, retry, metric and exit clauses |
| D-2 | Add source/clause/applicability rule-check records and reference them from Worker, Verify and Final receipts; incomplete attempt history stays UNKNOWN |
| D-3 | Require claim/clause/applicability/counterevidence/disposition reconciliation before RCA or decision publication |
| D-4 | Classify repeat actions; preserve the existing two-round acceptance-revision rule and existing decision authority; renaming alone does not reset the cap |
| D-5 | Add a receipt-time history notice and one AGENTS session-resume pointer; preserve all historical paragraphs, hashes and approvals |

The original retry clause is unchanged. The entire original §14-to-end history
is byte-identical. Issued identity `ZAI:PM-MULTI-AGENT-DELIVERY`, role delegation,
owner/G0/SPEC gates, candidate artifacts and plan JSON remain unchanged.
`dispatchable=false` and `implementationAuthorized=false` remain in force.
No product code or further developer tooling was added.

## Validation and limitations

- PASS: preimage hashes, patch dry-run and application to an isolated copy,
  exact postimage hashes, unique local anchors and unchanged retry/history.
- Git's global CRLF conversion affected the first isolated rehearsal. Final
  patch uses source LF and `core.autocrlf=false`; the second rehearsal matched
  both expected postimages exactly. This is document patch validation, not a
  product test or acceptance of the workflow by a running agent.
- NOT_RUN: canonical application, generators/corpus regeneration, govern,
  product test/build, agent adoption and runtime replay.
- UNKNOWN: current originating-machine Document 20 hash/version and effective
  model context after compaction. This amendment does not establish that
  compaction caused the historical contradiction or that the new wording has
  already reduced looping.

Hashes and byte lengths are in the manifest. [Validation](VALIDATION.md) records
the document scenario and byte checks. [Independent review](independent-review.json)
records GPT-6-Sol High PASS for the exact prepared patch and preview hashes;
canonical integration and operational validation remain pending.

## Integrator handoff

1. Read the current task source and select its exact revision/hash. If Document
   20 or AGENTS preimages differ, reconcile the additive wording with the current
   source instead of replacing it with a snapshot or forcing the patch.
2. Apply the approved amendment to the composed source, allocate Document 20's
   successor version from the actual current version, and record its version
   diff and source/postimage hashes. Preserve unrelated changes and history.
3. Review affected candidate read-set pins under §10; do not silently rebind
   candidates or reinterpret historical reviews as approval of new bytes.
4. Rebuild the AGENTS corpus and required documentation outputs only in the
   serialized integrator lane with the applicable authorization. The existing
   governance HOLD requires the fresh exact 13-path snapshot and separate Astra
   lift; this wording approval does not grant that lift or authorize tests/build.
5. Record actual results and operational adoption evidence before claiming the
   new workflow prevents the issue in real agent execution.

0.0 → 0.1.0: records direct owner wording approval, a bounded exact-preimage
patch and byte-verified previews. Canonical adoption remains pending source
selection and integration; no product authority is promoted.
