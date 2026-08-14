---
version: "0.1.0b"
created_at: "2026-08-14T08:54:00+07:00,ATHER"
last_update: "2026-08-14T08:54:00+07:00,ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "line-ai"
  doc_type: "change-request"
  scope: "Phase 1 external activation evidence and single controlled canary"
---

# ZV2-CR-006 — Phase 1 external activation

## Authority

The owner authorized parallel execution preparation on 2026-08-14 after requiring the dependency
impact graph first. ADR-019 remains binding: no agent may invent a credential, select a destination,
install binding hashes or call LINE without exact operator inputs and all predecessors passing.

## Complexity and risk

- Complexity: `C-3` — production database identity, provider output and external LINE delivery.
- Risk: `HIGH` — credential disclosure, cross-Tenant access or reply to the wrong destination.

## DIG

```mermaid
flowchart LR
  A0["A0 DIG + authority"] --> A1["A1 approved corpus mapping"]
  A0 --> A2["A2 live isolation prerequisites"]
  A0 --> A3["A3 backup/PITR + rollback evidence"]
  A0 --> A4["A4 canary identity + receipt packet"]
  A1 --> A5["A5 real provider evaluation"]
  A2 --> A6["A6 binding activation gate"]
  A3 --> A6
  A4 --> A6
  A5 --> A6
  A6 --> A7["A7 one signed LINE canary"]
  A7 --> A8["A8 truthful receipt + Phase 1 acceptance"]
```

The graph is acyclic. A1-A4 are parallel. A6 is the hard join and cannot run with any predecessor
in `NOT_RUN`, `FAIL`, `STALE` or `UNKNOWN`.

## Acceptance criteria

| ID | Criterion |
|---|---|
| AC-006-01 | DIG has no cycle and every remote mutation has all predecessors. |
| AC-006-02 | Corpus maps to approved public production evidence with no PII/financial leakage. |
| AC-006-03 | Real provider report passes 20/20 with zero unsupported numeric claims and is redacted. |
| AC-006-04 | Dedicated login live probe proves positive scope, cross-Tenant zero, no direct grants and rollback. |
| AC-006-05 | Backup/PITR policy and rollback rehearsal are approved before binding activation. |
| AC-006-06 | Canary plan pins one exact destination and expected project/Tenant/Business/provider/model hashes. |
| AC-006-07 | One signed canary records `ACCEPTED_BY_LINE` separately from display/read unknown. |
| AC-006-08 | Any failed/stale prerequisite leaves routing disabled and preserves migrated data. |

## Exit gates

1. A1-A5 evidence artifacts are fresh, redacted and hash-pinned.
2. Owner confirms the exact canary destination and controlled mutation window.
3. Binding is re-read immediately before mutation and remains `PENDING` and hash-free.
4. Canary produces a truthful receipt or routing-first rollback.
5. Phase 1 acceptance is recorded only after all evidence is reviewed.

## W1 audit result

| Lane | Reviewed result | Activation effect |
|---|---|---|
| A1 Golden mapping | PASS_WITH_WARN; mapping gate BLOCKED | 14/14 `ANSWER` cases use placeholder codes absent from the approved 74-row artifact; seven numeric allowlists lack approved evidence. |
| A2 isolation | WARN; live gate BLOCKED/NOT_RUN | Probe casts UUID-shaped identifiers to PostgreSQL `uuid` although deployed scope columns are `text`; dedicated credential and recovery approval remain absent. |
| A3 canary | PASS_WITH_WARNINGS; A6/A7 BLOCKED | No controlled hash installer, fresh recovery/rehearsal evidence or post-LINE receipt artifact exists. |
| A4 cross-review | PASS_WITH_WARNINGS | Focused local contracts pass 26/26; they do not replace real provider, PostgreSQL or LINE evidence. |

The production-disabled boundary is preserved. No credential was read, no remote SQL was run, no
binding was changed and no LINE request was made.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | beta | Owner-authorized DIG and parallel read-only activation preparation | working-tree | ATHER |
