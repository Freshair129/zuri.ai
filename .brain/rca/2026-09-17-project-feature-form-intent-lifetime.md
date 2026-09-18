---
title: Feature mutation intent must survive view reload and dialog closure
version: "0.1.1b"
status: beta
created_at: "2026-09-17T19:25:00+07:00,RWANG,working-tree"
last_update: "2026-09-17T20:28:51+07:00,RWANG final integrator"
attributes:
  domain: project-manager
  risk: MEDIUM
  scope: Approved Plan 24 section 7 uncertain-response behavior
---

# Feature mutation intent lifetime

## Symptom

An uncertain operation can be lost when a separate successful operation reloads
the Feature view. Closing and reopening while a request is still in flight can
also offer a fresh command before its original result is known.

## Evidence

The inspected `ProjectFeatureView.jsx` renders `ProjectFeatureForms` only in
its ready branch. Loading, refusal and incomplete-response branches omit it.
`ProjectFeatureForms` owns the pending-attempt Map, so any such transition
destroys that Map. `useFeatureMutation` originally writes the attempt into
that Map only after an uncertain rejection. `FormDialog` permits Escape,
close-button and backdrop closure while the transport is in flight.

The successful reconciliation path calls `onSaved` and rereads data but does
not call a form-specific close handler; normal submission does. A stale
`formAction` can also suspend the drawer when owner capability or current
Feature identity prevents a form from actually rendering.

## Root cause

The request lifetime is coupled to a conditional dialog/view mount. Retention
starts after a failure instead of before dispatch, leaving an untracked period
while the operation may already have reached the server.

## Why the issue escaped detection

The initial transport tests kept the same dialog mounted. The first browser
journeys did not close a delayed request or retain one pending intent while a
different successful mutation triggered a view reload.

## Proposed correction and prevention

Keep the Project-keyed form owner mounted across the existing view states,
while continuing to hide unavailable mutation actions. Retain the exact
attempt before dispatch and prevent a second intent while it is unresolved.
Close the active form after successful receipt and reread. Suspend the drawer
only while a form is actually available. Preserve server reauthorization,
Project isolation and the in-memory-only boundary; do not introduce an offline
outbox or a new API.

Add regressions for delayed closure/reopen, unchanged reconciliation headers
and body, a separate mutation reload, and refusal/focus recovery.

## Validation

Independent source review passes. The owner-form cases pass in the composed
browser run, including in-flight close/reopen, another successful save/reload
and exact retained-intent reconciliation. That run had 45 passes and one
unrelated privacy-locator failure, corrected and covered by two passing
targeted privacy rechecks. Full Server suite: 6376 pass, 32 skipped; optimized
build passes. See the Phase B integration report for frozen hashes.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.1b | 2026-09-17 | beta | Close independent and actual browser proof for retained intent across closure and reload | final frozen source | RWANG |
| 0.1.0b | 2026-09-17 | under review | Record conditional-mount and pre-retention gaps in the approved uncertain-intent flow | working-tree | RWANG |
