---
id: ZAI:RCA-2026-09-17-SNAPSHOT-RETRY-RESULT-IDENTITY
title: Snapshot replay must return the committed receipt resource
version: "0.1.0b"
status: beta
created_at: "2026-09-17T17:38:00+07:00,RWANG,052821a7"
last_update: "2026-09-17T17:38:00+07:00,RWANG"
attributes:
  domain: project-manager
  scope: FR-252 W5 capture idempotency
  risk: MEDIUM
---

# Symptom and evidence

The composed snapshot regression executes a real SQLite capture transaction,
rolls it back after the callback, commits the same intent through a competing
call, then invokes the original callback again to exercise receipt replay.
The response paired the winner's committed receipt with the first attempt's
rolled-back snapshot ID, proof ID and timestamps. Four other capture tests
passed. Evidence is retained in phase-b-snapshot-composed-journey-repro.log/json.
This proves the service retry result defect, not PostgreSQL race behavior.

## Root cause

capturedSnapshot lived outside the mutation transaction callback. The first
attempt assigned it before commit; a rolled-back attempt left that object in
memory. The replay attempt returned a stored receipt without calling the effect,
so the service preferred the stale object over loading receipt.resourceId.

## Why it escaped detection

The original capture tests exercised successful creation, ordinary replay and
invalid source refusal. None combined rollback with a different transaction's
committed replay. Both objects independently passed their schemas.

## Prevention

Accept the local captured object only when its ID equals the committed receipt's
resourceId. Otherwise load that exact resource through the scoped repository.
Keep the composed rollback/replay regression and compare the complete returned
snapshot and receipt resource identity. This restores the approved capture and
idempotency contract without schema, API or authority expansion.
The wrapper runtime schema also requires the capture operation and equal
snapshot/receipt resource IDs; the generic receipt schema alone admits other
valid operations and cannot establish this wrapper relationship.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | beta | Reproduce rolled-back snapshot leaking into a committed replay result and document scoped-resource correction | 052821a7 | RWANG |
