---
domain: project-manager
feature: FR-069
module: project-manager
source: v2-native
version: 0.1.0
status: proposed
---

# FR-069 — Plan Blueprint and Human/Agent intake

## Intent

After a user states a Project objective, Zuri can recommend a mode-specific
Blueprint and help create an editable execution plan. A Human may also define
the plan directly, or an external Agent may submit a structured plan. All three
paths converge on the same PlanEnvelope validation, preview, authorization and
audit boundary.

The Blueprint is a starting pattern. It is not a first-step template picker,
not a hidden task generator and not a source of fake progress.

## Human user flow

### 1. Create the Project from the outcome

The first form asks for the outcome, not an internal template:

| Field | Requirement | Purpose |
|---|---|---|
| Project name/title | required | Human-readable identity |
| Goal/outcome | required | What must become true when the Project is done |
| Timeline | required for a committed plan; target date or date range | Gives the plan a time boundary; draft may remain undated with an explicit warning |
| Accountable owner | required; current authorized user may be the default | Makes responsibility visible and auditable |
| Business context | resolved from the authorized route/scope | Never accepted as an arbitrary browser-provided authority key |
| Description/constraints | optional at Project creation, recommended before plan commit | Context, assumptions, budget or operating constraints |

Space is not a first-run question. The implementation creates or resolves the
Business-scoped Default Space required by the existing Project model, while the
user sees Business/Project context rather than a technical Space step.

### 2. Define the planning intent

The wizard asks enough to make a plan truthful:

- desired outcome and measurable success criteria;
- target timeline and important date constraints;
- responsible Human and available team/Agent subjects, if known;
- dependencies, assumptions and constraints, if known; and
- whether the work is software, migration, sales, campaign, launch, operations
  or expansion — or lets the planner recommend one or more of the seven modes.

The user may accept, edit or reject the recommendation. A Project may contain
multiple Workstreams and therefore multiple modes; the user is not forced to
label the whole Project with one mode.

### 3. Review the generated visible skeleton

The Blueprint creates a draft skeleton that the Human can edit before commit:

```text
Project goal and timeline
  → Execution Plan / Workstream(s)
    → mode-specific Phase/Stage/Period
      → Sprint/Batch/Wave/Process/Site as applicable
        → Work Item(s), tags, assignee, dates, dependencies and criteria
```

The preview shows the same structure that the Human will later see in Execution
Roadmap. It must identify generated suggestions and preserve empty/unavailable
fields instead of presenting them as completed facts.

### 4. Confirm and commit

The user can save a draft, run a dry-run, resolve conflicts, inspect the final
preview and explicitly confirm. Only the authorized transactional commit creates
or updates Project Manager records and emits AuditEvent entries.

## Minimum mode-specific intake prompts

These are the minimum questions the UI or planning Agent must be able to answer
before a mode-specific plan is committed. They are prompts and normalized
meaning, not a new set of persistence models.

| Mode | Minimum planning prompts | First visible evidence |
|---|---|---|
| `SOFTWARE_SPRINT` | release outcome, sprint boundary/cadence, acceptance criteria | weighted work and defects |
| `DATA_MIGRATION` | source/target scope, record population, validation/reconciliation rule | total, processed, success/failed, validated/reconciled |
| `B2B_SALES` | target accounts/deals, target value and close window | target, weighted value, won revenue |
| `B2C_CAMPAIGN` | audience, channels/waves, budget and KPI target | spend, leads, conversion, revenue/ROAS |
| `PRODUCT_LAUNCH` | launch outcome/date, deliverables and required gates | readiness and blocked gates |
| `OPERATIONS` | operating period/process, SLA and service outcome | SLA, throughput, backlog, incidents |
| `BUSINESS_EXPANSION` | target market/site, go-live window, budget/readiness constraints | legal, location, budget, hiring, vendors, readiness and go-live |

The mode must resolve to the existing canonical `executionMode`,
`progressStrategy`, container subtypes, item subtypes and evidence keys. An
unknown mode or mismatched strategy is rejected before preview.

## Dual intake contract

```text
Human form ─┐
            ├─ normalize to PlanEnvelope
Agent JSON ─┘
              → schema validation
              → semantic/mode validation
              → dry-run + conflict check
              → Human-readable preview
              → authorized transactional commit
              → AuditEvent + provenance
```

The transport for Agent submission (API, MCP or another adapter) is deliberately
out of scope for this feature. It must not create a second plan shape. The
application remains usable when no Agent is connected.

## Acceptance criteria

- **AC-069.1** The first Project planning step begins with title/goal/outcome and
  context; it does not ask the user to choose a Software/Sales/Marketing
  template.
- **AC-069.2** A committed Project plan requires a truthful timeline boundary,
  accountable owner, success criteria or an explicit owner-approved exception,
  and at least one canonical Workstream/Execution Plan with a valid mode and
  progress strategy.
- **AC-069.3** The UI can recommend one of the seven canonical modes and the
  user can edit the recommendation or use multiple modes across Workstreams.
- **AC-069.4** Each mode exposes its minimum planning prompts and produces a
  visible editable skeleton using the mode's vocabulary.
- **AC-069.5** Blueprint suggestions are visibly distinguishable from committed
  facts; they cannot set completed status, progress evidence or gate passage
  without source data.
- **AC-069.6** Human-created and Agent-created plans normalize to the same
  PlanEnvelope schema and semantic validation path.
- **AC-069.7** Both intake paths support dry-run, conflict check, Human-visible
  preview, authorized transactional commit and AuditEvent. A failed validation
  or authorization creates no partial plan.
- **AC-069.8** An imported plan is treated as data only; no arbitrary code,
  prompt, hook or tool instruction from the plan is executed.
- **AC-069.9** The plan cannot introduce a noncanonical execution mode, invalid
  container/item subtype, mismatched progress strategy or dependency to an
  unknown record.
- **AC-069.10** The flow can save a draft without pretending it is ready or
  complete, and shows missing data as an actionable warning.
- **AC-069.11** The flow preserves the existing Business/tenant authorization
  boundary and resolves the required Business-scoped Default Space without
  making Space a user-facing first-run step.

## Non-goals

- Selecting or integrating a real authentication provider.
- Deciding whether Agent transport is API, MCP, LINE or another adapter.
- A persistent Blueprint marketplace/library or user-authored template system.
- Automatic commit without preview and Human confirmation.
- New execution modes, a new Project hierarchy or a second plan database.

## Related documents

- [ADR-028 — Human-visible execution roadmap](../../../decisions/ADR-028-HUMAN-VISIBLE-EXECUTION-ROADMAP.md)
- [FR-068 — Human-visible Execution Roadmap](FR-068-human-visible-execution-roadmap.md)
- [Seven Execution Modes](../../../EXECUTION-MODES.md)
- [PlanEnvelope schema](../../../../contracts/plan-envelope.schema.json)
- SDD-039 — Roadmap contract (registered in [PRD-SDD-v1.0.md](../../../PRD-SDD-v1.0.md))
