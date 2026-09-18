---
id: ZAI:RCA-2026-09-17-FEATURE-DETAIL-RENDERING
title: Feature detail omitted supplied fields and a test targeted the wrong state node
version: "0.1.1b"
status: beta
created_at: "2026-09-17T16:17:00+07:00,RWANG,052821a7"
last_update: "2026-09-17T16:34:00+07:00,RWANG"
attributes:
  domain: project-manager
  risk: LOW
relations:
  - type: references
    target: ZAI:FR-252
  - type: references
    target: ZAI:PM-PHASE-B-FEATURE-IMPLEMENTATION-PLAN
---

# Feature detail rendering and state locator

## Symptom and evidence

The composed W3 browser run passed 18 cases and failed three deterministically.
The 390px drawer test found the Feature code/problem but no Snapshot label;
the delayed-transition test found the initial Feature code but not its title.
The wrong-Project refusal visibly showed the safe error and no foreign data,
but the test expected data-detail-view-state on the dialog wrapper. The actual
attribute belongs to the inner state region. Evidence:
phase-b-integrated-w3-browser.log and its retained screenshots/traces.

## Root cause

FeatureDetail rendered code and lifecycle while omitting the supplied title,
canonicalFeatureKey and governanceSnapshotId. Plan24 section 7.4 requires the
Ready state to render supplied fields and evidence state. A separate test
assumed the state attribute belonged to the wrapper instead of querying the
observed state region, which the loading test already did correctly.

## Why it escaped detection

The isolated exploration checked code/problem, focus and history but did not
run the complete authored browser suite. Static review verified scope and
stale identity protection without comparing every detail field to the DTO.

## Correction and prevention

Render the title and the stored canonical/snapshot references in the detail
summary, with explicit unlinked/unavailable values. A stored reference does
not imply verified evidence. Target the visible inner refusal state in the
test while retaining exact error state, no foreign payload, close/history,
and delayed-response stale-data assertions. Keep assertion budgets unchanged.

## Validation

The corrected composed browser run passed all 21 cases with no flaky result
and exit code zero. Evidence: phase-b-integrated-w3-browser-recheck.log and its
preserved JSON report. The run includes the six Feature cases, four Domain
cases, ten navigation cases and one warmup. The prior 18-pass/three-failure
run and its artifacts remain preserved. The 41 local service/navigation tests
and 18 actual PostgreSQL checks remain separate evidence; no production was
changed.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.1b | 2026-09-17 | beta | Record the corrected composed browser run: 21 pass, zero flaky, prior failures retained | 052821a7 | RWANG |
| 0.1.0b | 2026-09-17 | beta | Record three composed browser failures, observed omissions and exact state-node correction | 052821a7 | RWANG |
