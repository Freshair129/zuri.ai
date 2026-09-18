---
id: ZAI:RCA-2026-09-17-FEATURE-INACTIVE-PROVENANCE
title: Inactive provenance must not hide the historical Feature
version: "0.1.0b"
status: beta
created_at: "2026-09-17T17:15:00+07:00,RWANG,052821a7"
last_update: "2026-09-17T17:15:00+07:00,RWANG"
attributes:
  domain: project-manager
  risk: MEDIUM
relations:
  - type: references
    target: ZAI:FR-252
  - type: references
    target: ZAI:PM-PHASE-B-COMMIT-PROVENANCE
---

# Inactive provenance source

## Symptom and evidence

readProjectRepositories rejected a same-Business Repository with status DELETED
as DATA_INTEGRITY_UNAVAILABLE before the evidence verifier could run. That
turns an inactive source into a whole-Feature 503. Doc27 requires unavailable
sources to preserve historical references while returning unavailable evidence.

## Root cause

The W3 metadata join combined scope integrity with source availability. Only
the former invalidates the authorized relationship; the latter is an evidence
state derived by W5's active-source verifier.

## Why it escaped detection

W3 tested missing key proof and cross-scope reads, but its Repository fixture
always remained ACTIVE. No test deactivated a source after a valid capture.

## Correction and prevention

Keep exact Project/Repository/Business identity checks. Permit an inactive
same-scope source through the metadata join, then require the existing verifier
to prove ACTIVE before any AVAILABLE/PINNED result. Add an actual-GET case that
deactivates the fixture Repository and preserves snapshot IDs with null subject.

## Validation

Composed actual-Git/SQLite GET regression pending; no production change.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | beta | Separate scoped relationship integrity from inactive source evidence | 052821a7 | RWANG |
