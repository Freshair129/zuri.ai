---
status: active
superseded_by: null
version: "0.1.0"
---

# Scoped verification pilot

The owner approved architecture proposal v0.1.0 on 2026-10-06, after clarification
that the reported long test duration concerned GitHub Actions. This increment
adopts the documentation structure and implements Conversation Runtime planning
in shadow mode. No production service extraction or job omission is activated.

Baseline: remote main `71e5dde06104c5e1ff30fa5f890031b5fcdb514b`. The separate
SME Sales worktree and the primary checkout remain untouched. Global requirement
IDs, pinned subjects, existing source-preserved records and compatibility exports
are not rewritten.

## Delivery

- Domain/service/canonical-source policy and four service documentation entries.
- Versioned Runtime metadata with validation against real paths/package scripts.
- Shared local/CI shadow planner using the existing scope selector.
- Generated service-map view; generation and freshness check are explicit.
- CI artifact and planner regression checks, without changing existing job gates.
- [RCA](../../../.brain/rca/2026-10-06-service-verification-contract-drift.md) for
  the confirmed policy/documentation gap, not the unidentified 60+ minute incident.

## Verification record

The [local validation receipt](VALIDATION.json) records commands, outcomes,
test counts, source digests and limits. `PASS` applies only to the command and
environment named there; `NOT_RUN` identifies wider or hosted work without a
receipt. This pilot does not assert a full-suite or deployment result.

The regression matrix covers Runtime-only/mixed-doc changes, contracts, shared
authority/configuration, canonical records, unknown/new-service paths, missing
references/history, empty consumers, renamed/deleted files and working-tree input.
It also verifies Windows directory-junction containment and keeps the generated
service map out of its own source graph. These are planning and reader checks;
representative production change pairs are a later adoption gate.

Use `npm run verification:plan -- --base <commit> --event local` for current WIP.
Use `npm run docs:services` and `npm run docs:services:check` for navigation.
Run the selected service's package scripts and Core contract checks separately;
the plan command executes none of them. Hosted PRs publish the comparison under
`verification-shadow-plan`, and governance publishes `service-map` for readers
without a checkout. Both artifact steps require an actual hosted run.

The base checkout still tracks `llms-full.txt` despite the ADR-081 ignore rule.
This increment regenerates that existing tracked copy and retains its tracking;
it does not perform an unrelated file-removal migration. Existing preflight
warnings remain separate from this pilot's acceptance.

## Adoption still required

Collect paired shadow/full evidence across the change matrix in the
[policy](../../architecture/VERIFICATION-POLICY.md). Resolve non-import consumer
edges before treating selection as complete. Add no skip/enforcement switch until
that evidence is reviewed and the aggregate gate can reject unplanned omissions.
No measured speedup is claimed by the existence of a planner or service directory.

Version diff 0.0 → 0.1.0: records approved scope, baseline, rollout and evidence limits.
