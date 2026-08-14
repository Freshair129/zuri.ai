# Seven Execution Modes

## Core rule

Execution mode belongs to a Workstream.

Project may mix modes.

## PlanEnvelope mode contract

The neutral database model is shared, but an imported plan is validated against the
selected mode before dry-run. `executionMode` therefore determines the allowed
container subtypes, item subtypes, progress strategy, and metric evidence keys.
Unknown cross-mode vocabulary is rejected; mode-specific evidence remains optional
until the relevant work item has evidence to report.

| Mode | Container subtypes | Item subtypes | Metric evidence keys |
|---|---|---|---|
| `SOFTWARE_SPRINT` | `SPRINT`, `EPIC`, `RELEASE` | `TASK`, `BUG` | `completedWeight`, `plannedWeight`, `defects` |
| `DATA_MIGRATION` | `MIGRATION_STAGE`, `MIGRATION_BATCH` | `DATASET`, `VALIDATION`, `RECONCILIATION` | `recordsTotal`, `processed`, `success`, `failed`, `validated`, `reconciled` |
| `B2B_SALES` | `SALES_PIPELINE`, `SALES_STAGE` | `ACCOUNT`, `DEAL`, `ACTIVITY` | `target`, `wonRevenue`, `weightedValue` |
| `B2C_CAMPAIGN` | `CAMPAIGN`, `CAMPAIGN_WAVE`, `CHANNEL` | `CREATIVE`, `AUDIENCE`, `EXPERIMENT` | `spend`, `leads`, `cpa`, `cac`, `conversion`, `conversions`, `revenue`, `roas` |
| `PRODUCT_LAUNCH` | `LAUNCH_PHASE` | `DELIVERABLE` | `readiness`, `blockedGates` |
| `OPERATIONS` | `OPS_PERIOD`, `OPS_PROCESS` | `CHECKLIST_ITEM`, `ISSUE`, `SLA` | `slaMet`, `slaTotal`, `throughput`, `backlog`, `incidents`, `completed` |
| `BUSINESS_EXPANSION` | `EXPANSION_INITIATIVE`, `EXPANSION_SITE` | `SETUP_ACTION`, `APPROVAL` | `legal`, `location`, `budget`, `hiring`, `vendors`, `operationalReadiness`, `goLive` |

The source of truth is `src/lib/validation/enums.js`; Zod semantic validation and
`contracts/plan-envelope.schema.json` must stay aligned with this table.

## 1. SOFTWARE_SPRINT

Vocabulary:
```text
Release → Sprint → Epic → Task/Bug
```

Primary view:
`Sprint Board`

Progress:
`TASK_WEIGHT`

Evidence:
- completed weight
- planned weight
- defects
- release gate

## 2. DATA_MIGRATION

Vocabulary:
```text
Stage → Batch/Run → Dataset → Validation → Reconciliation
```

Primary view:
`Migration Monitor`

Progress:
`RECORD_VALIDATION`

Evidence:
- total records
- processed
- success
- failed
- validated
- reconciled

## 3. B2B_SALES

Vocabulary:
```text
Pipeline → Stage → Account → Opportunity/Deal → Activity
```

Primary view:
`Sales Pipeline`

Progress:
`WEIGHTED_PIPELINE`

Evidence:
- deal value
- probability
- weighted value
- target
- won revenue

## 4. B2C_CAMPAIGN

Vocabulary:
```text
Campaign → Wave → Channel → Audience/Creative/Experiment
```

Primary view:
`Campaign Control`

Progress:
`KPI_ATTAINMENT`

Evidence:
- spend
- leads
- CPA/CAC
- conversion
- revenue
- ROAS
- configured target weights

## 5. PRODUCT_LAUNCH

Vocabulary:
```text
Phase → Milestone → Deliverable → Gate
```

Primary view:
`Launch Timeline`

Progress:
`MILESTONE_READINESS`

Evidence:
- weighted milestone completion
- blocked gates
- launch date

## 6. OPERATIONS

Vocabulary:
```text
Period → Process → Run → Checklist/Issue/SLA
```

Primary view:
`Operations Board`

Progress:
`SLA_SCORE`

Evidence:
- SLA
- throughput
- backlog
- incidents
- completion

## 7. BUSINESS_EXPANSION

Vocabulary:
```text
Initiative → Market/Site/Branch → Milestone → Approval → Setup → Go-live
```

Primary view:
`Expansion Portfolio`

Progress:
`EXPANSION_READINESS`

Evidence:
- legal
- location
- budget
- hiring
- vendors
- operational readiness
- go-live gates

## Universal views

Regardless of mode:
- Overview
- All Work
- Timeline
- Dependencies
- Milestones & Gates
- Calendar
- Table
