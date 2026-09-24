---
id: ZAI:RCA-2026-09-24-FILE-OPERATION-INTENT-BEFORE-STREAM
title: File operation intent was created after the HTTP body stream
version: "0.1.0b"
status: beta
created_at: "2026-09-24T11:04:26+07:00,Codex, base fad8ec6"
last_update: "2026-09-24T11:04:26+07:00,Codex"
attributes:
  domain: file-management
  risk: HIGH
relations:
  - type: relates_to
    target: ZAI:ADR-107
---

# File operation intent was created after the HTTP body stream

## Symptom

Before the correction, an upload did not have a durable operation record while
the HTTP handler received the body. If the client disconnected before the
stream completed, there was no pending operation identity to reconcile or
retry from the service database.

## Evidence

- The pre-fix handler called receiveBody before createFile or appendVersion.
  Those service methods created FileOperation only after the full body had
  arrived and passed its length and digest checks.
- The regression now starts an upload with a valid declared Content-Length,
  sends one byte, and disconnects. It observes exactly one PENDING operation
  and zero storage writes before retrying.
- The retry uses the same operation and idempotency headers. It returns the
  original operation receipt, commits one version, and creates exactly one
  storage object.
- The focused service suite completed with 33 passed, zero failed and zero
  skipped. The source syntax check also passed.

## Root Cause

The HTTP flow placed durable operation creation after network body intake.
Streaming validation protected storage from incomplete or mismatched bytes,
but the service could not retain operation identity for a disconnect that
occurred before the stream completed.

## Why the issue escaped detection

Existing upload tests sent complete bodies and asserted the final file, version
and storage state. They did not interrupt a request before body completion or
assert that a retryable operation existed during streaming.

## Proposed prevention

Validate declared length and request metadata first, then durably begin the
idempotent operation before reading the body. Keep object writes behind the
complete length and digest checks. Retain a disconnect-and-retry regression
that proves one pending operation, no early object write and one final object
under the same idempotency identity.

## Validation boundary

The regression uses an in-memory repository and storage provider. It verifies
HTTP sequencing and retry behavior in the service harness, not a live
PostgreSQL transaction, MinIO version store, authority endpoint, container, or
production deployment.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-24 | beta | Record the upload-intent ordering defect, its regression evidence and prevention | working-tree | Codex |
