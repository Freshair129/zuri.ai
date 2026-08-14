---
version: "0.2.1b"
created_at: "2026-08-14T07:58:02+07:00,ATHER"
last_update: "2026-08-14T11:45:00+07:00,ATHER"
status: "beta"
attributes:
  domain: "line-ai"
  doc_type: "implementation-plan"
  scope: "FR-053 FR-054 W0-W4"
---

# Implementation plan — FR-053/054 Phase 1 activation readiness

## Baseline

- Source: PRD/SDD 1.36.0, ADR-018 0.3.0b, Phase 1 plan 0.4.0b.
- Preflight baseline: PASS, 0 critical and 0 warning.
- Branch baseline: merge commit `f0bf077` on `origin/main`.
- Production invariant: binding `PENDING`, no hashes, kill switch off.

## Complexity

| Work | Scope | Risk | Dependency | AI | Points |
|---|---:|---:|---:|---:|---:|
| W0 contracts | 2 | 5 | 1 | 0 | 8 |
| W1 golden evaluator | 5 | 5 | 1 | 2 | 13 |
| W2 isolation probe | 2 | 5 | 3 | 0 | 10 |
| W3 canary preflight | 2 | 5 | 3 | 0 | 10 |
| W4 integration | 2 | 5 | 1 | 0 | 8 |
| **Total** |  |  |  |  | **49** |

At one-agent capacity this is three bounded implementation waves including a 25% risk buffer. W1,
W2 and W3 are parallel after W0; W4 is the critical integration point. External credential and
canary execution are not scheduled because they require owner/provider inputs.

## Work order

1. W0 freezes contracts, ownership and tests.
2. W1/W2/W3 run in parallel with no shared-file ownership.
3. W4 reviews security semantics, adds shared exports/scripts and runs full gates.
4. Merge production-disabled readiness tooling.
5. Stop for external activation approval and credentials.

## Milestones

| ID | Milestone | Gate |
|---|---|---|
| M0 | Contracts frozen | docs graph/preflight/check pass; no dangling IDs |
| M1 | Readiness implementations | focused tests pass for W1/W2/W3 |
| M2 | Merge-ready | all ACs plus full release gates pass; traffic disabled |
| M3 | Phase 1 accepted | external live isolation, golden evaluation, backup/rollback and signed canary accepted |

## Risk register

| Risk | Score | Mitigation |
|---|---:|---|
| Credential disclosure | 20 | environment-only input, redaction tests, secret scan |
| False evidence-grounding pass | 20 | explicit evidence and numeric assertions; 20/20 gate |
| Cross-Tenant access | 20 | dedicated-login positive/negative/mutation probe |
| Accidental production activation | 20 | dry-run default; no mutation/LINE adapter in W3 |
| Delivery overclaim | 16 | explicit receipt state machine |
| Provider drift/rate limit | 12 | pinned provider/model metadata and bounded retry-free evaluation |
| Backup/rollback gap | 15 | activation remains blocked until policy and rehearsal are accepted |

## Exit

Merge-ready and production-ready remain different states. M2 can merge with `NOT_RUN` real-provider
and LINE evidence; M3 cannot pass without external credentials and operator approval.

## Execution result

M0-M2 are complete: contracts, W1-W3 implementations, W4 public exports/scripts and all local
release gates pass. M3 remains open because real-provider evaluation and the signed LINE canary are
`NOT_RUN`; live dedicated-login isolation now passes and is recorded separately from the remaining
operator gates.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | beta | Owner-approved W0-W4 plan, critical path and external gate | working-tree | ATHER |
| 0.2.0b | 2026-08-14 | beta | M0-M2 complete and merge-ready; M3 external activation gate remains open | working-tree | ATHER |
| 0.2.1b | 2026-08-14 | beta | Live dedicated-login isolation passes; real provider, recovery and LINE canary gates remain open | working-tree | ATHER |
