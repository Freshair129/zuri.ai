---
title: Feature view refusal must mask independently cached detail
version: "0.1.2b"
status: beta
created_at: "2026-09-17T19:39:00+07:00,RWANG,working-tree"
last_update: "2026-09-17T20:28:51+07:00,RWANG final integrator"
attributes:
  domain: project-manager
  risk: MEDIUM
  scope: Approved Plan 24 section 7.4 scoped loading and refusal
---

# Feature view refusal and modal isolation

## Symptom

A successful matching detail response can remain visible while the aggregate
Feature view is loading or refuses access. A suspended detail drawer also
retains modal semantics and can reclaim focus from a later dialog.

## Evidence

The independent drawer review inspected the loading, refusal and incomplete
returns in `ProjectFeatureView.jsx`. Each passed the unmodified `detail` state
to `FeatureDrawer`; its local identity check knew nothing about the aggregate
refusal. The drawer always declared `aria-modal="true"`, and its focusout
handler scheduled an untracked timeout that survived effect cleanup.

The composed browser run subsequently passed 42 tests and failed four. Its
create/edit flow failed twice at `project-feature-mutations.spec.js:348`: after
Escape the visible Edit Feature button was not focused. The drawer's effect
depends on `suspended`, so opening a form invokes its cleanup and focuses the
external pre-drawer opener. `FormDialog` then records that wrong element as its
own return target. The failed trace and screenshots are retained in operator
artifact `phase-b-browser-composed-attempt1-failed-artifacts.zip`, SHA-256
`B28A38D2D6C40260F2A6073A8684C6F899217632755FCEF1BFB58C9EC64BB6F6`.

## Root cause

Two independently loaded views enforced current response identity but did not
share the parent refusal/loading boundary. Keyboard listener suspension did
not also suspend accessibility semantics or deferred focus work.
External-opener restoration also shared the suspension-sensitive effect,
conflating temporarily suspending a drawer with closing it.

## Why the issue escaped detection

Earlier tests exercised aggregate refusals without a selected successful
detail, and detail failures without an aggregate refusal. They did not combine
the two independently completing requests or nested modal transitions.

## Correction and prevention

Non-ready branches pass no detail data and show the aggregate loading/refusal
state. The ready branch retains the existing Project/Feature identity checks.
A suspended drawer is inert, hidden from the accessibility tree and no longer
declares modal ownership. Focus timers are cancelled and guarded at cleanup;
resuming the drawer preserves focus already restored to its controls.

Separate the drawer's Project/Feature lifetime from the suspension-sensitive
keyboard trap. Restore the external opener only when that drawer lifetime ends.
Capture the exact connected action control before opening a child form and
return focus to that control when the drawer resumes; use the existing close
control if the old action no longer exists. This implements the already
approved Escape/focus contract without changing authorization or adding a new
dialog abstraction.

Add combined aggregate/detail refusal regression and verify only the active
dialog is accessible during owner editing, including focus return on Escape.
No API, schema, authorization or data persistence rule changes.

## Validation

The prior frozen source passed independent static review but failed the actual
Escape/focus browser assertion. The four browser failures remain recorded;
the narrow focus correction passes a separate independent source review and
its strict Escape assertion passes in the composed run. A remaining privacy
locator fixture failure was corrected without product changes; both targeted
privacy rechecks pass with zero skips/flaky outcomes. The strict Escape focus
and page-wide loading/refusal absence assertions remain intact.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.2b | 2026-09-17 | beta | Close the focus defect with independent review and an unchanged strict browser assertion | View 0B720943 | RWANG |
| 0.1.1b | 2026-09-17 | under review | Record actual Escape focus failure and separate drawer lifetime from temporary suspension before correction | frozen View 4F7A0517 | RWANG |
| 0.1.0b | 2026-09-17 | under review | Mask stale detail at parent refusal and isolate modal/focus ownership | working-tree | RWANG |
