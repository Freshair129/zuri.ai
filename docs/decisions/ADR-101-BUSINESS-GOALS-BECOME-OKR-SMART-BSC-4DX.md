---
id: "ZAI:ADR-101"
title: "Business Goals become OKR / SMART / Balanced Scorecard / 4DX, inside project-manager"
version: "0.1.0b"
status: approved
approval_scope: design-and-documentation
approved_on: "2026-09-22"
approved_by: "Owner instruction (chat), 2026-09-22 — \"approve\", confirming the reviewed plan: Phase 0 first, the naming in §Decision, OWNER-only check-in authority for Phase 1"
integration_status: pending
implementation_status: not-started
created_at: "2026-09-22"
last_update: "2026-09-22"
author: Claude Sonnet 5
domain: project-manager
attributes:
  doc_type: architecture-decision
  domain: project-manager
  scope: "Where OKR (Objectives/Key Results), SMART validation, a Business-scoped Balanced Scorecard, and 4DX weekly execution live in zuri-ai; what changes in BusinessGoal/BusinessRoadmap and what stays untouched"
relations:
  - type: relates_to
    target: "ZAI:ADR-025"
  - type: relates_to
    target: "ZAI:ADR-059"
  - type: relates_to
    target: "ZAI:FEAT-002"
  - type: relates_to
    target: "ZAI:FR-041"
  - type: relates_to
    target: "ZAI:FR-059"
  - type: relates_to
    target: "ZAI:FR-060"
  - type: relates_to
    target: "ZAI:FR-268"
  - type: relates_to
    target: "ZAI:FR-269"
  - type: relates_to
    target: "ZAI:FR-270"
  - type: relates_to
    target: "ZAI:FR-271"
  - type: relates_to
    target: "ZAI:SDD-107"
  - type: relates_to
    target: "ZAI:BR-043"
  - type: relates_to
    target: "ZAI:BR-044"
---

# ADR-101 — Business Goals become OKR / SMART / Balanced Scorecard / 4DX, inside project-manager

**Status:** Accepted on the owner's instruction of 2026-09-22, approving a plan reviewed by an
independent read-only pass over this repository (Claude Fable 5.1, Plan mode, no write tools) that
verified every claim below against the tree at `50a4b303` before this decision was written.

## Context

The owner asked, in an unrelated session against a standalone prototype, for a goal-tracking
system combining five frameworks: OKR (Objectives + Key Results), SMART (a live five-check
validator on every Key Result), KPI (health metrics distinct from OKR's chosen change-goals for
the cycle), Balanced Scorecard (every Objective/KPI tagged to Financial, Customer, Internal
Process, or Learning & Growth), and 4DX (at most two Wildly Important Goals, lead measures a team
controls, a scoreboard, weekly commitments, a three-step weekly session ritual). The prototype was
built and verified as a fully separate, self-hosted stack (its own PostgreSQL, its own auth, an
embedded GenesisBlockDB projection) before the owner asked where it should actually live inside
Zuri.

Three facts, each verified directly in this tree rather than assumed, decide the question:

- **Zuri already owns this bounded context, not a proposal to create one.** `BusinessRoadmap`,
  `BusinessRoadmapHorizon`, `BusinessGoal` and `ProjectGoal` are live Prisma models
  (`prisma/schema.prisma:1091-1166`), owned by the `project-manager` domain charter, which already
  lists `business` as one of its own modules (`docs/domains/project-manager/CHARTER.md`). `crm`
  owns `Person`/`Customer`/`Conversation`/`Message` — customer messaging, an unrelated bounded
  context, and was never a serious candidate.
- **The reservation already exists in writing.** FR-060's own feature note scopes Business Home's
  Dashboard explicitly and reserves the rest: *"Out, and each needs its own FR when built: Goals &
  KPIs, Risks & Alerts and Reports sub-pages."* `FEAT-002`'s own description already names "Goals &
  KPIs" as a future sub-page. This decision is that FR, not a new bundle competing with FEAT-002.
- **`/overview/page.jsx` is one page, not two.** It fetches `/api/business/strategy`, renders the
  Strategy editor (`StrategyCard`, `StrategyEditModals.jsx`) and feeds the same `strategy` object
  into `buildBusinessHomeReadModel()` for the Dashboard's KPI tiles and attention queue. "Put it on
  Business Home" and "put it in project-manager, in the `business` module" name the same place.

A defect was found in the course of this review, unrelated to the decision but blocking its
Phase 3 work: `attentionQueue()` in `business-home-read-model.js` read `strategy?.goals`, a key
the real FR-041 payload (`roadmaps[].horizons[].goals[]`) never sends. Every goal-based attention
row has been dead code in production since FR-060 shipped; the unit test that should have caught
it fed a `{ goals: […] }` fixture no caller produces. Fixed on this branch as a status-cell
correction to FR-060 (PRD-SDD 1.246.0b) — the requirement's statement is unchanged, only what
actually reaches the page.

## Decision

### D1 — Extend `BusinessGoal`, do not replace it, and do not create a second system of record

`BusinessGoal` becomes the OKR Objective. Its existing fields (`title`, `description`, `status`,
`priority`, `progress`, `startAt`, `targetAt`, `version`) are untouched. Two fields are added:
`perspective` (nullable Balanced Scorecard tag — nullable so every existing goal, and the FR-108
bundle importer's `zGoal`, which carries no perspective, keeps working with no data migration) and
`isWig` (boolean, `@default(false)`).

New child models, all under the same `project-manager` domain, named with the `Business` prefix
the existing models already use so nothing collides with the UI's `Kpi` component
(`src/components/ui/index.jsx:142`, already imported by `/overview`) or produces an awkward
`db.kPI` Prisma accessor:

| Model | Relationship | Purpose |
|---|---|---|
| `BusinessKeyResult` | child of `BusinessGoal` | a measurable target: metric, unit, baseline, target, direction, due date, owner Person, confidence 1–5 |
| `BusinessKeyResultCheckIn` | child of `BusinessKeyResult`, append-only | weekly value/confidence/note/source |
| `BusinessKpi` | Business-scoped, not goal-scoped | an ongoing health metric with a Balanced Scorecard perspective |
| `BusinessKpiObservation` | child of `BusinessKpi`, append-only | its time series |
| `BusinessLeadMeasure` | child of `BusinessGoal`, meaningful only when `isWig` | a weekly-target metric the team directly controls |
| `BusinessLeadMeasureValue` | child of `BusinessLeadMeasure`, append-only | weekly values |
| `BusinessWeeklyCommitment` | Business-scoped | what a named Person commits to for the week |
| `BusinessWigSession` | Business-scoped, one per week | the report / scoreboard / plan ritual |

No `Cycle` model. Zuri has `BusinessRoadmap.startAt/targetAt` and SHORT/MEDIUM/LONG horizons
(multi-month), not a weekly cadence, and no `Business.timezone` column. 4DX rows key to
`weekStartAt` (Monday 00:00, `Asia/Bangkok` fixed in code and cited here rather than inherited
silently); a Key Result's "expected progress" is computed from its own
`[startAt ?? goal.startAt, dueAt ?? goal.targetAt]` window. `isWig`'s "at most two" is counted
**per Business** (BR-043), not per roadmap, because more than one `BusinessRoadmap` can be ACTIVE
at once and "the active roadmap" does not name a stable scope.

### D2 — `BusinessGoal.progress` becomes a write-through cache once Key Results exist

Today `progress` is hand-typed (`GoalModal`'s "Progress %" field, `updateGoal`'s zod, the seed).
Once a goal has Key Results, a stored number that can disagree with their roll-up would violate
the same rule FR-060 itself states for the composite score — a figure "recomputed from the owning
domain's read model," never a second source of truth. `recordKeyResultCheckIn` recomputes
`progress` from the goal's non-archived Key Results, in the same transaction as the check-in,
through a pure `rollupGoal(keyResults)` calculator shaped like the existing `rollupProject`'s
`{ percent, formula, warnings }` (SDD-107). `updateGoal` refuses a manual `progress` patch once the
goal holds a non-archived Key Result (BR-044). Backward compatibility costs nothing: a goal with no
Key Results keeps manual progress exactly as today. The strategy DTO gains
`progressSource: 'MANUAL' | 'KEY_RESULTS'` so the UI can say which kind of number it is showing,
rather than implying every goal is measured the same way.

### D3 — SMART is split into what a server can honestly check and what it cannot

`smartChecks()` is a pure function returning Specific / Measurable / Time-bound as booleans and
Achievable / Relevant as `null` — never a fabricated score for the two that are human judgement
(FR-271). The live client checklist a Key Result's create/edit form shows calls the same function
the server enforces at write time, so the UI can never claim a check the API does not also make.

### D4 — Authorization for Phase 1: OWNER only, by design, not by default

`business-strategy-mutation-service.js`'s existing OWNER-only gate (the caller must hold
`viewer.ownedBusinessIds` over the target Business — FR-059) extends unchanged to every new
mutation, including a Key Result check-in. This is deliberately narrower than the OKR practice of
letting a Key Result's own (often non-owner) assignee check in weekly, and it is deliberately
Phase 1's boundary rather than an oversight: granting a narrower write to a non-OWNER Person is a
new authorization rule (a role binding the way CRM's `SALES_REP` extended FR-076-style role
binding for a narrower grant), and it is owed its own BR/SEC declaration and tests, not folded
into this one silently. Until that lands, only a Business owner can check in a Key Result — the
same authority that can already edit the goal's progress by hand today.

### D5 — The standalone self-hosted stack is retired as a system of record

The prototype at `F:\goal tracker\selfhost` (separate PostgreSQL, separate auth, an embedded
GenesisBlockDB projection) is **not** kept running, mirrored, or repointed at zuri-ai as a synced
read replica. Two systems holding the same class of fact is exactly what ADR-025's domain spine
and this repository's progress-recomputation rule both forbid, and every capability the prototype
built as infrastructure — Postgres, per-Business authority, an audit ledger, a credential vault,
an API-key surface — already exists here and would disagree with the standalone copy the moment
either side wrote independently. Salvaged as code, not as a running service: its progress/status
threshold formulas become the pure calculators in `progress/key-result-progress.js` and
`progress/goal-rollup.js`; its SMART checklist behaviour becomes `smart-checks.js`; its schema
shapes are reflected in the model table above (minus `cycles`, `seq` and a `lag_links` join table
— `BusinessKeyResult.isLagMeasure` replaces the last one). Its connector-pull and webhook-delivery
code is **not** ported in this phase: a later integration-fed observation belongs to the
`integration` domain's `IntegrationConnection`/`SecretStorePort`, not to project-manager, and is
its own FR when it is built. `goal-tracker.html`, the original interactive prototype, is kept as
UX prior art only, the way FR-060 already keeps its own dashboard prototype file.

### D6 — Phased rollout; this decision authorizes Phase 0 only

- **Phase 0 (this change):** documentation only, plus the unrelated FR-060 attention-queue defect
  fix found in review. FR-268..271, SDD-107, BR-043/044 declared; this ADR; feature notes; the
  charter's "Declared, not yet in schema" section for the models above; the ROADMAP task row. No
  Prisma model, migration, route, service or UI code for OKR/KPI/4DX exists yet.
- **Phase 1:** `BusinessGoal.perspective`/`isWig`, `BusinessKeyResult(+CheckIn)`, the pure
  calculators, the writer, the FR-041 read extension, Key-Result attention rows, the Key Result
  list/modals/SMART checklist, both migration trees, `SNAPSHOT_MODELS`, seed, tests.
- **Phase 2:** `BusinessKpi(+Observation)`, a scorecard card grouped by perspective, KPI-breached
  attention rows.
- **Phase 3:** `BusinessLeadMeasure(+Value)`, `BusinessWeeklyCommitment`, `BusinessWigSession`, a
  weekly WIG card, a session-incomplete attention row.
- **Phase 4, separate FRs, other domains:** LINE as a quick check-in surface (an agent tool
  calling `recordKeyResultCheckIn`, the way `line-project-work-tools.js` already does for other
  writes); integration-fed KPI observations through the `integration` domain; a Key-Result-owner
  authorization binding narrower than OWNER (D4).

Applying any migration this ADR eventually produces is a separate, owner-instructed operator step
(ADR-057); this decision authorizes the design and the files, not an operation.

## Alternatives and consequences

**Alternative — a new top-level domain for goal tracking.** Rejected: it would compete with
`BusinessGoal`/`BusinessRoadmap`, which the `project-manager` charter already owns and a live
feature already writes, and the charter rule against one domain writing another's model would
apply to whichever side moved second.

**Alternative — keep the standalone self-hosted stack, mirrored via API.** Rejected in D5:
a second writer of the same class of fact is the one shape this repository's own rules consistently
refuse, from the domain spine down to FR-060's "never a number a page would disagree with."

**Consequence.** `FEAT-002` stays `building`, not `live` — it already was. No existing route,
model, test or UI changes behaviour in this revision; `business-home-read-model.js`'s attention
queue starts reporting goal rows it always should have. The next PR against this branch is Phase 1,
gated on the owner decisions this ADR already recorded (D2 write-through, D4 OWNER-only) so it does
not re-litigate them.

## Verification

- `docs/PRD-SDD-v1.0.md` contains FR-268, FR-269, FR-270, FR-271, SDD-107, BR-043, BR-044, each
  citing this ADR, and the FR-060 status-cell correction citing PRD 1.246.0b.
- `docs/FEATURES.md` FEAT-002 lists FR-268..271 alongside FR-041/FR-060 and stays `building`.
- `docs/domains/project-manager/CHARTER.md` carries a "Declared, not yet in schema (FEAT-002,
  ADR-101)" section naming every model in the D1 table.
- `apps/server/src/modules/business/application/business-home-read-model.js`'s `attentionQueue`
  reads goals from `strategy.roadmaps[].horizons[].goals[]`, and
  `tests/unit/fr060-business-home-read-model.test.js` asserts it against that real shape, not a
  synthetic one.
- No `prisma/schema.prisma`, `supabase/migrations/`, `app/api/business/**` or UI file changes in
  this revision other than the FR-060 defect fix above.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-22 | approved | Initial decision: Business Goals become OKR/SMART/BSC/4DX inside project-manager; Phase 0 (docs + FR-060 defect fix) authorized here, Phase 1-4 scoped for separate decisions where noted. | uncommitted | Claude Sonnet 5 |
