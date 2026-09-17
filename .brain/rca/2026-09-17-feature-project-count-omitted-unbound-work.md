---
id: ZAI:RCA-2026-09-17-FEATURE-UNBOUND-WORK-COUNT
title: Project Feature view must count active unbound work
version: "0.1.1b"
status: beta
created_at: "2026-09-17T15:48:00+07:00,RWANG,052821a7"
last_update: "2026-09-17T16:31:00+07:00,RWANG"
attributes:
  domain: project-manager
  risk: MEDIUM
relations:
  - type: references
    target: ZAI:FR-252
  - type: references
    target: ZAI:PM-PHASE-B-FEATURE-IMPLEMENTATION-PLAN
---

# Project total omitted work without a Feature link

## Symptom and evidence

Plan24 section 4 requires the Project total to count distinct active WorkItems,
including unbound work included by the existing view. FR-251's existing Domain
view explicitly counts that population. W3 readWorkItems queried only the IDs
in FeatureWorkLink; buildProjectFeatureView then counted that same link union.
A Project with work but no Features therefore reported zero work.

## Root cause

The Feature relationship population was reused as the Project population.
Per-Feature counts are distinct linked work, while the Project total includes
all eligible Project work, regardless of Feature membership.

## Why it escaped detection

The integration fixture called its second WorkItem unallocated but linked it to
a Feature with null allocationBps. No fixture had an active unlinked WorkItem,
so a correct shared-link dedup assertion could not detect this omission.

## Correction and prevention

The aggregate reads all active Project work inside the existing authorized
transaction, using the shared activeWorkstream predicate and matching container
ownership. Linked-row integrity still refuses invalid references. Count that
Project set once; retain per-Feature link counts and progress unchanged. Prove
an unlinked item and a Project with no Features, as well as inactive exclusions.

## Validation

Local PASS: the composed W3 suite passed 41 tests across five files, including
the new unlinked/deleted/archived and featureless-Project fixtures. Independent
Luna Max static review accepted the exact read-model hash
8490d854f2a65fb1003c2651c2451d7ecad9c2142a9e3b57d832071f1272dcb0
and matching Project-work KPI wording. An actual non-bypass PostgreSQL login
passed 18 isolated read/scope/metadata/cursor checks with five source hashes
unchanged; rows, audits and Workstream progress were preserved.
Evidence: phase-b-integrated-w3-composed-tests-current.log,
phase-b-w3-independent-review.md and phase-b-w3-postgres-proof.json.
Browser verification remains separate and running; no production data affected.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.1b | 2026-09-17 | beta | Record 41 composed tests, independent review and 18 isolated PostgreSQL checks | 052821a7 | RWANG |
| 0.1.0b | 2026-09-17 | beta | Record source-proven Project population omission and scoped correction | 052821a7 | RWANG |
