---
id: ZAI:RCA-2026-09-17-FEATURE-READ-CAS-TOKEN
title: Feature mutation forms need a scoped current CAS token
version: "0.1.0b"
status: beta
created_at: "2026-09-17T16:50:00+07:00,RWANG,052821a7"
last_update: "2026-09-17T16:50:00+07:00,RWANG"
attributes:
  domain: project-manager
  risk: MEDIUM
relations:
  - type: references
    target: ZAI:FR-252
  - type: references
    target: ZAI:PM-PHASE-B-FEATURE-IMPLEMENTATION-PLAN
---

# Missing read-side CAS header

## Symptom and evidence

W4 requires a current strong Feature or graph ETag for mutations. The W3
Feature detail and aggregate GET handlers return only Cache-Control. The
aggregate DTO includes active Features, but plan24's graph hash includes every
Feature, including tombstones. That active DTO cannot provide the graph token
needed by the approved W5 redistribution form.

## Root cause

W3 implemented the read-only DTO contract before connecting W4/W5 mutation
preconditions. Its route headers omitted the read-side CAS handoff.

## Why it escaped detection

Read tests checked DTOs, visibility, deduplication and no writes. W4 tests
calculated ETags directly from fixtures, so no test exercised a browser's
read-token-then-write path.

## Correction and prevention

The existing detail GET returns the Feature ETag from its returned id/version.
The existing aggregate GET returns the graph ETag to Business owners only,
derived from all scoped Feature ids/versions/deletion instants inside the same
read transaction as the displayed aggregate. Readers receive no tombstone
token. Keep the public body unchanged and no-store. Reuse W4's canonical graph
hash implementation; never derive it from active rows alone. Add tests for
owner/header parity, tombstone participation and shared-reader omission.

## Validation

Implementation and composed tests pending. No public route, persisted model or
production change is introduced by this correction.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | beta | Record the missing read-token handoff within approved CAS and owner visibility contracts | 052821a7 | RWANG |
