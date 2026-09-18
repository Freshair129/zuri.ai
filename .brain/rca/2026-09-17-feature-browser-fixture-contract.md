---
id: ZAI:RCA-2026-09-17-FEATURE-BROWSER-FIXTURE-CONTRACT
title: Project Feature browser fixtures violated picker and uncertainty contracts
version: "0.1.0b"
status: beta
created_at: "2026-09-17T20:10:00+07:00, RWANG, 052821a7"
last_update: "2026-09-17T20:10:00+07:00, RWANG"
attributes:
  domain: project-manager
  risk: LOW
relations:
  - type: references
    target: ZAI:FR-252
  - type: references
    target: ZAI:PM-PHASE-B-FEATURE-IMPLEMENTATION-PLAN
---

# Project Feature browser fixture contract

## Symptom

The composed browser run failed the owner Feature mutation tests. The
relationship journey stopped while selecting its first supporting Domain, and
the held uncertain graph journey rejected an expected error assertion. The
live CSRF/API/SQLite create, edit, delete and restore journey passed.

## Evidence

The preserved relationship retry trace contains the initial feature-view and
detail GETs but no relationship PUT; the failing action was
`project-feature-mutations.spec.js:371`. The Feature fixture's primary Domain
is `DOM-CRM`, and `supportingDomainExclusions` passes that ID to the picker.

The preserved uncertain-graph trace records the graph PUT returning HTTP 503
with an HTML body. `requestFeatureJson` treats a non-JSON/non-typed refusal as
uncertain, and `describeMutationError` renders the typed UI title
`Response uncertain`. No production request or receipt validation failed.

## Root Cause

The browser fixture selected the Feature's excluded primary Domain instead of
another canonical catalog Domain. Separately, the test expected an old
service-unavailable label for an intentionally untyped gateway response,
while the approved uncertainty contract requires retaining the intent and
showing `Response uncertain`.

## Why the issue escaped detection

Earlier focused runs did not exercise the composed picker exclusion and the
held 503 response through the final UI. Static tests covered the picker and
uncertainty helpers independently, so the fixture-to-UI contract mismatch was
only visible in the composed browser journey.

## Proposed prevention

Use a distinct canonical catalog Domain in supporting-Domain fixtures and
assert the current uncertainty state for untyped gateway responses. Preserve
the strict receipt/refusal validators and exact idempotency, CAS, body and
reconciliation assertions. Re-run the affected browser tests after the root
owned drawer correction; do not add retries or broaden timeouts.

## Validation

Read-only trace inspection confirmed both causes. The corrected browser tests
were not run in this bounded review because the root-owned composed browser
run had ended and no new browser, server, build or governance run was
authorized here.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | beta | Record composed browser fixture and uncertainty assertion corrections | 052821a7 | RWANG |
