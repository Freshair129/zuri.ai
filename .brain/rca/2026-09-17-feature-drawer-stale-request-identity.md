---
id: ZAI:RCA-2026-09-17-FEATURE-DRAWER-IDENTITY
title: Feature drawer must mask stale request identity before effects
version: "0.1.1b"
status: beta
created_at: "2026-09-17T15:20:00+07:00,RWANG,052821a7"
last_update: "2026-09-17T15:37:47+07:00,Luna Max"
attributes:
  domain: project-manager
  risk: MEDIUM
relations:
  - type: references
    target: ZAI:FR-252
---

# Feature drawer request identity

## Symptom

The first render after changing a selected Feature or Project can retain the
previous detail before the new request effect clears it.

## Evidence

In the frozen W3 ProjectFeatureView.jsx, useFeatureDetail stores projectId and
featureId alongside data, but returns that state without comparing them with
its current arguments. Its reset runs inside useEffect. FeatureDrawer renders
detail.data directly. The enclosing list masks a mismatched Project identity,
but every loading/error/list branch still passes the same detail state to the
drawer without a corresponding identity guard.

## Root cause

Clearing asynchronous data in an effect occurs after rendering. It cannot
establish the render-time invariant that the displayed record belongs to the
current request. This is a source-proven first-render gap; a browser regression
must verify the delayed-response transition before closure.

## Why it escaped detection

Initial W3 exploration verified stable drawer loading, Escape, focus and Back,
but did not prove an identity change while a later detail request was pending.

## Correction and prevention

Derive the returned/renderable detail from current Project and Feature identity.
On mismatch return a loading state with null data/error immediately, then let
the effect start the request. Keep cancellation of late previous responses.
The existing required nullable DTO fields must be present; enforce the
canonicalFeatureKey/governanceSnapshotId pair without interpreting missing
fields as null. Extend the browser transition regression; retain all existing
scope and stale-list assertions.

## Validation

The W3 component now masks a detail state whose Project or Feature identity
does not match the current render, and it checks the required nullable DTO
fields plus the canonical reference pair by own-key presence. The E2E spec
adds a delayed selected-Feature query transition and asserts that the prior
Feature does not appear before the new response is released. An isolated
route-stubbed browser exploration on 390px at `http://127.0.0.1:3187` observed
the loading state and no prior detail payload during the held response. The
temporary server and port were stopped and cleared. `node --check` for the
spec and `git diff --check` pass. Vitest, the browser suite, build and
governance remain unrun by this worker. No production change.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | beta | Record render-time request identity gap and narrow correction under approved W3 scope | 052821a7 | RWANG |
| 0.1.1b | 2026-09-17 | beta | Close the render-time detail identity and required-field gaps; add delayed-transition evidence | working-tree@052821a7 | Luna Max |
