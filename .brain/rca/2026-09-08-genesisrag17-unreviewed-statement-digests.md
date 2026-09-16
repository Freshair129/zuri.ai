---
version: "1.0.0b"
created_at: "2026-09-08T01:53:00+07:00,RWANG"
last_update: "2026-09-08T01:53:00+07:00,RWANG"
status: beta
attributes:
  domain: agent-governance
  doc_type: root-cause-analysis
  scope: GenesisRAG17 PR preparation
---

# GenesisRAG17 documentation left three review digests stale

## Symptom

After merging main into the integration branch, the full server suite reported
4,201 passed, one failed and 15 skipped tests. The failure was the ledger test
`does not use review to rewrite an already current digest or baseline` in
`apps/server/tests/unit/id-anchor-stability.test.js`.

## Evidence

The baseline command refused with `existing statement digests differ for
SDD-057, SDD-059, FEAT-013`, instead of the test's expected already-complete
baseline response. The registry diff preserves all three subject anchors:
SDD-057 clarifies reuse of FR-071 alongside the approved lineage adapter;
SDD-059 preserves pure chunking while documenting the separate persistence
adapter; FEAT-013 describes the implemented isolated execution scope and its
extension map. The changes were committed in `00fda528` without corresponding
review-only digest acknowledgements.

## Root Cause

The documentation update regenerated the graph but omitted the separate
`docs:ids -- --review <ID> --reason ...` operation for these same-subject body
edits. That operation is intentionally outside `govern` (ADR-039 D15).

## Why the issue escaped detection

The previous documentation-only verification ran governance, which deliberately
classifies same-anchor digest changes as INFO. It did not rerun the full ledger
suite, whose real-tree baseline assertion requires every digest to be current.
The PR integration run exposed the inconsistency; no runtime pipeline failure
or requirement ID reassignment was observed.

## Proposed prevention and correction

Review each registry diff, record its specific reason through the existing
`--review` tooling, and run the ledger suite and governance after registry body
changes. Never edit the ledger JSON by hand or replace its baseline. The approved
ADR-070 scope and the original subject anchors remain unchanged. No application
code or test assertion is changed for this correction.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0b | 2026-09-08 | beta | Record omitted review digests and tooling correction | See containing commit | RWANG |
