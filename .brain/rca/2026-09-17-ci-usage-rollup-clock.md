---
id: ZAI:RCA:2026-09-17-ci-usage-rollup-clock
title: CI usage rollup replay fixture used wall-clock audit time
status: resolved
scope: tests/unit/usage-events.test.js
---

# RCA — CI usage rollup replay fixture used wall-clock audit time

## Symptom

The required `tests` job failed in `tests/unit/usage-events.test.js`: the
same-UTC-day replay returned `audit-2` and `alreadyRanToday: false` instead of
the original `audit-1` receipt.

## Evidence

The failing test passes `now = 2026-09-16T12:00:00Z`. Its fake audit writer used
`new Date()`, so CI on 2026-09-17 stored the audit outside the requested day
window. The failure reproduced locally with 1 failed and 9 passed tests.

## Root cause

The unit-test fake database mixed an injected service clock with the host wall
clock. The production audit default is real time, but the deterministic fake
must use the test's chosen time when the test verifies a historical UTC window.

## Why detection escaped

The test passed when the host date matched the hard-coded test date and failed
only after the calendar crossed midnight.

## Prevention

The fake audit writer now accepts an explicit `auditNow` control, and the replay
test sets it to the injected `now`. Future time-window tests must keep all fake
timestamps on the injected clock.
