---
id: ZAI:RCA-2026-09-24-CATALOG-FILE-UPLOAD-OUTCOME
title: Catalog upload reports failure after its original is stored
version: "0.1.1b"
status: beta
created_at: "2026-09-24T00:00:00+07:00,Codex"
last_update: "2026-09-24T00:00:00+07:00,Codex"
attributes:
  domain: knowledge
  risk: MEDIUM
relations:
  - type: relates_to
    target: ZAI:FR-187
  - type: relates_to
    target: ZAI:ADR-075
---

# Catalog upload reports failure after its original is stored

## Symptom

Uploading a valid catalog for Business B returns `KNOWLEDGE_RUNTIME_UNAVAILABLE`
when the configured Knowledge runtime is bound to Business A. The request is
reported as failed even though B's original bytes and active `FileAsset` were
stored.

## Evidence

- In `smartgift-catalog-upload-service.js`, object storage and
  `createManagedBlobFileAsset` complete before the call to `admitKnowledge`.
- `resolveKnowledgeRuntimeBinding` in `knowledge-runtime.js` accepts exactly one
  binding and requires its `businessId` to match the requested Business.
- Before the fix, the disposable A/B integration regression failed at the upload
  call with `KNOWLEDGE_RUNTIME_UNAVAILABLE`. Its preceding assertions passed:
  Business B's active `FileAsset` had the expected SHA-256, the stored object
  matched the original bytes, and no Knowledge source referenced the asset.
- Reproduction command: `npx vitest run
  tests/integration/smartgift-catalog-admission.test.js -t "stores Business B
  original bytes"` from `apps/server`; one targeted test failed, nine were
  skipped by the test-name filter.
- After the change, the focused uploader/UI/A-B command completed with 3 test
  files and 33 tests passed, zero skipped, exit 0. The B fixture now observes a
  stored original and an explicit `UNAVAILABLE` Knowledge outcome.

## Root Cause

The catalog endpoint composes two owners in sequence: Files stores the original,
then Knowledge admission resolves a Business-specific runtime binding. The
endpoint propagated the downstream Knowledge 503 as the whole operation's
failure, so the API and UI conflated `FileAsset stored` with `Knowledge admitted`.
The Knowledge runtime's single-binding guard is intentionally fail-closed; it is
not the Files storage failure.

## Why the issue escaped detection

The unit test for the catalog uploader replaces `admitKnowledge` with a mock,
and the Knowledge integration suite manually creates a `FileAsset` while
provisioning a matching runtime binding. Neither exercised the real upload path
for a second Business in the same Tenant with no matching Knowledge binding.
The UI also assumed every 2xx catalog response included an admission result.

## Proposed prevention

Return explicit additive file and Knowledge outcome fields. Preserve the
existing admission payload on success; report typed `KNOWLEDGE_*` admission
errors as `FAILED`, except the known runtime-unavailable result, which is
`UNAVAILABLE`. Let untyped failures propagate. Keep authorization, validation,
storage, and asset-registration errors fail-closed. Show the saved-file state
and Knowledge outcome in the UI, and retain the A/B integration regression
against the actual services.

## Validation boundary

This evidence uses a disposable per-run SQLite database and an in-memory object
storage port with synthetic catalog bytes. It does not prove live MinIO,
production behavior, multi-Business runtime routing, Knowledge processing, or
publication. Production activation and migration remain outside scope.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.1b | 2026-09-24 | beta | Reproduce the stored-original state and verify explicit partial outcome plus preserved untyped failures | working-tree | Codex |
