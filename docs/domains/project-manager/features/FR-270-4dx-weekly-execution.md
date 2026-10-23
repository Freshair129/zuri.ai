---
domain: project-manager
feature: FR-270
module: business
source: v2-native
---

# FR-270 — 4DX weekly execution

| Field | Value |
|---|---|
| **Version** | 0.2.3b |
| **Status** | Phase 3 merged via PR #647 as `8a2fd498`; dated exact-head hosted governance, build, tests, and specialized checks were recorded as passing; production migration and live-business acceptance remain separate |
| **Date** | 2026-10-12 |
| **Relates to** | [ZAI:FR-270](../../../features/FEAT-002/requirements/FR-270.md), [FEAT-002](../../../features/FEAT-002/feature.md), [ADR-101 D1/D5/D6](../../../decisions/ADR-101-BUSINESS-GOALS-BECOME-OKR-SMART-BSC-4DX.md), [BR-043](../../../requirements/BR-043.md), [FR-268](../../../features/FEAT-002/requirements/FR-268.md), [FR-269](../../../features/FEAT-002/requirements/FR-269.md), [FR-059](../../../requirements/FR-059.md) |

## Statement

A Business may mark at most two active `BusinessGoal` rows Wildly Important
(`isWig=true`, non-archived — BR-043, counted per Business because more than
one `BusinessRoadmap` may be ACTIVE at once). Each WIG names one existing
`BusinessKeyResult` as its lag measure and may hold zero or more
`BusinessLeadMeasure` rows — a weekly-target metric the team directly
controls — with weekly `BusinessLeadMeasureValue` entries. A
`BusinessWeeklyCommitment` records what a named Person commits to for the
week, optionally tied to one lead measure. A `BusinessWigSession` records the
weekly report / scoreboard / plan ritual for one Business and
`weekStartAt` (Monday 00:00, `Asia/Bangkok`).

## Phase 3 contract decisions

These rules make the existing FR-270 and ADR-101 Phase 3 scope testable. They
do not change ADR-101's design decisions or authorize production operations.

### WIG and lag measure

- The limit is two goals with `isWig=true` and `status !== 'ARCHIVED'` per
  Business. `PLANNED`, `ACTIVE`, and `DONE` all count; an archived goal does
  not. Other roadmaps do not create separate limits.
- `setGoalWig` is the only WIG-flag writer. Activating requires one
  `BusinessKeyResult` belonging to that same goal and Business whose status is
  not `ARCHIVED`. `BusinessKeyResult.isLagMeasure` is set in the same
  transaction; a non-archived WIG has exactly one such Key Result.
- Disabling a WIG clears its lag marker. Archiving a WIG goal preserves its
  flag and marker as history and releases its slot. Reopening an archived WIG
  is refused unless a valid non-archived lag Key Result still exists and the
  Business has capacity. No other goal-status change alters the WIG flag.
- Archiving or changing the status of the selected lag Key Result to
  `ARCHIVED` is refused while its goal is a non-archived WIG. Once the goal is
  archived or the WIG is disabled, the Key Result may be archived.
- All operations that can change WIG capacity or its lag invariant serialize
  on the Business row inside the same transaction before checking the count.
  Audit failure rolls the state change back. Concurrent activation tests must
  prove the count never exceeds two and the third contender receives a
  conflict.

### Lead measures and weekly values

- A lead measure has a name, unit, finite weekly target, `UP` or `DOWN`
  direction, and `ACTIVE` or `ARCHIVED` status. Create/update/archive are
  OWNER-only. Only an active lead measure under a non-archived WIG accepts
  values; archival preserves its historical values.
- A value is an immutable cumulative-to-date snapshot for one Bangkok week.
  More than one snapshot in a week is allowed for corrections; each is
  audited, and the weekly bar uses the latest row by `(createdAt, id)` rather
  than summing snapshots. The card shows the current week and four preceding
  weeks. Values cannot be written for a future week.
- The server uses `weekStartFor(now)` from FR-268, whose timezone is fixed by
  ADR-101 D1. A supplied historical week key must itself be Monday 00:00 in
  `Asia/Bangkok`; clients cannot supply a timezone or arbitrary bucket.

### Commitments

- A commitment has an immutable title, Business, Bangkok `weekStartAt`,
  required Person reference, optional lead-measure reference, and explicit
  `done` state. Create accepts the current or next Bangkok week so an OWNER
  can record the next week's plan; the Overview defaults to the current week.
- The named Person must have a direct, non-expired `ACTIVE` Membership in the
  same Business. A tenant-wide Membership alone does not qualify. An OWNER
  records the commitment on the Person's behalf; the product does not claim
  that the Person separately confirmed it.
- An optional lead measure must be active, belong to the same Business, and
  belong to a non-archived WIG. Completion is set with an explicit
  `done: true|false` value, so retries do not invert state. No edit or delete
  operation is in Phase 3. Person erasure may clear the relation; the read
  model then labels the assignee as unavailable without copying personal data.

### Weekly session and attention

- The unique key is `(businessId, weekStartAt)`. The three step keys are
  `report`, `scoreboard`, and `plan`; each is set to an explicit completed
  state and may be corrected in either direction by an OWNER. Repeating the
  same state is idempotent and does not create a second session row or a
  duplicate audit event.
- A session row is created by the first explicit step update. Reads remain
  side-effect free, and no scheduled job pre-creates empty weekly rows; only
  a persisted incomplete session can later produce an attention row.
- Sessions may be recorded for the current or a past valid Bangkok week, not a
  future week. The server validates the Monday bucket; it never trusts a
  client timezone.
- A persisted session is overdue when `now >= weekStartAt + 8 days`, the
  first instant after its one-day grace period following the seven-day week,
  and any step is incomplete. The attention queue emits one stable row per
  overdue incomplete Business/week session and removes it once all three steps
  are complete. No scheduler, reminder delivery, or read-side database write
  is added.

## Read and write boundary

- Extend the existing Business Strategy read contract additively with a
  `wigExecution` DTO. It contains active WIGs across all roadmaps, current- and
  next-week commitments, the five-week lead-measure series, the current
  session state, and persisted overdue incomplete sessions. Every query is
  scoped to the requested visible Business.
- OWNER-only mutations use the existing per-Business owner gate and audit
  transaction pattern. Resource IDs are revalidated against that Business at
  every write boundary; a visible Business without an OWNER grant cannot
  write.
- The `/overview` WIG card renders the WIG selector with its lag Key Result,
  weekly lead-measure bars and values, commitments grouped by Person with
  explicit completion controls and a current/next-week selector, and the three
  session steps. The attention row links back to this Business Home card.

## Dependency and provenance disposition

- FR-269 Phase 2 is present on the admitted base: PR #645 merged at
  `54e7e35780002237cc418e5525e683b1362908d1`; PR #646 reconciled its roadmap
  delivery note and merged at `4144430bcdc69e92dfe8365a73226ad6259955fa`.
  The native FR-269 note records completed local and hosted checks and keeps
  production migration, deployment, provider activation, and live-data
  acceptance separate.
- The source-preserved FR-269 and FEAT-002 rows still carry their original
  declared-phase wording. This package treats those rows as pinned provenance,
  not current delivery status; it does not rewrite them or their generated
  exports. A changed canonical row would require its own reviewed record
  migration. The stale wording is recorded as a non-blocking documentation
  follow-up; it does not invalidate the merged FR-269 code dependency.
- The repo's `SOURCE-RECONCILIATION.md` is the historical WF00 packet and is
  left unchanged. This feature note carries the task-specific disposition
  against the exact FR270 base and its source digests.

## Implementation evidence

The Phase 3 implementation was developed from admitted base
`4144430bcdc69e92dfe8365a73226ad6259955fa`, pushed as source head
`bd9a7496a5de1f981fae1b20353b9b1610a791c8`, and merged by PR #647 as
`8a2fd4984a868923291c68c0169b16a8f0716768` on 2026-10-12. It adds the four
model families, audited OWNER writers and seven API routes, the additive
Strategy DTO, Overview card and overdue-session projection, snapshot coverage,
and generated PostgreSQL schema/migration evidence. Focused integration/unit
coverage passed 57/57 and the OpenAPI inventory passed 19/19. Exact-head hosted
governance, build, all four test shards, and specialized checks passed; hosted
E2E and desktop jobs were skipped by their workflow. Local production-mode
Playwright passed 210 tests with four repository-skipped superseded smoke cases;
the FR-270 flow passed in both targeted and full runs. A completed full Vitest
run after the Phase B binding repair passed 7,989 tests with 56 skipped; after
the final checkbox accessible-name adjustment, its focused UI suite passed
3/3. A redundant full Vitest rerun was interrupted during the 186-second
`ci-change-scope` file and is not counted as a result. Strict local governance
passed with zero critical findings, four warnings, and 39 informational
findings. Migrations are written but not applied; deployment, provider
activation and live-Business acceptance are not claimed.

## In scope — Phase 3

- Add `BusinessKeyResult.isLagMeasure` and the
  `BusinessLeadMeasure` (with append-only `BusinessLeadMeasureValue`),
  `BusinessWeeklyCommitment`, and `BusinessWigSession` Prisma models, both
  migration trees, generated PostgreSQL schema/SQL, and `SNAPSHOT_MODELS` plus
  offline recovery validation.
- Add the WIG, lead-measure, value, commitment, and session-step OWNER
  mutations with audited transactions, Business-scope checks, and concurrency
  coverage for BR-043.
- Extend the existing strategy DTO, `/overview`, and attention queue without
  changing the FR-060 composite-health formula.
- Update the FR-270 feature note, project-manager charter, and roadmap from
  declared to implementation evidence; regenerate governed document views
  through their existing generators.

## Out of scope

- A `Cycle` or `Business.timezone` model (ADR-101 D1 — `weekStartAt` is
  computed from a fixed `Asia/Bangkok` constant, cited rather than modeled).
- Slack/LINE delivery of reminders (ADR-101 Phase 4), integration-fed values,
  non-OWNER writers, provider calls, schedulers, and general autonomous
  execution.
- Applying a production migration, deploying, enabling a feature flag, or
  claiming production/live-Business acceptance. Those remain separate
  operator-owned gates under ADR-057.

## Acceptance criteria

1. Enabling a third non-archived WIG in one Business is rejected atomically;
   concurrent attempts never leave more than two. A different Business has an
   independent limit. Disabling or archiving releases capacity; reopening an
   archived WIG rechecks it.
2. An active WIG has exactly one non-archived lag Key Result from its own
   goal. A cross-goal/cross-Business/missing/archived Key Result is rejected;
   the selected Key Result cannot be archived while its WIG is active. All
   failed mutations leave flags, versions, and audit rows unchanged.
3. OWNER checks pass for every writer; MEMBER, DEV, unauthenticated, and
   cross-Business calls fail without writes. A commitment cannot name a Person
   without an active direct Membership in that Business.
4. Invalid/future week keys and non-finite measure values are rejected.
   Corrections append new values; the five displayed weekly bars select the
   deterministic latest value and do not sum snapshots.
5. Commitment replay with the same explicit `done` state is a no-op;
   changing the requested state is audited. Wrong-Business lead measures and
   inactive/non-WIG parents are rejected.
6. Session step writes create exactly one row per Business/week, are safe to
   repeat, and can explicitly clear a step. At the exact `weekStartAt + 8d`
   threshold an incomplete persisted session yields one stable attention row;
   it is absent before the threshold and clears when all steps are done.
7. Strategy DTO and Overview render only the selected Business data. The
   current and next-week commitments are grouped by Person, historical bars
   cover exactly five weeks, and the WIG card is read-only for non-OWNER
   viewers.
8. Snapshot export/import and offline phase-B recovery preserve all four new
   model families and their relationships; SQLite and Supabase migrations and
   generated PostgreSQL schema are aligned.
9. Existing FR-268/FR-269 behavior and FR-060 health calculations remain
   unchanged. Required focused integration/unit/browser tests, applicable
   app checks, full regression suite, generated-doc checks, and exact-head
   hosted CI pass before merge. Skipped required checks block acceptance.

## Execution DAG for this package

The single feature branch is
`codex/feat002/fr270-4dx-weekly-execution`. Nodes are root-integrated in this
order; no node authorizes production effects.

| Node | Depends on | Exclusive write set | Merge barrier |
|---|---|---|---|
| C0 — contract and G0 | Merged base `4144430b` and pinned sources | FR-270 feature note | G0 is admitted only after digest and scope checks |
| S1 — persistence | C0 | Prisma schemas, SQLite/Supabase migrations, generated PostgreSQL schema/SQL | Migration parity and Prisma validation pass |
| M1 — mutations | S1 | Project-manager mutation service, FR-270 API routes, mutation integration tests | Owner, scope, audit, lag, and concurrent WIG acceptance pass |
| R1 — reads and attention | S1 | Business strategy DTO, home read model, read/attention tests | Five-week ordering and grace-boundary acceptance pass |
| B1 — recovery | S1 | Snapshot service, offline recovery hooks, snapshot tests | Export/import and offline recovery preserve all relations |
| U1 — Overview | M1 and R1 | WIG card, Overview composition, UI/browser tests | Owner and read-only UI behavior passes |
| D1 — closeout docs | M1, R1, B1, U1 | Project-manager charter and roadmap | Status cites exact code/test/CI evidence; no canonical rows edited |
| V1 — root final gate | S1, M1, R1, B1, U1, D1 | No write set; root may perform one bounded acceptance repair | Full required local checks and exact-head hosted CI pass before merge |

S1 is a serialization barrier because every later node consumes the schema.
M1, R1, and B1 have disjoint write sets and can be separate workers in a future
admitted run; U1 waits for both mutation and read contracts. In this run the
root remains the sole writer and executes them sequentially. Any source/base
change or expansion outside this feature's allowlist stops the packet for a
new G0; no rename or rebase resets its counters.

## Verification (when Phase 3 ships)

- Integration tests prove BR-043 across Businesses and under concurrent
  activation, including archive/reactivate and lag-Key-Result transitions.
- Tests use the fixed `weekStartFor(now)` helper and cover Sunday-to-Monday
  Bangkok boundaries, historical/future bucket validation, and the exact
  grace-period boundary.
- OWNER/MEMBER/DEV, expiry, cross-Business IDs, transaction rollback, audit,
  idempotent session rows, commitment state, deterministic lead-value ordering,
  attention creation/clear, and backup round-trip are covered.
- UI/browser checks exercise the card on `/overview`, selector validation,
  commitment completion, session steps, and a refreshed strategy read.
- Database generation/migration checks, `SNAPSHOT_MODELS` and offline recovery
  checks, governed doc generators, app tests/build, and hosted CI are recorded
  with exact commands, exit codes, and revisions.

## Version diff

0.1.0b → 0.2.0b: freezes WIG eligibility and concurrency, lag-Key-Result
invariants, lead-measure correction/display semantics, commitment membership
and owner-recording semantics, Bangkok week keys, session idempotency, grace
period, read/write boundaries, and concrete Phase 3 acceptance criteria. No
canonical requirement row or ADR lifecycle is changed.

## B1 source inspection — 2026-10-23

At `2c13f6166bc865dd14aadcab3904b0f3eea42197`, the existing
[WIG/lag writer](../../../../apps/server/src/modules/project-manager/application/business-strategy-mutation-service.js),
[weekly-execution service](../../../../apps/server/src/modules/project-manager/application/business-wig-execution-service.js),
[UI](../../../../apps/server/src/modules/project-manager/components/BusinessWigExecution.jsx)
and [integration suite](../../../../apps/server/tests/integration/fr270-business-wig-execution.test.js)
are present. Full ancestor: `8a2fd4984a868923291c68c0169b16a8f0716768`.
The canonical design-only delivery cell remains held for the exact B1 proposal;
current B3 adapter/browser qualification and B4 migration/live acceptance remain
separate. The dated hosted results above were not refreshed by B1.

0.2.3b (2026-10-23): separate current source presence from historical hosted
results and the held canonical delivery migration; no application change.
