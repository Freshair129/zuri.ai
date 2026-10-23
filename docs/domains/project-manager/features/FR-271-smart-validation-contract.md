---
domain: project-manager
feature: FR-271
module: business
source: v2-native
---

# FR-271 — SMART validation contract

| Field | Value |
|---|---|
| **Version** | 0.4.0b |
| **Status** | B3 contract reconciled before implementation; local service/API, adapter and browser qualification recorded below. Hosted CI and deployment not verified. |
| **Date** | 2026-10-23 (B3 contract reconciliation; original design 2026-09-22) |
| **Relates to** | FR-268, FEAT-002, ADR-101 |

## Historical B1 source finding — partial server path

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
The B3 implementation below resolves this finding locally; this paragraph retains
the historical B1 source boundary.

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

## B3 interpretation before implementation — 2026-10-23

The owner selected B3 and explicitly retained FR-268's optional due date.
This interpretation combines the exact canonical FR-268/FR-271 version-1
statements and ADR-101 D3: **evaluating** a false SMART check does not imply
that every false result prevents persistence. No canonical statement, identity,
membership or held delivery-cell migration changes here. The older blanket
Time-bound refusal wording is superseded by this matrix.

| Candidate state at create/edit | Write result | Returned shared SMART result |
|---|---|---|
| Due date omitted/null, or explicitly cleared | Allowed | `timeBound: false`; optional-date feedback, never a fabricated pass |
| Newly supplied or changed due date is invalid, before acceptance time, or after Goal target | Refuse 400 before any row/progress/audit write | Existing validation envelope; no success DTO |
| Supplied date equals acceptance time or Goal target | Allowed when both inclusive bounds hold | `timeBound: true` |
| Existing due date has passed, or exceeds a subsequently changed Goal target; date remains unchanged in partial or full-form patch | Allow other valid edits, including archive/confidence; do not require repairing historical dates | Re-evaluate at current acceptance time and return `timeBound: false` |
| Missing/nonfinite numeric target/baseline, empty/whitespace metric or unit, or target equals baseline | Refuse 400 using the shared Measurable result plus input validation | No success DTO |
| Title only repeats Goal title (ignoring case/edge whitespace) | Allowed with Specific warning; empty titles remain invalid input | `specific: false` |
| Achievable / Relevant | Never automatic write gates | Both always `null` |

Invalid date means a non-null value that input validation cannot parse as a
date. Refusals retain the normal 400 validation envelope; `smartChecks` and
`smartCheckedAt` are promised only for successful mutation DTOs.

Create and every patch (including an empty patch) evaluate the **merged effective
row** against the parent Goal read in the transaction, after the existing Business
serialization fence. Changed-date detection compares instants, so an unchanged
date submitted by the edit form is treated like an omitted field. An empty patch
returns fresh feedback without incrementing versions, recomputing progress or
creating an audit event. Other ownership, WIG lag and audit contracts remain in
force. The default comparison time is captured after the fence; an explicit
service clock is a deterministic test seam, never a body field.
The fence serializes Key Result/WIG writers; it does not serialize a concurrent
Goal target-only edit. A later Goal edit can change subsequent feedback, as the
unchanged-historical-date case explicitly permits. Existing status patches keep
their Business version increment; feedback/ordinary edits use a no-op fence.

Successful mutation DTOs add nonpersisted `smartChecks` (the exact shared pure
function's five-field result) and `smartCheckedAt` (the comparison instant).
No schema migration, score, stored SMART flag or new endpoint is introduced.
The live form calls the same function; optional date/Specific feedback is
explicitly advisory. Response feedback describes its server comparison instant,
not an assurance that the client clock never differs. Unrelated historical
invalid Measurable rows must be repaired before a nonempty edit; an empty patch
may report their false checks without claiming a write.

Verification covers create/patch through service and registered HTTP routes,
date bounds and unchanged legacy dates, no-effect refusals, and matching shared
calculator results at `smartCheckedAt` on SQLite/PostgreSQL. Browser qualification
uses this worktree's seeded target; a delayed refusal preserves the current
draft/focus, and a response from a closed modal must not close its replacement.
Closing the form does not promise rollback of an already submitted server write. Existing KPI,
WIG, bootstrap and Feature browser suites remain selected B3 inputs. Synthetic
UI fixtures are reported separately from real persisted API/browser acceptance.

## In scope (Phase 1, alongside FR-268)

- `smartChecks()` as a pure, independently unit-tested function in
  `project-manager/progress/smart-checks.js`.
- The Key Result create/edit form calls the same function client-side for the
  live checklist a person sees while typing — never a second, divergent
  implementation.
- Server target: call the shared function at write time under the B3 matrix
  above. Optional dates and unchanged historical dates can return false
  Time-bound feedback without refusing unrelated edits.

## Out of scope (this FR)

Any numeric "SMART score" presented as a single fabricated number; scoring
Achievable or Relevant by heuristic (both stay `null` — see Statement).

## Verification inputs and local qualification

- `smartChecks()` returns the expected booleans/`null`s for a table of known
  inputs (unit test), including boundary cases: `target === baseline`,
  `dueAt` before `now`, `dueAt` after the goal's own `targetAt`.
- A Key Result cannot be created with `target === baseline` or a past `dueAt`
  (integration test, mirrors the client checklist's own state).

The [B3 evidence](../../../plans/PM-EXISTING-DELIVERY-QUALIFICATION-20261023.md#b3-local-qualification--2026-10-23)
records shared create/patch evaluation, successful response feedback, optional-date
and Specific guidance, and stale-modal callback guards. Selected SQLite checks
passed 64 with one existing provider-only skip; selected PostgreSQL checks passed
52 without skips. The selected browser profile passed 23 without retries,
including real persisted optional-date feedback and synthetic delayed-response
boundaries. These results do not adopt held canonical delivery rows or establish
hosted CI, migration replay, deployment-role grants or production acceptance.

0.2.0b (2026-10-23): replace stale design-only status with source-bound B1 disposition; no fresh runtime/deployment acceptance or canonical migration.

0.3.0b (2026-10-23): resolve B3 SMART evaluation/refusal handling before code,
preserving optional dates and canonical meaning; execution results still pending.

0.4.0b (2026-10-23): record local B3 implementation and selected adapter/browser
qualification, preserving the historical B1 finding and external release gates.
