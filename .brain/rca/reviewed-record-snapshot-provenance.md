---
status: active
superseded_by: null
version: "0.1.0"
---

# Reviewed record snapshot provenance

## Symptom

Main's reviewed FR-278 cannot pass the original canonical snapshot reader.

## Evidence

Main `077796622233bf9f35905f7eac226f0963760dcb` records FR-278 with `status: reviewed-migration`, `migration_base_revision` and `migration_document`, deliberately omitting `source_revision`. The original snapshot reader requires `record.sourceRevision === index.sourceRevision` for every record. The registry CLI separately checks an approved migration document, while the snapshot reader does not read that document or verify the reviewed base's ancestry.

## Root Cause

Snapshot verification assumed every v1 record was an initial imported record. Main added a second v1 provenance dialect without extending this runtime reader's provenance checks.

## Why the issue escaped detection

Canonical snapshot fixtures contained only initial imported v1 records; reviewed registration tests exercised the CLI rather than committed capture and replay.

## Proposed prevention

Share reviewed-document validation between readers, include the approved document in committed snapshot inputs, and verify the migration base is an ancestor of the captured commit. Cache provenance only by the complete base/document/digest tuple. Add capture/replay and deliberate missing, draft, unapproved and non-ancestor regressions, including all three dialects in one snapshot.
