---
version: "0.1.0b"
created_at: "2026-09-06T21:00:00+07:00,RWANG,e44d482b"
last_update: "2026-09-06T21:00:00+07:00,RWANG"
status: beta
superseded_by: null
---

# Campaign search regression expectation

## Symptom

The integrated browser regression passed 105 tests, skipped 4 and failed one:
reserved-domain search expected Campaigns to have no search matches.

## Evidence

navigation-reachability.spec.js:143 hard-codes Commerce and Campaigns as reserved.
The same run passed both Campaign browser journeys. Enumerated src/config/domains.js
marks Commerce soon:true but declares the delivered /growth/campaigns entry.
The failure reproduced on retry; it is not a flaky navigation result.

## Root Cause

The reserved-menu test retained the pre-implementation Campaign assumption after
FR-156 activated the native route. Root updated navigation and focused contracts
but did not reconcile the existing browser assertion with that changed behavior.

## Why the issue escaped detection

Focused Marketing tests do not include the shared navigation regression file.
The full browser suite correctly surfaced the old assumption.

## Proposed prevention

Retain the negative Commerce assertion and replace only the obsolete Campaign
expectation with a real command-palette navigation to the Campaign heading.
Re-run the full browser suite, including the affected file, with fail-on-flaky.

## Resolution evidence

The full reconciled run passed 106 browser tests, skipped 4, with no failures or
flaky tests. The Campaign search navigation and Commerce exclusion both passed.
