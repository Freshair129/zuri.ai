---
id: ZAI:RCA-2026-09-17-FEATURE-DRAWER-SUSPENSION
title: Feature drawer must remain suspended during mutation reload states
version: "0.1.0b"
status: beta
created_at: "2026-09-17T18:50:00+07:00,Luna Max"
last_update: "2026-09-17T18:50:00+07:00,Luna Max"
attributes:
  domain: project-manager
  risk: MEDIUM
relations:
  - type: references
    target: ZAI:FR-252
---

# Feature drawer suspension during mutation reload

## Symptom

After a Feature mutation begins its fresh aggregate/detail reread, the
underlying detail drawer can regain its Escape and focus-trap handlers while
the mutation FormDialog is still open.

## Evidence

`ProjectFeatureView.jsx` passed `suspended={Boolean(formAction)}` to the
`FeatureDrawer` in the ready branch, but the loading, refusal and incomplete
branches mounted the same drawer without the prop. `FeatureDrawer` installs
its handlers whenever it has a selected Feature and `suspended` is false.
`onSaved` starts `view.reload()` before the form closes, so the branch can
change during that interval.

## Root cause

The suspension state was applied inconsistently across conditional render
branches. The component defaulted the omitted prop to `false`, turning a
transient reload state into a second active modal boundary.

## Why it escaped detection

The initial drawer and form flows exercised the ready branch. They did not
hold a mutation form open while the aggregate response transitioned through a
loading or refusal state.

## Correction and prevention

Every `FeatureDrawer` mount now receives the same
`suspended={Boolean(formAction)}` value. Future conditional branches must
preserve modal suspension and should add a regression that holds the reread
during an open mutation dialog, checking Escape and focus remain with the
topmost dialog.

## Validation

The correction was reviewed statically. No tests, browser run, build, server
or governance command was run by this worker. Root owns the composed W3 browser
verification.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | beta | Apply mutation suspension consistently to all Feature drawer branches | working-tree | Luna Max |
