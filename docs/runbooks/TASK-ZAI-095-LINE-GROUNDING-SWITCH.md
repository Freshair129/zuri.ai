---
version: "0.2.1"
created_at: "2026-09-27T00:00:00+07:00,Claude Sonnet 5"
last_update: "2026-11-08T14:39:37+07:00,Codex"
status: "beta"
superseded_by: null
attributes:
  domain: "knowledge"
  doc_type: "runbook"
  scope: "TASK-ZAI-095 — an explicitly selected SmartGift Business/account, the GKS_THEN_BUSINESS_KNOWLEDGE pilot, its 14-day shadow window, and audited rollback"
---

# TASK-ZAI-095 — LINE OA grounding pilot switch runbook

## Decision and authority boundary

The first pilot mode is `GKS_THEN_BUSINESS_KNOWLEDGE`: query the published corpus first and retain the existing traced Business-knowledge fallback. `GKS_CORPUS` is a separate no-fallback mode and is not the pilot mode. The first pilot window is **14 consecutive days**. Before the switch, record the planned Bangkok start and end timestamps; record the actual start and end at their respective boundaries. An empty or incomplete comparison window is not acceptance.

Use the existing `CONFIGURE_KNOWLEDGE_GROUNDING` and `CONFIGURE_KNOWLEDGE_GROUNDING_SHADOW` actions in `line-oa-account-service.js` (the grounding action begins at line 621). Do not add a switch API, update rows with SQL, or infer Business/account authority from a SmartGift name or a DIRECT traffic ratio. The account and Business must be selected explicitly by their persisted IDs and codes, and authority must be verified separately.

This runbook prepares a future production operator step. It does not authorize or claim a production switch, close TASK-ZAI-050 or TASK-ZAI-095, satisfy an approval, or establish current production state. P1's switch rehearsal is exercised on isolated test data only.

## Dependencies and gates

TASK-ZAI-095 requires a **qualified Phase-3 catalog publication** and current production-host evidence. It does not require successful completion of TASK-ZAI-042's retired Edge LINE cutover/fallback criteria. ASTRA-D1 D1 marks those TASK-ZAI-042 criteria superseded, not executed; the task remains visible with its other catalog, delivery and recovery obligations. Its task status is not a substitute for checking the publication evidence itself.

TASK-ZAI-050 remains `in-progress / PRODUCTION / IN_PROGRESS`; its three DoD booleans remain false. The MSP §6 material recorded by ASTRA-D1 is attributed historical evidence, not a current Zuri-source or production-host check. TASK-ZAI-050's exit still requires a real Business document, publication, query and citation record. Do not close it by copying the fixed corpus or synthetic-run evidence.

Before a production operation, an authorized production-host operator must provide current evidence for the exact images and embedded pins, migrations, backup/restore, qualified publication receipt, real Business-document query/citation, account and Business authority, and model/provider readiness. The Owen-named approval remains pending production-host evidence; keep `approver: Owen` and leave unmet DoD items unchecked.

## Roles

| Role | Responsibility |
|---|---|
| **Business OWNER or `LINE_OA_PUBLISHER`** on the selected Business | Authorizes and performs the account action through the existing service; the service checks current authority. |
| **Operator** | Runs the read-only inspection, confirms the exact account/Business and runtime owner, collects shadow evidence, and records any switch or rollback after authorized production work. |
| **Production-host operator** | Supplies current host, image, migration, publication, backup/restore and real Business-document evidence. This role is not satisfied by this local P1 packet. |

## Step 0 — Qualify the target from a complete inspection

Run the script with the approved direct connection source supplied securely by the authorized operator. `DATABASE_URL` and pooler connections are not accepted by this preflight.

```bash
cd apps/server
node scripts/ki17-line-grounding-inspect.mjs <protected-output-path>
```

The script is read-only and queries all `LineOaAccount` rows with their Business, recent job audience counts, and latest mode/shadow audit event per account and action. It reports `runtimeOwner`, `executionMode`, `transportMode`, `status`, `serverEnabled`, `knowledgeGroundingShadow`, current mode and version. It preserves the recent audience counts and DIRECT share as descriptive evidence. `knowledgeGroundingAuditLatestByAction` contains at most one latest event for each of `LINE_OA_ACCOUNT_KNOWLEDGE_GROUNDING_CONFIGURED` and `LINE_OA_ACCOUNT_KNOWLEDGE_GROUNDING_SHADOW_CONFIGURED`; absent events mean no matching action is on record. A failed required query marks the report `INCOMPLETE` and exits nonzero.

Stop on a nonzero exit, `inspectionStatus: INCOMPLETE`, or any `queryFailures`. A complete query set does not by itself mean the target is ready or authorized. Do not use a SmartGift label or DIRECT share to choose an account or grant authority. Record the exact selected Business ID/code and account ID/code, current `runtimeOwner`, `executionMode`, `transportMode`, `status`, `serverEnabled`, `knowledgeGroundingShadow`, `knowledgeGrounding`, `version`, and the report path. Verify the expected Business OWNER or publisher authority from current persisted state; do not infer one owner from the other. For this shadow pilot, require `runtimeOwner: SERVER`, `executionMode: SERVER`, `status: CONNECTED`, `transportMode: CLOUD`, and `serverEnabled: true`. The current Server answer/shadow path requires a connected, cloud-transport, server-enabled account; `CONVERSATION_RUNTIME`-owned accounts and accounts that fail any of those runtime gates are not eligible for this rehearsal.

## Step 1 — Isolated switch rehearsal

P1 rehearses the service actions and comparison path against isolated test fixtures, never a production database or LINE account. From `apps/server`, run:

```bash
npx vitest run tests/unit/ki17-line-grounding-inspect-lib.test.js tests/unit/ki17-line-grounding-inspect-script.test.js tests/integration/fr235-line-oa-knowledge-grounding-control.test.js tests/integration/fr277-line-grounding-shadow-compare.test.js
```

The integration fixtures exercise the authorized versioned switch, audit event, shadow collection, corpus evidence, traced fallback, and rollback to `BUSINESS_KNOWLEDGE` with shadow collection disabled. Test results qualify only the isolated code path; they are not production-host or live LINE evidence.

## Step 2 — Switch the explicitly selected account

Only after the production gates above are met, the owner/publisher applies the existing action with the freshly read account version:

```http
PATCH /api/line-oa/accounts/{accountId}
Content-Type: application/json

{
  "action": "CONFIGURE_KNOWLEDGE_GROUNDING",
  "knowledgeGrounding": "GKS_THEN_BUSINESS_KNOWLEDGE",
  "version": <current account version>
}
```

Then enable shadow collection with the version returned by the first action:

```http
PATCH /api/line-oa/accounts/{accountId}
Content-Type: application/json

{
  "action": "CONFIGURE_KNOWLEDGE_GROUNDING_SHADOW",
  "knowledgeGroundingShadow": true,
  "version": <version returned by the mode switch>
}
```

Both actions are audited and version-checked. A stale version is a conflict: re-read the account and have the authorized operator decide whether to retry. Never force an update. The switch changes grounding mode only; it does not change LINE transport, credentials or execution permission.

## Step 3 — Collect the 14-day shadow comparison

Before the switch, record the planned exact Bangkok start/end timestamps for the 14-day window. At the actual boundaries, record the actual Bangkok start and end timestamps and retain evidence that collection covered 14 consecutive days. Keep the pilot mode at `GKS_THEN_BUSINESS_KNOWLEDGE`. If the required account/runtime evidence or comparison rows are missing for any required portion of the window, mark the window incomplete and do not claim acceptance.

For each eligible server-side job, retain both sources of evidence:

- The customer-facing primary path's `EVIDENCE_SELECTED` trace shows the GKS corpus attempt and, when needed, the `BUSINESS_KNOWLEDGE` fallback with its reason and retrieval references.
- The existing `runLineGroundingShadowCompare` harness records the paired-mode result in `LineGroundingShadowComparison`. With the pilot mode active, its shadow mode is `BUSINESS_KNOWLEDGE`; the comparison row records the shadow evidence source/reason, divergence and outcome. It does not replace the primary trace.

Record the exact Business/account, observed `runtimeOwner`, server-side job count, selected mode, both trace and comparison evidence, corpus/fallback counts, retrieval references, mismatches, outages, and start/end timestamps. `GKS_CORPUS` has no paired shadow mode and must not be substituted for the pilot.

## Step 4 — Roll back through the same actions

On a regression or the authorized operator's instruction, restore the customer-facing mode first, then disable shadow collection using the new version returned by the first action:

```http
PATCH /api/line-oa/accounts/{accountId}
Content-Type: application/json

{
  "action": "CONFIGURE_KNOWLEDGE_GROUNDING",
  "knowledgeGrounding": "BUSINESS_KNOWLEDGE",
  "version": <current account version>
}
```

```http
PATCH /api/line-oa/accounts/{accountId}
Content-Type: application/json

{
  "action": "CONFIGURE_KNOWLEDGE_GROUNDING_SHADOW",
  "knowledgeGroundingShadow": false,
  "version": <version returned by the mode rollback>
}
```

Re-run the inspection and verify `knowledgeGrounding: BUSINESS_KNOWLEDGE`, `knowledgeGroundingShadow: false`, and the latest entries in `knowledgeGroundingAuditLatestByAction` for both `LINE_OA_ACCOUNT_KNOWLEDGE_GROUNDING_CONFIGURED` (to `BUSINESS_KNOWLEDGE`) and `LINE_OA_ACCOUNT_KNOWLEDGE_GROUNDING_SHADOW_CONFIGURED` (to `false`). This stops further corpus reads and shadow generations for that account. Do not use raw SQL. If either action conflicts, re-read the account and stop for the authorized operator.

## Step 5 — Record real production work only after it occurs

The exit criterion is satisfied by the end-of-pilot restore or an earlier rollback only when an authorized operator actually performs both changes in production through the existing audited actions — restore `BUSINESS_KNOWLEDGE` and disable shadow — verifies that later primary traces return to Business Knowledge, and records both changes in `AuditEvent`, the existing migration notes and the TASK-ZAI-095 container changelog. Record the switch and its 14-day evidence there as well. An uneventful window without the production restore or rollback, the later-trace check and those records does not satisfy the criterion. Keep the named approval and DoD flags unchanged unless the corresponding production evidence actually satisfies them.

The separate TASK-ZAI-050 activation record must be completed by the production-host operator. Its prepared skeleton is `.brain/reports/2026-11-08-task-zai-050-activation-record.md`; all current host fields remain `NOT_VERIFIED`.

## Host-only commands for the authorized operator

These commands are not run by P1. Supply credentials through the approved secure environment; never put connection strings in this document or a tracked file.

```bash
node scripts/ki17-line-grounding-inspect.mjs <protected-output-path>
node scripts/ki17-smoke.mjs
```

## Changelog

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.2.1 | 2026-11-08 | beta | Clarifies that the end-of-pilot restore or a rollback satisfies the exit criterion only when both grounding-mode restoration and shadow disablement are performed in production through audited actions, later primary traces return to Business Knowledge, and both changes are recorded in AuditEvent, migration notes and the container changelog. | working-tree | Codex |
| 0.2.0 | 2026-11-08 | beta | Applies ASTRA-D1 D4: selects GKS_THEN_BUSINESS_KNOWLEDGE for a 14-consecutive-day pilot; documents explicit Business/account/runtime selection, direct-source complete preflight, existing switch and shadow actions, the built shadow harness, and rollback that restores BUSINESS_KNOWLEDGE and disables shadow. Records production-host blockers without claiming activation. | working-tree | Codex |
| 0.1.0 | 2026-09-27 | beta | Initial runbook: preflight, the audited switch and rollback, shadow evidence and migration-note recording. It did not resolve TASK-ZAI-042/TASK-ZAI-050 or specify a campaign-window duration. | working-tree | Claude Sonnet 5 |
