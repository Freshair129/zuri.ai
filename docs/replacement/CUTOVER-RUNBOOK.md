# Cutover Runbook — one tenant at a time

| Field | Value |
|-------|-------|
| **Version** | 0.1.0 |
| **Status** | Skeleton — to be completed by `TASK-V2-CUTOVER-RULES` before any cutover |
| **Last Updated** | 2026-08-12 |

The unit of "done" for replacing V1 is **one tenant fully cut over** (ADR-003 §D1),
not "a module ported". A tenant that is half on V2 is the failure mode this document
exists to prevent.

## The single-writer rule (ADR-003 §D8)

At every instant, exactly one system owns a tenant's:

1. **LINE OA** — webhook destination for that channel
2. **background workers** — broadcasts, automations, scheduled jobs
3. **data writes**

All three flip together, in one step, for one tenant. Never "webhook on V2, workers
still on V1". Double ownership means double marketing blasts, double charges or
dropped chats — visible to the customer, not to us.

## Sequence (per tenant)

1. **Pre-flight** — parity verdicts for this tenant's modules are all must-have-done;
   contract tests green against V1's endpoints (`TASK-V2-CONTRACTS`).
2. **Freeze window announced** to the shop owner (short, business hours avoided).
3. **Export → migrate → import**, preserving UUIDs (ADR-003 §D4). Never a file copy.
4. **Reconcile**: row counts and spot checks per entity; printed-document ids still
   resolve; LINE bindings still resolve.
5. **Flip all three** (OA webhook, workers, writes) → V2.
6. **Watch**: first hour on the new system with a named person watching.
7. **V1 for this tenant becomes read-only** — not deleted, not writable.

## Rollback

Defined before the first cutover, not after a failure. Minimum: the flip is
reversible within the freeze window, and V1 read-only can be made writable again
with the migrated delta reconciled. If a rollback cannot be described concretely for
a tenant, that tenant is not ready to cut over.

## Done

The last tenant has a date (`TASK-V2-LASTDATE`). When it is cut over, V1 goes
read-only, then off.
