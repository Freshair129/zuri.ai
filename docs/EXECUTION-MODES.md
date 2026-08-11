# Seven Execution Modes

## Core rule

Execution mode belongs to a Workstream.

Project may mix modes.

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
