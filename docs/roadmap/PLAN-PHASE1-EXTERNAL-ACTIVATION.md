---
version: "0.1.1b"
created_at: "2026-08-14T08:54:00+07:00,ATHER"
last_update: "2026-08-14T11:45:00+07:00,ATHER"
status: "beta"
attributes:
  domain: "line-ai"
  doc_type: "implementation-plan"
  scope: "ZV2-CR-006 A0-A8"
---

# Implementation plan — Phase 1 external activation

## Work order

| Wave | Lane | Size | Parallel | Current state | Exit |
|---|---|---:|---|---|---|
| W0 | A0 DIG, authority, inventory correction | S | no | PASS | graph clean; no cycle |
| W1 | A1 corpus mapping | M | yes | BLOCKED | reviewed owner-approved mapping |
| W1 | A2 isolation/backup inventory | M | yes | PARTIAL | live role isolation PASS; physical backup/PITR approval remains |
| W1 | A3 canary prerequisite audit | M | yes | BLOCKED | reviewed installer/receipt/recovery path |
| W1 | A4 cross-lane review | S | after A1-A3 | PASS_WITH_WARNINGS | executable gate packet |
| W2 | A5 real evaluation + live rollback-only isolation | L | yes, when gates exist | PARTIAL | live isolation PASS and fresh; real provider evaluation remains |
| W3 | A6 binding re-read and exact hashes | L | no | BLOCKED | controlled operator mutation succeeds |
| W3 | A7 one signed canary | M | no | NOT_RUN | truthful receipt |
| W4 | A8 acceptance review and truth-sync | S | no | BLOCKED | owner accepts Phase 1 |

No `L` or higher lane may start while any predecessor is `BLOCKED`, `FAIL`, `NOT_RUN`, `STALE`
or `UNKNOWN`.

## Stop conditions

- missing or ambiguous project/Tenant/Business/binding/destination;
- credential visible in output, Git or process arguments;
- corpus not approved or not mapped to the production artifact;
- backup/PITR or rollback rehearsal not approved;
- binding no longer `PENDING`/hash-free, or routing already enabled; or
- any evidence report fails, is stale or has a mismatched hash.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | beta | DIG-first parallel execution plan with hard operator join | working-tree | ATHER |
| 0.1.1b | 2026-08-14 | beta | Live isolation evidence recorded; backup, provider, binding and LINE gates remain explicit | working-tree | ATHER |
