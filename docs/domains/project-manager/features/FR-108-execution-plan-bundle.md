---
domain: project-manager
feature: FR-108
module: project-manager
source: v2-native
---

# ExecutionPlanBundle import orchestration — the runtime slice of ADR-049

| Field | Value |
|-------|-------|
| **Version** | 1.0.0 |
| **Status** | Implemented (FR-108, SDD-056, FEAT-012) |
| **Author** | Claude Fable 5 (subagent) |
| **Created** | 2026-08-27 |
| **Last Updated** | 2026-08-27 |

The architecture and contract are ADR-049 and
`docs/domains/project-manager/EXECUTION-PLAN-BUNDLE.md`; this note records only
the decisions the runtime slice had to make where those documents were silent.

## 1. Where the bundle receipt lives — no new table

D9 requires a bundle receipt; the module doc's §10 says the bundle "does not
introduce an ExecutionPlanBundle database table as a business object". Both are
satisfied by reusing `PlanImportReceipt` — which *is* already an idempotency
ledger, not a business object — under `stepKey = 'bundle.import.commit'`
(per-Project rows keep their default `plan.import.commit`). The model's
required `projectId` anchors on the bundle's first committed Project (a bundle
always has ≥ 1), and the full receipt — including the per-Project lineage D9
asks for — lives in the linked `BUNDLE_IMPORTED` AuditEvent payload, which is
what replay reads back. Consequences accepted knowingly:

- bundle keys and per-Project keys share one namespace; a key reused across
  kinds fails the payload-hash equality check and is refused, which is the
  correct answer for a key that already means something else;
- replay of a bundle without an idempotency key is impossible, exactly as it
  is for a PlanEnvelope without one.

## 2. One transaction, existing services, one `db` seam

D8 atomic mode requires strategy + N Projects + dependencies + receipt in one
database transaction, and D3 forbids a second writer. The existing services
could not previously run inside a caller's transaction, so this slice added
exactly one seam: `dryRunPlan`/`commitPlan` accept an optional `db`
(defaulting to the shared client — every existing caller unchanged), and the
bundle commit hands composed services a proxy whose `$transaction(fn)` simply
continues on the bundle's own transaction. The alternative — extracting the
commit bodies into tx-shaped internals — was rejected as a larger diff with
the same behavior and more drift surface.

The nested `commitPlan` calls re-run their own dry-runs *inside* the bundle
transaction, so they see the strategy rows the same transaction just created.
That is also why dry-run state is **not** shared with commit: `commitBundle`
re-runs `dryRunBundle` from scratch (the `commitPlan` precedent — one decision
point), and there is no confirmation token to replay or spoof. The one
deliberate preview/commit difference: a goal the bundle will *create* has no
UUID at preview time, so it appears as a pending symbol (`pendingGoalRefs`)
in the per-Project preview rather than a fabricated id, and its ProjectGoal
link count materializes only at commit.

## 3. Strategy codes are identities, so create takes a declared `code`

The FR-059 create services minted codes from titles (`uniqueHumanCode`). A
bundle declares `roadmap.code` / `goal.code` as its stable identity — the
thing a re-import matches on — so `zRoadmapCreateInput`/`zGoalCreateInput`
gained an optional `code`. Declared-and-taken is refused (409), never
suffixed: a suffixed lookalike would silently break every future match.
Omitted, behavior is byte-for-byte the old one.

## 4. Strategy authority is stricter than bundle authority — by design

Phase A authorizes the bundle with the import surface's own composition
(`ownsBusiness` OR a Tenant-bound FR-106 `apik_` key). Strategy writes are
FR-059 owner-scoped, so a key-only viewer with a strategy-carrying bundle gets
a *dry-run conflict* ("strategy writes require owner authority"), not a 403
mid-commit — D7's rule that the preview refuses everything the commit would.
A key-only viewer importing a strategy-free bundle still works.

## 5. Cross-Project dependency edges are written in the import lane

`dependency-service.createDependency` is bound to the shared client and its
own audit call, so it cannot join the bundle transaction. The bundle commit
therefore writes the PROJECT→PROJECT edge with the identical
findFirst-then-create discipline `plan-import-service` already uses for
in-plan edges — the import lane is the sanctioned dependency writer for edges
arriving in an import artifact (BR-009). Authorization is not weakened: both
endpoints are Projects the same transaction committed inside the one
authorized Business. `relation` is validated against `DEPENDENCY_TYPES` (the
JSON Schema defers vocabulary to "the canonical dependency contract"; that
contract is the enum). Cycles are refused twice: intra-bundle in pure
semantics, and against existing PROJECT edges in the dry-run.

## 6. Horizon reconcile semantics follow FR-059, previewed honestly

When a bundle updates an existing Roadmap and lists horizons, the FR-059
service reconciles the horizon set *to the submitted list*. The dry-run
previews that truthfully: an omitted existing horizon with goals attached is a
conflict (the reconcile would refuse); one without goals is shown as a
removal. A bundle that lists no horizons on an existing roadmap leaves the set
untouched. A new roadmap must carry 2–3 horizons (the FR-059 cardinality
rule), surfaced as a dry-run conflict rather than a mid-commit throw.

## 7. Deliberately out of scope

- UI uploader / import-page tab (the module doc's §11 surface tranche).
- MCP / Agent adapters (`EXECUTION_PLAN_BUNDLE` input kind on those surfaces).
- Coordinated (non-atomic) commit mode — D8 documents when it becomes
  mandatory; this implementation is atomic and says so at the top of
  `bundle-commit-service.js`.
- Roadmap/goal date/status/priority fields in strategy entries: the bundle
  contract does not carry them (schema `$defs`), so neither does the
  orchestrator.
