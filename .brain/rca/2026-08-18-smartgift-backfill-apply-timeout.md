---
version: "0.1.0b"
created_at: "2026-08-18T16:40:00+07:00,ATHER"
last_update: "2026-08-18T16:40:00+07:00,ATHER"
status: "candidate"
superseded_by: null
attributes:
  domain: "data-migration"
  doc_type: "complexity-rule"
  scope: "smartgift-customer-backfill"
---

# RCA: SmartGift customer backfill did not reach commit

## Symptom

The approved apply process ended without an `APPLIED` receipt. The target
remained empty, so the transaction rolled back or the client was terminated
before commit.

## Evidence

- The first apply process held one PostgreSQL transaction for more than ten
  minutes and was observed as `idle in transaction` between statements.
- A second apply process was blocked by the advisory transaction lock and was
  canceled without writing rows.
- Read-only target verification after both processes reported `customer=0`,
  `customer_import_batch=0`, and `customer_import_provenance=0`.
- Source resolution produced 3,569 rows, with 3,439 publish candidates and no
  duplicate source hashes, person ids, customer ids, provenance ids, or
  idempotency keys.

## Root Cause

The importer issued three PostgreSQL statements per source row inside one
atomic transaction. This created roughly 10,700 client/server round trips for
one batch, making completion dependent on a long-lived runner session rather
than on the database transaction itself.

## Why the issue escaped detection

Unit tests covered source resolution and provenance parameter shape, but no
test or bounded execution check exercised the full-size Postgres write path.

## Proposed prevention

Keep the transaction and parent-before-child ordering, but use bounded
`execute_batch` writes for person, customer, and provenance. Add a source-level
regression assertion for batched writes, then verify the live counts and batch
receipt after apply. Keep rollback rehearsal as a required migration gate.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---------|------|--------|---------|-------------|-------|
| 0.1.0b | 2026-08-18 | candidate | Recorded the slow atomic write path and bounded batch-write prevention | pending | ATHER |
