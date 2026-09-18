# LINE Work stale facts and confirmation authority

Owner-approved P4 acceptance correction under LINE-OA-LOCAL-LLM-CIN-EXECUTION. C-3, HIGH authorization risk. Found during local implementation review; no production incident is claimed.

## Symptom

A model that skipped the operational read tool could return a remembered task status. Confirmation could continue using the authority and timestamp captured before awaited writer work even when a proposal, Membership or execution lease expired during that work.

## Evidence

`apps/edge/src/answer/llm.ts` previously rejected an unverified read only when `workReadAttempted` was true. An omitted read never entered that branch. `apps/server/src/modules/agent/line-project-work-tools.js` captured `at` once and resolved the viewer before target lookup, receipt acquisition and the canonical write.

New scripted-provider regression supplies old `DONE` history and a `DONE` fallback while the model omits search. New isolated SQLite regressions alter proposal time, Membership expiry/revocation, lease expiry or claim version/execution during the canonical create and assert no Work or execution receipt persists.

## Root Cause

The answer guard enforced the outcome of an attempted tool call rather than requiring current evidence for an operational claim. Confirmation treated request-start authorization as sufficient for a transaction containing asynchronous work.

## Why the issue escaped detection

Earlier cases invoked the read tool or revoked access before confirmation began. They did not model a skipped read, an unsafe caller fallback, or authority/clock changes during the canonical writer.

## Proposed prevention

Require current evidence for recognized Thai/English operational questions and status assertions; use a fixed unavailable answer if it is absent. Preserve generic product clarification. Re-resolve identity, ownership and claim inside the transaction after writer/audit work, verify fresh expiry, and roll back on any mismatch. Keep provider/SQLite tests distinct from actual local-model latency, hosted Postgres concurrency and live LINE proof.

## Local verification

2026-09-17: Edge Project/Work, model-port and answer suites passed 60/60; Server LINE Project/Work and FR-072 authorization suites passed 25/25. No production activation or LINE messages were sent by these tests.
