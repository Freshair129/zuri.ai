---
id: ZAI:MSP-RETENTION-SCHEDULER-PLAN-20261024
doc_type: implementation-plan
status: active
superseded_by: null
version: "0.1.0"
relations:
  - type: references
    target: ZAI:FR-230
  - type: relates_to
    target: ZAI:SEC-031
  - type: relates_to
    target: ZAI:ADR-091
---

# MSP retention scheduler implementation plan

Use `superpowers:executing-plans` for implementation and a fresh independent
review of the final patch. The owner's 2026-10-24 instruction authorizes this
retention fix and its tests; production memory activation awaits real LINE UAT.

**Goal:** invoke existing MSP API-011 retention nightly with tenant authority,
bounded work, live-job protection and observable failures.

**Spec:** [FR-230](../features/FEAT-037/requirements/FR-230.md),
[SEC-031](../requirements/SEC-031.md), and
[ADR-091 D2](../decisions/ADR-091-CHAT-RECORD-AND-AGENT-MEMORY-SPLIT-AND-THE-CONTEXT-COMPOSER.md).
Their required behavior is unchanged. FR-230's original delivery cell describes
historical CRM-only implementation, not evidence that MSP is currently swept.

## Design and alternatives

Extend Zuri using its existing deployment-authenticated route, one-shot worker
and Windows Task Scheduler pattern. The new Agent route owns MSP execution;
CRM's sweep and cadence stay separate. MSP remains the only content writer.
Keep pinned MSP `d0d48c1a8e833478525d9a6ce5ee16af2c85444d` and API-011 unchanged.
Direct SQLite mutation would bypass the provider contract. An always-running
second scheduler would duplicate the host's existing execution mechanism.

The protected deployment configuration maps exactly one Tenant UUID to its
Workspace UUID, matching the current LINE deployment's singleton
`ZURI_MSP_THREAD_WORKSPACE_ID` and `ZURI_MSP_THREAD_SERVICE_KEY` and its keyring
entry. A wider mapping is refused until normal LINE composition supports it.
The Workspace's Tenant and Business ancestry must both agree. Only the operator-authenticated maintenance
entry point signs `operator:true`; the conversational port never gains it.
Grants bind operation, body hash, tenant, workspace, expiry and fresh nonce,
with private read/write false. No browser/model-selected tenant or clock.

For each Tenant choose min(90-day canonical default, valid positive deployment
horizon, current downward-only Tenant override). Each fresh stdio child receives
that horizon; it only acts on its signed Tenant. Fail malformed configuration,
unknown DB provider, incompatible results or absent authority before mutation.

Hold a database write fence while checking jobs and invoking MSP. PostgreSQL
uses `LOCK TABLE "LineConversationJob" IN SHARE ROW EXCLUSIVE MODE`, blocking
new admissions/updates and serializing maintenance calls; SQLite acquires its
write lock before reading jobs. Skip the entire Tenant for any job outside
RECORDED/FAILED/CANCELLED, a conservative protection including UNKNOWN and
ACCEPTED and unsettled memory delivery, even on a terminal LINE job. This also
protects jobs without projection receipts. The normal database fence prevents
new job writes between the check and external tombstoning. After that check,
commit a STARTED audit before invoking MSP. Every configured production thread
memory port checks for an unsettled STARTED before calling a tool; a failed DB
lookup denies. If the lock connection is lost, CRM ingress may continue, but
MSP thread access remains blocked until the child exits and its outcome settles.
The durable gate survives process/container crashes and is not a second task ledger.

Drain bounded 200-row provider batches, with a bounded invocation count and
transport timeouts and a 75-second normal run budget. Reaching the bound
reports PARTIAL, not success. Unstarted Tenants report DEFERRED at budget expiry.
Await actual MSP child exit before releasing the fence, including failure paths.
Production PostgreSQL holds that fence on a dedicated connection with no shorter
interactive-transaction lease. SIGTERM escalates to SIGKILL after one second,
then waits for the actual PID's exit. An exceptional unconfirmed exit keeps the
server-side fence held even if the HTTP worker times out; operator intervention
may be necessary. Container shutdown kills all contained processes. SQLite is
the development/test adapter, not a production deployment option.
Write a committed STARTED audit before external effects; COMPLETE/DEFERRED/
PARTIAL/UNKNOWN/FAILED outcomes carry counts only. Failure after provider commit is
UNKNOWN after the actual child exits, never an assertion of rollback. Retrying
uses new nonces; already tombstoned rows remain excluded by MSP.

The worker accepts no arguments from message content. It calls only loopback
`/api/agent/memory-retention`, refuses redirects and logs a safe fixed result
shape. A host wrapper checks the exact Docker Compose project/service, database,
persistent state volume and app revision before executing the worker. Register
03:00 daily with StartWhenAvailable, IgnoreNew overlap and bounded runtime;
preserve a failure exit code. No secret in task arguments or logs. Registration
does not enable memory or change the running image.

## Implementation tasks

- [x] 1. Add red tests for maintenance configuration/signing, downward-only
  windows, complete/partial/unknown outcomes and live-job skip/fence order.
  Implement Agent maintenance port/service and authenticated route.
- [x] 2. Add worker tests for exact endpoint, credentials, dry-run selection,
  timeout/redirect/error redaction and failed/deferred status. Implement worker
  plus guarded Windows registration/action scripts.
- [x] 3. Run real isolated SQLite and PostgreSQL fence tests. Run actual pinned
  MSP dry/live/retry with old/fresh/foreign content, fresh process, nonce and
  tool-visible tombstone checks. Synthetic data only; no production writes.
- [ ] 4. Run relevant existing consumer/CRM/transport tests, Server build and
  serialized governance. Obtain independent review of the exact patch and
  retain actual results. Use normal PR and exact-head CI.
- [ ] 5. Qualify and install only the reviewed scheduler against a matching
  artifact after environment checks. Demonstrate an actual scheduler invocation
  and next-run configuration. Production memory stays OFF pending retention
  acceptance and user LINE UAT. Do not replace main-dev while LINE UAT runs.

## Review focus and acceptance limits

Test admission races, multiple operators, unknown job states, malformed/zero
horizons, foreign Workspace/key mismatches, provider timeout after mutation,
batch saturation and scheduler target drift. Validate the real restricted
PostgreSQL runtime role can take the fence. A returned HTTP 200 without a valid
provider result and persisted audit is not acceptance. Existing protected/
summary and delivery-table retention is API-011's scope; this change does not
claim legacy API-009 vault TTL, passport consolidation or raw/trace CRM retention.

The host must be running Docker and its scheduler. An interactive-user task
cannot run while that user is logged out; report its actual principal mode.
State/config backups and source/image evidence are retained separately.

## Crash reconciliation authority

An unsettled STARTED blocks memory after restart. A later unrelated sweep cannot
release it. The manual host recovery script verifies the exact old container's
full ID, stopped state, PID zero, Compose project/service and state volume and a
qualified replacement target. It signs a 60-second Ed25519 attestation binding
the old/current IDs, Tenant run, project/revision, issue/expiry time and nonce.
Only the public key is installed on web; the private key and signer stay in a
protected host directory. The sweep bearer alone cannot clear a gate. Web checks
the signature and exact STARTED origin/scope before `recordAudit` appends the
correlated, idempotent RECONCILED event. No direct SQL repair is authorized.
Recovery attests process termination; it does not claim counts for an unknown
provider outcome. The host inspection is the trusted source of stopped state;
the application cannot query the host Docker daemon independently.
