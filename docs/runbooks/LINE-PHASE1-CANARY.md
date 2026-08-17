---
version: "0.1.0b"
created_at: "2026-08-14T08:10:00+07:00,ATHER"
last_update: "2026-08-14T08:20:18+07:00,ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "line-ai"
  doc_type: "runbook"
  scope: "FR-054 dry-run LINE canary planning"
---

# LINE Phase 1 canary runbook

## Authority and boundary

This runbook implements FR-054 under ADR-019 and ZV2-CR-005. The tracked command creates a
`DRY_RUN` plan only. It cannot install binding hashes, change binding status, enable routing or call
LINE. A passing plan is readiness evidence, not approval to activate.

## Preconditions

Prepare a local, untracked JSON input containing the exact project, Tenant, Business, binding,
provider and model, plus fresh passing golden and runtime-isolation report hashes. The generated
output conforms to `contracts/phase1-activation/canary-plan.schema.json`.
Do not include passwords, database URLs, provider keys, LINE secrets, reply tokens, authorization
headers, customer content or PII.

The binding must be `PENDING`, routing must be disabled and destination/credential hashes must not
already be installed. The approved provider credential is represented only by the boolean
`credentialAvailable`; the secret itself stays in the approved secret manager.

For the connection cut-over, the plan must also identify one exact Business-scoped
`PHASE1_LINE_LLM` connection with `status=ACTIVE` and `role=PRIMARY`. The runtime must resolve it
from the server-owned binding scope; it must not choose the latest connection or accept a
client-supplied connection id. Ollama is local/dev/test evaluation only and is never a live
production canary provider.

## Generate the dry-run plan

```powershell
node scripts/plan-line-canary.mjs --input C:\secure-temp\canary-input.json --output C:\secure-temp\canary-plan.json
```

The output must say `mode: DRY_RUN`, `ready: true`, receipt state `EVIDENCE_VERIFIED`, and both
capabilities must be false. A missing, stale, mismatched, non-pending or already-routed prerequisite
fails closed and produces no plan.

## Receipt semantics

Record receipt states without promotion:

1. `GENERATED` — a response was generated locally.
2. `EVIDENCE_VERIFIED` — the dry-run prerequisites passed.
3. `ACCEPTED_BY_LINE` — a later separately approved live request was accepted by LINE.
4. `DISPLAYED_UNKNOWN` — acceptance does not prove display on a user's device.
5. `READ_UNKNOWN` — acceptance does not prove the user read the message.

Never label `ACCEPTED_BY_LINE` as delivered, displayed or read.

## Later operator-controlled activation

This repository command stops before activation. A separately approved operator procedure must
verify every external activation gate in ADR-019/CR-005, confirm the exact single canary audience,
install destination/credential hashes through the controlled production path, then enable only that
binding. Do not reuse this dry-run script for those mutations.

## Failure and rollback — routing first

1. Disable routing first; keep or return the binding to a non-active state through the approved
   operator path.
2. Stop further canary traffic and record the last truthful receipt state.
3. Preserve migrated knowledge, source data and evidence artifacts. Never delete, truncate or drop
   them as a rollback action.
4. Revoke or rotate affected credentials in the secret manager when indicated; do not write them
   into the incident record.
5. Investigate scope, provider, evidence freshness and receipt details before requesting a new
   canary approval.

## Exit evidence

- dry-run plan hash and input metadata hash;
- fresh golden and isolation report hashes;
- exact project/Tenant/Business/binding/provider/model identifiers;
- operator approval reference for any later live step;
- truthful receipt state and rollback record.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | beta | Initial mutation-free Phase 1 LINE canary runbook | working-tree | ATHER |
