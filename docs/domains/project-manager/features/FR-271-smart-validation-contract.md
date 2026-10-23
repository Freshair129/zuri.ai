---
domain: project-manager
feature: FR-271
module: business
source: v2-native
---

# FR-271 — SMART validation contract

| Field | Value |
|---|---|
| **Version** | 0.2.0b |
| **Status** | PARTIAL — shared calculator and live UI checklist present at 2c13f616; shared server evaluation/time-bound handling remains a source finding for B3. Deployment not verified. |
| **Date** | 2026-10-23 (B1 source inspection; original design 2026-09-22) |
| **Relates to** | FR-268, FEAT-002, ADR-101 |

## B1 source finding — partial server path

Source `2c13f6166bc865dd14aadcab3904b0f3eea42197` contains the pure
[calculator](../../../../apps/server/src/modules/project-manager/progress/smart-checks.js),
its [unit tests](../../../../apps/server/tests/unit/fr271-smart-checks.test.js),
and the shared [client checklist](../../../../apps/server/src/modules/project-manager/components/StrategyEditModals.jsx).
The Phase 1 commit `02f54a5210d32b1a63dff565beac2a590fa3dda0` is an ancestor.
However, [create/update writers](../../../../apps/server/src/modules/project-manager/application/business-strategy-mutation-service.js)
do not import/call `smartChecks`: create validation requires unequal target and
baseline but permits null/omitted dates; patch separately checks unequal values
and accepts nullable dates without the calculator's current/Goal date bounds.
The API routes call those writers directly. The existing integration suite even
contains successful no-due-date inputs; a pure calculator test is not server
integration proof. This is static source evidence, not a new runtime reproduction.

[Canonical FR-271](../../../features/FEAT-002/requirements/FR-271.md) and
[ADR-101 D3](../../../decisions/ADR-101-BUSINESS-GOALS-BECOME-OKR-SMART-BSC-4DX.md#d3--smart-is-split-into-what-a-server-can-honestly-check-and-what-it-cannot)
require the shared write-time calculation; the canonical FR-268 due date remains
optional. The hard-refusal bullet in this older note is desired design wording,
not evidence that the server enforces it or authority to make due dates mandatory.
The [B3 amendment](../../../plans/PM-EXISTING-DELIVERY-QUALIFICATION-20261023.md#task-b3-strategy-and-bootstrap-adapterbrowser-qualification)
requires exact source-contract reconciliation, then failing create/patch cases
and reviewed shared-calculator integration before the behavior is accepted.
B1 changes no application code, policy or canonical statement.

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
- Future server target: call the shared function at write time. The older
  design proposed refusing false Measurable/Time-bound checks and warning on
  Specific instead of blocking a title collision. B3 must reconcile this
  refusal policy with FR-268's optional due date before adopting a correction;
  it is not implemented server behavior or a new mandatory-date rule.

## Out of scope (this FR)

Any numeric "SMART score" presented as a single fabricated number; scoring
Achievable or Relevant by heuristic (both stay `null` — see Statement).

## Verification inputs and remaining qualification

- `smartChecks()` returns the expected booleans/`null`s for a table of known
  inputs (unit test), including boundary cases: `target === baseline`,
  `dueAt` before `now`, `dueAt` after the goal's own `targetAt`.
- A Key Result cannot be created with `target === baseline` or a past `dueAt`
  (integration test, mirrors the client checklist's own state).

0.2.0b (2026-10-23): replace stale design-only status with source-bound B1 disposition; no fresh runtime/deployment acceptance or canonical migration.
