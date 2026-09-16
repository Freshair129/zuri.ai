---
version: "0.2.0b"
created_at: "2026-09-08T18:34:25+07:00,RWANG,b17e7258"
last_update: "2026-09-17T01:37:37+07:00,RWANG"
status: "superseded"
superseded_by: ".brain/rca/2026-09-08-line-webhook-funnel-502-edge-receiver-not-restarted.md"
attributes:
  domain: "line-oa-studio"
  doc_type: "root-cause-analysis"
  scope: "Public LINE Funnel 502, installed Edge startup task and transport ownership"
---

# RCA — LINE Funnel 502 and Edge autostart transport drift

## Reconciliation and closure — 2026-09-17

This document preserves the read-only investigation from 2026-09-08, before
recovery. Its observations below are historical, not the current runtime state.
The later [incident and recovery RCA](2026-09-08-line-webhook-funnel-502-edge-receiver-not-restarted.md)
is the follow-up record; it was merged through
[PR #297](https://github.com/Freshair129/zuri.ai/pull/297), with subsequent
cutover findings and [PR #299](https://github.com/Freshair129/zuri.ai/pull/299).
That record documents explicit legacy startup/task registration, subsequent
ingress evidence, and later server cutover/admission fixes. Those are repository
records inspected for this closure, not live verification performed on 2026-09-17.

The two investigations agree on the missing 8787 backend and the installed task's
omitted transport mode. This earlier investigation could not prove the exact
dependency timeout branch; its hypothesis remains labelled below. The later
record contains additional observations from a separate investigation. Neither
record establishes current provider configuration or reboot recovery today.

The owner requested completion and branch deletion on 2026-09-17. The original
five dirty files were preserved together in commit `7fc2e4dd` before reconciliation:

- this RCA at version 0.1.0b;
- `apps/server/runtime/domain-state.json`;
- `docs/.doc-graph.json`;
- `docs/.domain-state.json`;
- `docs/.monorepo-graph.json`.

Their exact bytes also have a separate SHA-256-verified local archive. Reconciliation
uses [ADR-081](../../docs/decisions/ADR-081-GENERATED-VIEWS-ARE-BUILT-NOT-COMMITTED.md):
regenerate current documentation views, retain the committed runtime projection,
and do not reintroduce the retired monorepo graph. The original snapshots remain
recoverable from the preservation commit and archive.

Disposition: close this duplicate investigation as historical supplemental
evidence. Startup retry/logging improvements, a verified reboot, provider error
statistics/redelivery inspection, and any further transport activation remain
separate follow-up work; this document does not claim they were implemented.

## Scope and risk

- C-2: evidence-led operational RCA and documentation review.
- Investigation risk LOW: read-only network, process/task metadata, source/history,
  redacted log summaries and aggregate database reads. Documentation only.
- A future repair has HIGH risk if it changes LINE transport ownership or resumes
  delivery. No repair, process start, webhook change or message send was performed.
- Success: identify the failed network hop, explain startup/transport behavior from
  installed artifacts, distinguish proven causes from hypotheses, and specify
  verification and recovery boundaries.

## Symptom

The user supplied `https://desktop-vetatmq.tail71c7d1.ts.net/webhook/line`
as the LINE webhook under discussion. A read-only HEAD request returned HTTP 502.
The currently registered provider URL was not independently read from LINE.
Affected-message count, outage start time and provider redelivery state are unknown.

## Evidence

Observed on 2026-09-08, approximately 18:30–18:34 ICT unless a different time is
shown. Paths below describe the installed device, not an unbuilt monorepo copy.

| Observation | Evidence and practical limit |
| --- | --- |
| Funnel route | `tailscale funnel status` maps `/webhook/line` to `http://127.0.0.1:8787`. Tailscale service is Running, Auto. |
| Failed upstream | No Windows TCP listener on 8787; local HEAD to `http://127.0.0.1:8787/` is connection-refused; public HEAD returns 502. No POST or LINE event was submitted. |
| Host restart | `Win32_OperatingSystem.LastBootUpTime`: 2026-09-08 06:27:00.500 ICT. |
| Startup execution | Scheduled Task `ZuriEdgeStack`: LastRunTime 06:27:14 ICT, LastTaskResult 1, current state Ready, logon trigger, RestartCount 0. Ready means scheduled, not a healthy Edge service. |
| Installed task predates code change | Task file creation/last-write: 2026-09-04 11:48:01.626 ICT. Its description still says it starts embed, RAG and LINE webhook. Action runs `powershell.exe` with the installed `scripts/start-edge-stack.ps1`, without `-TransportOwner`. |
| Installed launcher | `C:\Users\pc\workspace\zuri-edge-device\scripts\start-edge-stack.ps1`, modified 2026-09-06 14:15:03 ICT. Default TransportOwner is SERVER at line 29; only LEGACY_EDGE opens 8787 at lines 167–169. |
| Change provenance | Edge commit `4a6e7ca47257c97a46c3f85e70f7f4f58ea4776c` (2026-09-06) changed the launcher default to SERVER and added an explicit mode argument to newly installed tasks. Installed Edge checkout HEAD is `a470a45`. |
| Exact source match | Installed launcher and this worktree's `apps/edge/scripts/start-edge-stack.ps1` share SHA-256 `1613DB39C8CA552D934680BFF1FFB6669037CD64791E0A45C3A4E138914F7DEE`. |
| Boot dependency processes | Python embed sidecar PID 26236 started 06:27:58.960; RAG Node PID 26068 started 06:31:02.805. Their parent launcher PID was 10264. Probe commands themselves were excluded from runtime attribution. |
| Current dependency health | 8891 and 8888 both answer HTTP 200; RAG reports `ok=true`. These are current checks, not proof of readiness during the startup deadline. |
| Worker evidence | No matching webhook/conversation worker was observed. Startup log directory has no conversation log files. Its webhook log files were last written on Sept 7; the Sept 8 embed/RAG stdout/stderr files are empty. |
| Limited failure diagnostics | TaskScheduler Operational log is disabled. No PowerShell Operational error events were returned for 06:26–06:35. The task action does not persist launcher stdout/stderr; child logs do not record the launcher's decision branches. |
| Server state, not delivery proof | Aggregate read-only SQL returned one LineOaAccount row with `serverEnabled=true` and zero LineConversationJob rows. The provider channel/account-to-URL match was not independently established. Zero jobs does not prove a stuck worker or quantify lost messages. |
| Separate web deployment | `zuri-ai-web-1` is healthy, revision `0eb6c03a`, started 17:43:50 ICT. It runs after the failed 06:27 Edge startup. It does not own the 8787 listener. |

The protected installed Edge `.env` was not read. No channel credentials, user
messages, raw provider payloads or business row contents are included here.

## Root cause

### Confirmed immediate cause: Funnel has no listening backend

The route still forwards LINE traffic to 8787, but no service accepts TCP there.
The public 502 and local connection refusal identify the failed hop. This is not
evidence of a Tailscale transport outage or a Zuri web-container outage.

### Confirmed configuration defect: old task inherits a new transport default

The registered startup task was not regenerated when the launcher acquired a
SERVER default. Its omitted mode now selects compute-only startup. The launcher
sets `ZURI_LINE_TRANSPORT_OWNER` itself and can open the legacy listener only when
explicitly invoked with LEGACY_EDGE. Thus even a successful dependency startup
would not restore the webhook endpoint still targeted by Funnel.

This is an operational migration gap: a persistent caller retained the old
implicit contract while the invoked script changed its meaning. The new task
installation code pins a mode, but changing that code does not update an already
registered Windows task. This finding does not justify making legacy mode the
global default again.

### Confirmed persistence gap; likely additional startup timeout

The task failed with code 1 and has no configured failure restart. The launcher
checks dependency readiness once per run, latches `$ok=false` on a deadline miss,
and skips the final worker step when false. A dependency becoming healthy later
does not restart that step.

The approximately 184 seconds between embed process creation and RAG creation
closely matches the 180-second embed readiness deadline plus probe overhead.
Together with exit 1 and absent conversation logs, this strongly suggests that
dependency readiness timed out before worker admission. However, launcher output
and scheduler events are unavailable, so the exact exit branch and reason for
slow readiness are NOT confirmed. Current HTTP 200 does not establish cold-start
success. No claim is made about model download, resource pressure or a crash.

## Why the issue escaped detection

1. The change added mode pinning for future task installations but left an older
   installed task calling the script without a mode. Code and persistent OS
   configuration were not reconciled at the same lifecycle boundary.
2. The Edge flow before reboot could remain alive independently of the updated
   launcher. Restarting the machine exercises a different path from leaving an
   existing process running. The exact time the earlier listener stopped is unknown.
3. Tailscale automatically returns after boot; a live tunnel is not backend
   readiness. Zuri Server `/api/health` also does not check this separate Edge path.
4. The logon task has no recovery policy and no persistent launcher decision log.
   This makes an incomplete start persistent and prevents exact branch reconstruction.
5. The tracked Edge test inventory was enumerated and searched; no reference to
   `start-edge-stack` or `TransportOwner` was found in those tests. Existing worker
   policy tests do not establish compatibility of an older registered OS task.
6. [ADR-061](../../docs/decisions/ADR-061-SERVER-LINE-AND-OPTIONAL-EDGE.md)
   explicitly separates code implementation from transport activation, but the
   installed startup invocation and the remaining ingress route are not aligned.

## Proposed prevention and recovery — not executed

### First establish the active transport owner

- Read the actual LINE Developers webhook and redelivery setting for the verified
  OA/channel and match it to the Server account. Inspect Server worker/process and
  admission/delivery state before changing ownership.
- A Server account is already enabled in the aggregate snapshot. Do not blindly
  start LEGACY_EDGE against possibly shared credentials. Review the account's
  versioned pause/handoff, in-flight and UNKNOWN preconditions under ADR-061.
- Preserve the separate Funnel routes for 5173 and 8080 while auditing LINE. Their
  presence is not proof of exposing the Edge admin surface on 8787.

### Restore one verified path

- If the verified OA remains on legacy transport, recovery requires an explicit
  LEGACY_EDGE startup/task configuration and proof that Server will not concurrently
  send for that OA. Validate dependency readiness first.
- If Server ownership is the intended active state, prove secret resolution,
  migration, durable admission, worker and delivery readiness, then complete the
  provider webhook handoff through the documented versioned operation.
- The canonical new webhook is account-specific under ADR-061. Merely changing
  the hostname on `/webhook/line` is not a valid Server cutover.

### Prevent recurrence

- Pin the installed task's transport mode explicitly and verify it against the
  approved provider route/account ownership; never infer migration from a default.
- Persist sanitized launcher phase, timestamp, deadline and exit-reason records.
- Define bounded restart/reconciliation behavior for failed dependency starts;
  do not silently widen readiness checks, extend every timeout, or start duplicate
  RAG processes that contend for the store lock.
- Add an installed-task upgrade regression and a delayed-dependency startup test.
  Include reboot/logon acceptance on the actual host, independently of unit tests.
- Monitor the LINE route/backend and durable worker in addition to web health.
  Distinguish tunnel uptime, HTTP acceptance and real LINE delivery evidence.

### Acceptance and rollback evidence

One owner per OA; explicit startup mode; correct provider URL; authenticated empty-
events webhook verification; durable inbound/job admission; worker claim; provider
acceptance and CRM reconciliation; no duplicate sends; successful recovery after
the configured startup trigger. Provider verification uses JSON with an empty
events array, not an empty HTTP body. A real message canary needs an authorized
test recipient and must not replay old production jobs.

Rollback must retain job/audit evidence, fence new work, settle external in-flight
calls and reconcile UNKNOWN through the governed owner action before switching
back. Restarting legacy processing is not an unconditional rollback command.

## Validation and limits

- Completed: source/history comparison, installed task inventory, process and
  listener inventory, health probes, log metadata/redacted summaries and aggregate
  read-only database query. No runtime changed.
- Exact dependency timeout reason, first downtime, lost-event count and actual
  LINE provider configuration remain unverified.
- Application tests/build are not rerun for this documentation-only investigation.
  Documentation governance result is reported with the handoff. The 2026-09-17
  closure changes only this RCA relative to current main; it performs no runtime
  repair, provider operation, replay, or deployment.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
| --- | --- | --- | --- | --- | --- |
| 0.2.0b | 2026-09-17 | superseded | Reconciled with the merged incident/recovery RCA; preserved all five original dirty files in 7fc2e4dd and separated historical findings from current runtime claims | base c07cfaba; preservation 7fc2e4dd | RWANG |
| 0.1.0b | 2026-09-08 | under review | New RCA: missing upstream, installed-task transport drift and startup recovery/diagnostic gaps | base b17e7258 | RWANG |

Version diff: 0.1.0b → 0.2.0b; under review → superseded by the later incident/recovery RCA; original evidence retained, closure and provenance added; no implementation or deployment change.
