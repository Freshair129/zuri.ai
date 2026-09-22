---
domain: project-manager
feature: FR-271
module: business
source: v2-native
---

# FR-271 — SMART validation contract

| Field | Value |
|---|---|
| **Version** | 0.1.0b |
| **Status** | Declared — design only, not implemented, not deployed |
| **Date** | 2026-09-22 |
| **Relates to** | FR-268, FEAT-002, ADR-101 |

## Statement

Creating or editing a `BusinessKeyResult` runs a pure `smartChecks(input, goal,
now)` function returning the deterministic subset of SMART as booleans:
**Specific** — a title present and distinct from its goal's own title;
**Measurable** — `metric`, `unit`, `baseline` and a `target` different from the
baseline are all present; **Time-bound** — `dueAt` is present, on or after
`now`, and on or before the goal's own `targetAt` when the goal has one. It
returns **Achievable** and **Relevant** as `null`, never a fabricated pass or
fail, because both are human judgement a server-side check cannot honestly
make — the same honesty pattern the existing FR-070 roadmap read model uses
for an `UNAVAILABLE` field it cannot compute.

## In scope (Phase 1, alongside FR-268)

- `smartChecks()` as a pure, independently unit-tested function in
  `project-manager/progress/smart-checks.js`.
- The Key Result create/edit form calls the same function client-side for the
  live checklist a person sees while typing — never a second, divergent
  implementation.
- The server calls the same function as an enforcement gate: Measurable and
  Time-bound are refused at write time if false; Specific is surfaced as a
  warning, not a hard refusal, because a title collision alone should not
  block saving a real Key Result.

## Out of scope (this FR)

Any numeric "SMART score" presented as a single fabricated number; scoring
Achievable or Relevant by heuristic (both stay `null` — see Statement).

## Verification (when Phase 1 ships)

- `smartChecks()` returns the expected booleans/`null`s for a table of known
  inputs (unit test), including boundary cases: `target === baseline`,
  `dueAt` before `now`, `dueAt` after the goal's own `targetAt`.
- A Key Result cannot be created with `target === baseline` or a past `dueAt`
  (integration test, mirrors the client checklist's own state).
