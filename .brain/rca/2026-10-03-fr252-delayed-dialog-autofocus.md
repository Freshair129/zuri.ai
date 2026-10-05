# FR-252 delayed dialog autofocus steals the selected input

## Symptom

The full browser gate failed because the snapshot/delete/restore case in
`tests/e2e/project-feature-mutations.spec.js:362` passed only on retry. The
Capture governance snapshot dialog remained open after submission.

## Evidence

Base: `80f630a7a6ea82f8efa429c4639c21d1c6f0d27c`.
The original failure screenshot shows the manifest hash appended to Repository
ID, an empty Manifest hash input, and native required-field validation. The
failed first attempt has a screenshot; the stored trace belongs to the passing
retry and is not evidence of the failed attempt's event timing.

`ProjectFeatureForms.jsx` FormDialog schedules unconditional first-input focus
in requestAnimationFrame. The peer FeatureDrawer already avoids initial focus
when its panel contains the active element.

A deterministic regression delays the dialog animation-frame callbacks, selects
Manifest hash, then releases those callbacks. Against the unchanged production
build, it fails `toBeFocused()` with retries disabled: 1 failed, exit 1. Evidence:
`output/playwright/fr252-focus-before.log`. This reproduces the focus-stealing
mechanism without relying on load or repeated random runs.

## Root Cause

Deferred initial autofocus does not check whether the user has already focused
a control inside the dialog. It can interrupt a later input operation, moving
subsequent text into the first input. The empty required field then blocks form
submission before an API mutation, explaining the dialog-close timeout.

## Why the issue escaped detection

The journey covered successful mutations but neither controlled autofocus timing
nor asserted the complete snapshot payload. A passing retry concealed the timing
dependency in individual observations; the strict full-suite flaky gate exposed it.

## Proposed prevention

Preserve focus already inside FormDialog before applying initial autofocus.
Keep normal initial focus, keyboard trapping, Escape and focus restoration.
Retain a browser regression with controlled frame ordering, exact field values
and snapshot request-body assertions. Keep the existing timeout and strict
flaky gate. C-2 / MEDIUM; owner explicitly requested this repair.

## Verification

Before fix: deterministic browser regression FAIL (1 failed, retries 0).
After fix: forms/pickers 25/25 PASS; production build PASS; all seven FR-252
browser cases PASS with retries disabled, including the deterministic regression.
The first full suite after this repair still failed in separate pairing tests;
see `2026-10-03-e2e-login-navigation-race.md`. Its FR-252 cases passed.
Combined FR-046/Edge/FR-220/FR-252 regression after both fixes: 13/13 PASS,
retries disabled. Final full-suite evidence is recorded in the implementation
report's browser-gate follow-up.
