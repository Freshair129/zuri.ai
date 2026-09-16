---
version: "1.0.0b"
created_at: "2026-09-08T04:17:00+07:00,RWANG"
last_update: "2026-09-08T04:17:00+07:00,RWANG"
status: beta
attributes:
  domain: knowledge
  doc_type: root-cause-analysis
  scope: native final-commit process recovery
---

# Final-commit recovery requires a durable collection declaration

## Symptom

After moving the crash hook into the actual final native commit-to-receipt
interval, a real process restart fails Stage15 with
`NATIVE_VECTOR_COLLECTION_MISMATCH`. The graph-commit and graph-receipt crash
cases recover successfully; keeping the transaction payload stable alone is
insufficient for the vector path.

## Evidence

The expanded native suite executed 23 cases (20 passed, three failed), including
the final-commit restart failure. A focused repeat executed the positive raw
chain and final-commit crash case: the former passed and the latter failed with
that exact persisted Stage15 error; the other 22 cases were not selected for
this diagnostic run. The worker correctly rejects mismatched dimensions/metric
in `ensureEmbedder`.

At the pinned native engine revision, `src/lib.rs:3189` explicitly documents
that `create_collection` is an in-memory operation whose declaration becomes
durable through the snapshot manifest. `replay_vector` at `src/lib.rs:3222`
auto-creates an absent collection with model `recovered` and `Metric::L2`.
The intended worker collection is multilingual-e5-small / 384 dimensions /
cosine. A crash after vector WAL commit but before `saveState` loses its
declaration and triggers that recovery default.

## Root Cause

The worker persisted vectors before durably checkpointing their collection's
model/metric declaration. Its later checkpoint cannot protect a process that
dies before reaching it. The mismatch guard is correct; weakening it would
silently change the retrieval metric.

## Why the issue escaped detection

The original crash hook ran after receipt/state persistence. A same-process
exception also retains the in-memory collection declaration, so it cannot
reproduce the engine's WAL-only reopen behavior.

## Proposed prevention

Checkpoint the collection declaration before the first vector transaction,
retain strict model/dimension/metric validation and exact transaction retries,
and rerun the actual subprocess termination case. Keep the previous published
snapshot queryable during recovery. No native pin change or fallback metric is
authorized. Previously damaged candidates remain failures rather than being
silently converted; a fresh FR-071 attempt can create a new generation.

## Verification

Final four-process native acceptance passed 25/25 without skips. The full zuri
regression passed 4,217 tests; the final verification manifest is linked from the
[audit remediation report](../reports/GENESISRAG17-AUDIT-REMEDIATION.md).

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0b | 2026-09-08 | beta | Trace actual restart mismatch to missing collection manifest checkpoint | GenesisBlock base 022ad3d3, working repair | RWANG |
