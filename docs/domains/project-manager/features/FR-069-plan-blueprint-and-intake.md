---
domain: project-manager
feature: FR-069
module: project-manager
source: v2-native
version: 0.9.0
status: candidate
---

# FR-069 — Plan Blueprint and Human/Agent intake with stable references

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
| Linked Business goals | optional; `goalIds[]` when an existing BusinessGoal is linked | Stable strategic-goal references; goal title/code remain projections |
| Linked risks | optional; `riskIds[]` only when an authorized Risk record exists | Stable risk references; missing Risk data remains unavailable |
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
  → goalIds[] / riskIds[] links when available
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

### 5. Implemented Human Plan Builder surface

On the Project Import surface, `สร้างแผนด้วยฟอร์ม` opens a popup with the
objective, description, target date, Space, Workstreams, execution modes and
starter work items. The browser builds a PlanEnvelope JSON, renders it in the
same Plan JSON editor, and immediately sends that object through the existing
validate → dry-run path. Confirming the preview uses the same transactional
commit and audit boundary as pasted JSON, Excel conversion and Agent/API/MCP
intake. This is an additional Human entry surface, not a second persistence
path.

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

The transport choice remains outside this feature's product contract, but the
current protected MCP adapter implements the local Agent execution loop with
the same server-owned records:

```text
project_manager.plan_commit
  → project_manager.work_read(projectId | workstreamId)
  → project_manager.work_status_update(workItemId, status)
  → project_manager.work_read(...)   # Agent confirmation
```

`work_read` requires an explicit Project or Workstream scope and applies the
authenticated viewer's read boundary. `work_status_update` accepts only the
canonical WorkItem status vocabulary and delegates to the existing authorized
mutation plus AuditEvent path. These tools do not accept caller-supplied
Business/Tenant authority, execute imported code, or create a second plan
shape. The application remains usable when no Agent is connected.

## Seven execution-plan contracts

The following are seven logical contracts inside the one `PlanEnvelope`; they
are not seven unrelated databases or seven different import pipelines. The
discriminator is `workstream.executionMode` and the server must validate the
corresponding contract before preview.

Identity binding is part of every contract, not an optional metadata add-on. The
canonical rules are defined by [FR-070 — Stable execution, domain, goal, risk and tag
identities](FR-070-stable-execution-domain-and-tag-identities.md):
`executionModeId` identifies the mode, `planId` resolves to the committed
`Workstream.id`, `primaryDomainId`/`supportingDomainIds` identify the product
domain binding, `technicalOwnerDomainId` identifies the owning charter, and
every attached tag uses `tagId`. Existing Business-goal links use `goalId`/`goal_id`
and Risk links use `riskId`/`risk_id`; labels and codes are projections only.
Applicable supporting references use the FR-070 registry:
`gate_id`, `artifact_id`, `contract_id`, `meeting_id`, `call_id`, `followup_id`,
`req_id`, `verify_id`, `integration_id`, `graph_id`, `node_id`, `edge_id`,
`workflow_contract_id`, `workflow_id`, `runbook_id`, `promotion_id`, `skill_id`
and `tool_id`. They are resolved through their owning services before commit
and are optional by mode/step.

`executionContractId`/`execution_contract_id` remains the identity of the
selected Execution contract. `workflowContractId`/`workflow_contract_id` is the
separate Multi-agent workflow contract. `contractId`/`contract_id` is the CRM
Contact identity. `integrationId`/`integration_id` is the canonical Integration
identity; `int_id` is a legacy compatibility alias only and is not Intent.

Each seven-mode Execution contract also has a stable definition ID. The
definition ID identifies the Execution contract being run; it is not the ID of
a CRM Contact, multi-agent workflow contract or particular run:

| Execution mode | `executionContractId` |
|---|---|
| `SOFTWARE_SPRINT` | `EXC-SOFTWARE-SPRINT-V1` |
| `DATA_MIGRATION` | `EXC-DATA-MIGRATION-V1` |
| `B2B_SALES` | `EXC-B2B-SALES-V1` |
| `B2C_CAMPAIGN` | `EXC-B2C-CAMPAIGN-V1` |
| `PRODUCT_LAUNCH` | `EXC-PRODUCT-LAUNCH-V1` |
| `OPERATIONS` | `EXC-OPERATIONS-V1` |
| `BUSINESS_EXPANSION` | `EXC-BUSINESS-EXPANSION-V1` |

### Common execution-trace contract

The seven contracts share one business graph and one execution trace graph. A
business ID answers “which work is this?”; a trace ID answers “which run and
which step handled it?” These IDs must not be collapsed into one field.

| Trace axis | Required ID/field | Lifetime and purpose |
|---|---|---|
| Contract definition | `executionContractId`, `contractVersion` | Stable definition selected before validation; replay records the exact version |
| Run | `executionRunId` | One complete intake/plan execution; every retry or replay gets a new run ID |
| Request trace | `correlationId`, `idempotencyKey` | Connects UI/API/MCP/Agent transport and prevents duplicate submission |
| Step occurrence | `executionStepId`, `stepKey`, `sequence`, `parentStepId` | One concrete lifecycle step; `stepKey` is stable semantics, UUID is the occurrence |
| Attempt | `attemptId` | One try of a step; retry never reuses the previous attempt ID |
| Business context | `projectId`, `planId`, `containerId?`, `workItemId?`, `goalId?`, `riskId?`, `gateId?`, `contractId?`, `meetingId?`, `callId?`, `followupId?` | Links the step to the Project, Execution Plan, phase/sprint, item, applicable goal/risk, gate, CRM Contact and CRM interaction context |
| Supporting references | `artifactId?`, `reqId?`, `verifyId?`, `graphId?`, `nodeId[]?`, `edgeId[]?`, `integrationId?`, `workflowContractId?`, `workflowId?`, `runbookId?`, `promotionId?`, `skillId[]?`, `toolId[]?` | Links approved evidence, requirement, graph context, Integration bridge, multi-agent workflow contract, selected workflow/runbook, governed promotion and allow-listed Agent execution context; unavailable references are explicit |
| Evidence | `tagIds[]`, `artifactId?`, `verifyId?`, `inputHash`, `outputHash`, `auditEventId` | Tags and approved evidence/verification references; deterministic input/output evidence and immutable audit reference |
| Failure | `status`, `failureCode`, `errorRef`, `retryable` | `FAILED` requires a failure code and identifies the exact failed step/attempt |
| Replay lineage | `replayOfExecutionRunId?`, `replayOfExecutionStepId?` | Links a full or partial replay to the immutable source run/step; linked goal/risk IDs are retained as business context |

The canonical lifecycle step keys are:

```text
STEP-INTAKE
STEP-NORMALIZE
STEP-SCHEMA-VALIDATE
STEP-SEMANTIC-VALIDATE
STEP-RESOLVE-IDS
STEP-DRY-RUN
STEP-CONFLICT-CHECK
STEP-PREVIEW
STEP-AUTHORIZE
STEP-COMMIT
STEP-AUDIT
STEP-COMPLETE
```

Each mode adds one evidence step without changing the common lifecycle:

| Execution mode | Required mode-specific step key |
|---|---|
| `SOFTWARE_SPRINT` | `STEP-SOFTWARE-WEIGHT-CALCULATE` |
| `DATA_MIGRATION` | `STEP-MIGRATION-RECORD-VALIDATE` |
| `B2B_SALES` | `STEP-SALES-PIPELINE-WEIGHT` |
| `B2C_CAMPAIGN` | `STEP-CAMPAIGN-KPI-ATTAIN` |
| `PRODUCT_LAUNCH` | `STEP-LAUNCH-GATE-READINESS` |
| `OPERATIONS` | `STEP-OPERATIONS-SLA-EVALUATE` |
| `BUSINESS_EXPANSION` | `STEP-EXPANSION-READINESS-CHECK` |

An execution step may attach `tagIds[]` directly to `executionStepId`, in
addition to tags on a WorkItem. A failure is not represented by a tag alone:
the failed `executionStepId`, `attemptId`, `failureCode`, `errorRef` and
`auditEventId` are required. Tags such as `TAG-VALIDATION-FAILED` are useful
projections for filtering, not the failure record itself.

Replay rules are append-only:

1. A full replay creates a new `executionRunId`; a partial replay also records
   `replayOfExecutionStepId`.
2. Every replay creates new `executionStepId` and `attemptId` values; it never
   mutates or reuses the source trace records.
3. Replay revalidates `executionContractId`, `contractVersion`, authorization
   and input hashes before it can commit.
4. The failure point is the first failed `executionStepId` in sequence, with
   all later steps marked `SKIPPED` or `NOT_STARTED`, never silently omitted.
5. A replay retains the applicable `goalId` and `riskId` links while creating
   new execution trace IDs; it never turns a goal/risk label into a new identity.

### Common contract inherited by all seven modes

Every mode-specific contract inherits these rules:

| Field | Contract rule |
|---|---|
| Project objective | Human-readable title, goal/outcome, success criteria, accountable owner and timeline/deadline are required before a plan is committed; `goalIds[]`/`riskIds[]` are carried when authorized links exist; a draft may show explicit missing-field warnings |
| Workstream identity | `code`, `name`, canonical `executionModeId`, exact `progressStrategy`, positive `progressWeight`, `primaryDomainId`, `supportingDomainIds[]` and `technicalOwnerDomainId`; committed `planId` is the Workstream UUID |
| Work structure | Containers and items use only the subtype allowlist for the selected mode; every reference code is unique and every parent/container/dependency reference resolves; after commit each period has `containerId` plus its valid mode alias (`phaseId`, `sprintId`, `batchId`, `waveId`, etc.) and each item has `workItemId` plus its valid item alias |
| Execution trace | Every lifecycle and mode-evidence step emits `executionContractId`, `executionRunId`, `executionStepId`, `stepKey`, `attemptId`, applicable business/supporting IDs, `tagIds[]`, status and audit linkage; failed steps expose `failureCode` and replay lineage |
| Work item minimum | `code`, `title`, valid `subtype`, valid `status`, visible assignee state, and a container when the mode's hierarchy requires one |
| Human metadata | `tagIds[]`, owner/assignee, dates, criteria and dependency/blocker state are user-visible; tag labels are resolved projections; missing data is `unavailable`, never fabricated |
| Progress | Derived from the mode's fixed strategy and evidence keys; no universal task-count percentage |
| Closure | Open/blocked/carry-over work, required gates/criteria and dependency blockers must be summarized before an owner can close the plan container |
| Import safety | Strict schema + semantic validation, dry-run, conflict check, Human preview, authorized transaction and AuditEvent; imported content is data only |

PlanEnvelope 1.0/1.1 remains backward-compatible for the neutral identity,
legacy mode alias, subtype, status, metrics, milestones, gates, dependencies and
optional `project.goalIds[]`. PlanEnvelope 1.2 adds the approved stable
`executionModeId`, `executionContractId`, `contractVersion`, domain bindings,
trace/idempotency fields and identity-reference envelope. Fields without an
owner in this Project Manager slice remain explicit validation conflicts rather
than being silently discarded or stored as unvalidated free text.

### Candidate implementation status (2026-08-18)

The optional `project.goalIds[]` field is now validated as a unique bounded
list. During dry-run, each ID is resolved inside the target Business; missing
or cross-Business goals produce a conflict. During commit, valid links are
upserted into the existing `ProjectGoal` relation in the same transaction as
the Project import, and no BusinessGoal is copied or re-owned by Project
Manager. This additive slice feeds the FR-068 Roadmap projection.

### Contract 1 — `SOFTWARE_SPRINT`

`executionContractId`: `EXC-SOFTWARE-SPRINT-V1`

| Contract field | Required rule |
|---|---|
| Planning input | Release outcome, target release date, sprint cadence or sprint boundary, acceptance criteria and accountable owner |
| Structure | `Release → Sprint → Epic → Task/Bug`; `WorkContainer` subtypes: `RELEASE`, `SPRINT`, `EPIC`; `WorkItem` subtypes: `TASK`, `BUG` |
| Item minimum | Every Task/Bug has title, status, positive weight, parent Sprint/Epic when applicable, assignee state and acceptance reference; a Bug also records the affected outcome or linked Task when known |
| Progress | `TASK_WEIGHT`; evidence keys: `plannedWeight`, `completedWeight`, `defects`; missing evidence is not treated as zero |
| Sprint close | All planned Task/Bug weight is completed or explicitly carried over/cancelled; open defects, failed acceptance criteria and blocking dependencies are shown; Release close additionally requires its release gate |
| Human views | Sprint Board, Execution Roadmap, Schedule, Dependency Map and Table; show sprint dates, backlog count, tags, assignee and blocker owner |
| Agent validation | Reject a non-Software subtype, a strategy other than `TASK_WEIGHT`, an unknown metric key or a dependency to an unknown work record |

### Contract 2 — `DATA_MIGRATION`

`executionContractId`: `EXC-DATA-MIGRATION-V1`

| Contract field | Required rule |
|---|---|
| Planning input | Source and target systems, dataset/record population, migration window, validation rule, reconciliation rule, rollback/exception owner and accountable owner |
| Structure | `Stage → Batch/Run → Dataset → Validation → Reconciliation`; `WorkContainer` subtypes: `MIGRATION_STAGE`, `MIGRATION_BATCH`; `WorkItem` subtypes: `DATASET`, `VALIDATION`, `RECONCILIATION` |
| Item minimum | Every Dataset/Validation/Reconciliation item identifies its scope, status, responsible subject and the batch/stage it belongs to; a dataset item must expose its record population before execution evidence is reported |
| Progress | `RECORD_VALIDATION`; evidence keys: `recordsTotal`, `processed`, `success`, `failed`, `validated`, `reconciled` |
| Batch close | `processed` is reconciled against `recordsTotal`; failures are triaged or explicitly accepted by the owner; validation and reconciliation items pass or are carried over with an audited exception; rollback decision is visible |
| Human views | Migration Monitor, Execution Roadmap, Schedule, Dependency Map and Table; show source/target, batch status, failed records and validation owner |
| Agent validation | Reject missing source/target scope, negative/inconsistent record evidence, a non-migration subtype, a strategy other than `RECORD_VALIDATION` or a dependency that crosses an undeclared scope |

### Contract 3 — `B2B_SALES`

`executionContractId`: `EXC-B2B-SALES-V1`

| Contract field | Required rule |
|---|---|
| Planning input | Target accounts/deals, target value and currency, close window, accountable seller/owner, qualification assumptions and next-stage rule |
| Structure | `Pipeline → Stage → Account → Deal → Activity`; `WorkContainer` subtypes: `SALES_PIPELINE`, `SALES_STAGE`; `WorkItem` subtypes: `ACCOUNT`, `DEAL`, `ACTIVITY` |
| Item minimum | Every Account/Deal/Activity has a status, responsible subject and stage context; a Deal carries value/probability when known; Activity identifies the next action or its explicit completed outcome |
| Progress | `WEIGHTED_PIPELINE`; evidence keys: `target`, `wonRevenue`, `weightedValue`; deal probability is constrained to the declared 0–1 range when present |
| Stage close | Every open Deal has a next action, owner and expected window; Deals are explicitly won, lost or carried over before a terminal pipeline close; target variance and blocker dependencies are shown |
| Human views | Sales Pipeline, Execution Roadmap, Schedule, Dependency Map and Table; show stage, deal value, probability, owner, next action and blockers |
| Agent validation | Reject a non-sales subtype, a strategy other than `WEIGHTED_PIPELINE`, an invalid probability, an unowned Deal/Activity or an unsupported metric key |

### Contract 4 — `B2C_CAMPAIGN`

`executionContractId`: `EXC-B2C-CAMPAIGN-V1`

| Contract field | Required rule |
|---|---|
| Planning input | Audience definition without unnecessary PII, campaign objective, channels, wave dates, budget, KPI target, approval owner and measurement window |
| Structure | `Campaign → Wave → Channel → Audience/Creative/Experiment`; `WorkContainer` subtypes: `CAMPAIGN`, `CAMPAIGN_WAVE`, `CHANNEL`; `WorkItem` subtypes: `CREATIVE`, `AUDIENCE`, `EXPERIMENT` |
| Item minimum | Every Creative/Audience/Experiment has an owner, channel/wave context, status and acceptance/measurement criterion; audience records use a segment reference, not raw personal data in the plan |
| Progress | `KPI_ATTAINMENT`; evidence keys: `spend`, `leads`, `cpa`, `cac`, `conversion`, `conversions`, `revenue`, `roas` |
| Wave close | Spend is reconciled, KPI results are recorded for the measurement window, experiments have a decision, and unapproved/failed creative or audience work is carried over or cancelled explicitly |
| Human views | Campaign Control, Execution Roadmap, Schedule, Dependency Map and Table; show wave, channel, budget/spend, KPI attainment, owner and blockers |
| Agent validation | Reject raw PII where a segment reference is sufficient, a non-campaign subtype, a strategy other than `KPI_ATTAINMENT`, unapproved completion claims or unsupported metric keys |

### Contract 5 — `PRODUCT_LAUNCH`

`executionContractId`: `EXC-PRODUCT-LAUNCH-V1`

| Contract field | Required rule |
|---|---|
| Planning input | Launch outcome, launch date/window, target audience/market, deliverables, readiness criteria, required gates and accountable launch owner |
| Structure | `Phase → Milestone → Deliverable → Gate`; `WorkContainer` subtype: `LAUNCH_PHASE`; `WorkItem` subtype: `DELIVERABLE`; Milestones and Gates are first-class plan records |
| Item minimum | Every Deliverable has an owner, target date or explicit undated warning, readiness criterion and linked phase/milestone; every required Gate states its evidence requirement |
| Progress | `MILESTONE_READINESS`; evidence keys: `readiness`, `blockedGates`; required gates remain visible even when no evidence exists |
| Phase close | Deliverables meet their readiness criteria, Milestones are complete, and all required Gates are `PASSED` or explicitly `WAIVED`; `BLOCKED` gates prevent an unqualified launch close |
| Human views | Launch Timeline, Execution Roadmap, Milestones & Gates, Dependency Map and Table; show readiness, gate state, launch date and blocker owner |
| Agent validation | Reject a non-launch subtype, a strategy other than `MILESTONE_READINESS`, a required gate without an evidence rule or a completion claim that bypasses gate state |

### Contract 6 — `OPERATIONS`

`executionContractId`: `EXC-OPERATIONS-V1`

| Contract field | Required rule |
|---|---|
| Planning input | Operating period, service/process outcome, SLA target, expected volume/backlog baseline, escalation owner, reporting cadence and accountable owner |
| Structure | `Period → Process → Run → Checklist/Issue/SLA`; `WorkContainer` subtypes: `OPS_PERIOD`, `OPS_PROCESS`; `WorkItem` subtypes: `CHECKLIST_ITEM`, `ISSUE`, `SLA` |
| Item minimum | Every Checklist Item/Issue/SLA has an owner, operating period/process context, status and measurable completion or SLA criterion; Issues carry severity/impact when known |
| Progress | `SLA_SCORE`; evidence keys: `slaMet`, `slaTotal`, `throughput`, `backlog`, `incidents`, `completed` |
| Period close | SLA result, throughput, backlog and incidents are reviewed; unresolved Issues/SLA breaches have an owner and next action; recurring work may close the period without pretending unresolved work is done |
| Human views | Operations Board, Execution Roadmap, Schedule/Calendar, Dependency Map and Table; show SLA score, backlog, incidents, assignee and escalation owner |
| Agent validation | Reject a non-operations subtype, a strategy other than `SLA_SCORE`, a period close with no SLA evidence where an SLA was declared, or an unsupported metric key |

### Contract 7 — `BUSINESS_EXPANSION`

`executionContractId`: `EXC-BUSINESS-EXPANSION-V1`

| Contract field | Required rule |
|---|---|
| Planning input | Target market/site/branch, go-live window, budget, legal/location requirements, hiring/vendor assumptions, operational-readiness criteria and accountable expansion owner |
| Structure | `Initiative → Market/Site/Branch → Milestone → Approval → Setup → Go-live`; `WorkContainer` subtypes: `EXPANSION_INITIATIVE`, `EXPANSION_SITE`; `WorkItem` subtypes: `SETUP_ACTION`, `APPROVAL` |
| Item minimum | Every Setup Action/Approval has a target site/initiative context, owner, status and completion/evidence criterion; Approval items identify the approving authority when known |
| Progress | `EXPANSION_READINESS`; evidence keys: `legal`, `location`, `budget`, `hiring`, `vendors`, `operationalReadiness`, `goLive` |
| Initiative close | Legal, location, budget, hiring/vendor and operational-readiness checks are visible; required approvals pass or are explicitly waived; Go-live is an explicit owner decision, not an inferred percentage |
| Human views | Expansion Portfolio, Execution Roadmap, Schedule, Milestones & Gates, Dependency Map and Table; show site, readiness, budget, approval owner and blockers |
| Agent validation | Reject a non-expansion subtype, a strategy other than `EXPANSION_READINESS`, a missing site/initiative context or a go-live completion claim without required readiness evidence |

## Contract-to-source mapping

The seven contracts are intentionally duplicated here as the user/Agent
contract, but their machine allowlists remain single-sourced:

| Contract concern | Machine source |
|---|---|
| Canonical mode and default strategy | `src/lib/validation/enums.js` → `EXECUTION_MODE_CONTRACTS` |
| Envelope shape and allowed mode enum | `contracts/plan-envelope.schema.json` and `src/modules/project-manager/import/plan-schema.js` |
| Semantic subtype/metric validation | `validatePlanSemantics()` and the mode contract in `enums.js` |
| Status vocabulary | `src/lib/validation/enums.js` (`WORK_STATUSES`, `CONTAINER_STATUSES`, `MILESTONE_STATUSES`, `GATE_STATUSES`) |
| Progress calculation | Workstream `progressStrategy` plus the mode evidence; no contract may replace it with item counts |
| Authorization and audit | resolved viewer, owning Project Manager services and AuditEvent |
| Execution trace/replay | SDD-041 target contract; current runtime has only generic AuditEvent and does not yet persist run/step/attempt lineage |

If a contract row conflicts with one of those machine sources, the implementation
must stop and reconcile the documentation/schema first. It must not add a local
allowlist in a UI component or Agent prompt.

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
- **AC-069.12** Each mode contract has a stable `executionContractId` and
  `contractVersion`; the selected contract is recorded before validation and
  remains visible in preview, commit and audit results.
- **AC-069.13** Every common and mode-specific lifecycle step emits a unique
  `executionRunId`, `executionStepId`, `stepKey`, `attemptId`, `correlationId`
  and the applicable `projectId`, `planId`, `containerId` and `workItemId`.
- **AC-069.14** A tag attached to a step uses `tagId` against the
  `executionStepId`; a tag cannot replace the structured failure code,
  auditEventId or replay lineage.
- **AC-069.15** A failed step is queryable by `executionStepId` and
  `attemptId`, includes `failureCode`, `errorRef`, `retryable` and
  `auditEventId`, and marks downstream steps explicitly as skipped or not
  started.
- **AC-069.16** Full and partial replay create new run/step/attempt IDs,
  preserve `replayOfExecutionRunId`/`replayOfExecutionStepId`, revalidate
  authorization and input hashes, and never mutate the original trace.
- **AC-069.17** Human and Agent intake preserve authorized `goalId`/`goal_id`
  links and aggregate `goalIds[]`; the required human goal/outcome text remains
  independent from an optional existing BusinessGoal link.
- **AC-069.18** Human and Agent intake preserve `riskId`/`risk_id` only for an
  authorized Risk record, fail closed on unknown or cross-scope risk references,
  and show unavailable when the Risk owner/model is not present.
- **AC-069.19** Every mode contract accepts the same normalized supporting
  identity envelope for `gate_id`, `artifact_id`, `contract_id`, `meeting_id`,
  `call_id`, `followup_id`, `req_id`, `verify_id`, `integration_id`, `graph_id`,
  `node_id`, `edge_id`, `workflow_contract_id`, `workflow_id`, `runbook_id`,
  `promotion_id`, `skill_id` and `tool_id`; mode-specific differences are
  optional applicability, not different meanings or different ID formats.
- **AC-069.20** Dry-run resolves supporting references before authorization and
  commit. Unknown, unauthorized or owner-unavailable references produce an
  explicit conflict/unavailable result and never create a partial write.
- **AC-069.21** `contract_id` remains CRM Contact context,
  `executionContractId` remains the seven-mode Execution contract,
  `workflowContractId` remains the multi-agent workflow contract, and
  `integration_id` remains the Integration identity. `meeting_id`, `call_id` and
  `followup_id` remain CRM interaction identities; `req_id` remains a declared
  requirement reference; `runbook_id` remains a selected procedure; and
  `promotion_id` remains a promotion occurrence. `int_id` is accepted only as
  a legacy alias for `integration_id`; none of these fields may be silently
  reinterpreted as another owner or resource.

## Non-goals

- Selecting or integrating a real authentication provider.
- Deciding whether Agent transport is API, MCP, LINE or another adapter.
- A persistent Blueprint marketplace/library or user-authored template system.
- Automatic commit without preview and Human confirmation.
- New execution modes, a new Project hierarchy or a second plan database.
- Creating supporting Artifact, Contact, Meeting, Call, Follow-up, Verify,
  Integration, Workflow, Runbook, Promotion, Skill, Tool or graph persistence
  models as part of intake documentation.
- Choosing API versus MCP for Agent transport; all transports use the same
  normalized identity envelope.

## Related documents

- [ADR-028 — Human-visible execution roadmap](../../../decisions/ADR-028-HUMAN-VISIBLE-EXECUTION-ROADMAP.md)
- [FR-068 — Human-visible Execution Roadmap](FR-068-human-visible-execution-roadmap.md)
- [FR-070 — Stable execution, domain and tag identities](FR-070-stable-execution-domain-and-tag-identities.md)
- [Seven Execution Modes](../../../EXECUTION-MODES.md)
- [PlanEnvelope schema](../../../../contracts/plan-envelope.schema.json)
- SDD-039 — Roadmap contract (registered in [PRD-SDD-v1.0.md](../../../PRD-SDD-v1.0.md))
