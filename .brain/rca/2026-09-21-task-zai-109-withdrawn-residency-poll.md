# RCA - TASK-ZAI-109 Edge residency poll survives the retired server route

**Date:** 2026-09-21
**Scope:** `apps/edge/src/conversation/residency-client.ts`,
`apps/edge/src/answer/providers/model-residency-schedule.ts`,
`apps/edge/src/desktop-worker.ts`, TASK-ZAI-109 / FR-244

## Symptom

The current `origin/main` no longer serves `/api/edge/model-residency`, but an
Edge desktop worker with a local model configured still starts the FR-244
residency schedule and polls that path. The worker receives HTTP 404 and emits a
failed residency event on every poll interval.

This is stale compute-side behaviour after LINE OA execution moved to the
server. It is not evidence of a production LINE first-reply failure.

## Evidence

- Current audit base is `origin/main` at `259867faf4a3f41e91f3428c2bff3cfdda3d006d`.
- PR #500 merged as `cfb62da3d904b7344572ed038667c1a733cec06d` and removed the
  server route and residency service. `Test-Path` confirms neither exists on
  the current base.
- ADR-100 D2 says the model-residency route is withdrawn because its only
  consumer was the LINE executor, while extraction and pairing remain in scope.
- `apps/edge/src/conversation/residency-client.ts` still requests
  `/api/edge/model-residency` and `apps/edge/src/desktop-worker.ts` still starts
  the schedule when `llmEnabled`, `llmBaseUrl` and `llmModel` are present.
- Existing Edge tests cover a successful boolean response, generic HTTP/network
  failures and scheduler polling, but do not cover a withdrawn-route 404 as a
  terminal condition.
- PR #500 deliberately left `apps/edge` untouched; ADR-100 explicitly does not
  decide whether the Edge application or ADR-059 extraction should be retired.

## Root Cause

The server-side retirement changed the contract owner but did not add a
compatibility boundary for an older or still-present Edge residency client.
The scheduler treats every failed poll as retryable, so a permanently withdrawn
route remains a periodic request instead of becoming a terminal, locally handled
state.

## Why the issue escaped detection

The retirement PR validated the server route removal and intentionally left the
Edge tree unchanged. FR-244's earlier scheduler tests were written against the
old route contract and asserted only that failures were swallowed, not that a
withdrawn endpoint stops future polls. Hosted CI for the retirement therefore
could be green while this stale client path remained.

## Proposed prevention

Add a narrow terminal-error predicate to the Edge residency scheduler and pass a
404 predicate from the desktop worker. A withdrawn route then clears its timer
after the first failed poll, while network/5xx failures retain the existing
retry behaviour. Add a focused scheduler regression and a 404 client contract
case. This does not restore the route, alter LINE execution, apply the business
hours migration, or claim the production first-reply timing/owner-activation
criterion; those remain open production gates.
