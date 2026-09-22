# RCA — TASK-ZAI-001 MSP workspace binding

## Symptom

The live MSP thread-memory acceptance could resolve and append through direct
signed calls, but the server LINE runtime did not provide the workspace binding
needed by the production MSP grant path.

## Evidence

- `apps/server/src/modules/line-oa-studio/application/server-line-runtime.js`
  created the thread-memory port with an actor and service key but omitted the
  configured `agentId` and `workspaceId`.
- The direct pinned-MSP probe succeeded when the synthetic canary workspace was
  supplied, including resolve, human append and context retrieval.
- A forged agent/principal context was denied with the typed
  `thread_scope_denied` result, so the remaining failure was not accepted as a
  reason to weaken the MSP scope guard.
- The repair passes `ZURI_MSP_THREAD_AGENT_ID` and
  `ZURI_MSP_THREAD_WORKSPACE_ID` into the port and has a focused runtime wiring
  regression test.

## Root Cause

The production composition boundary forwarded the MSP transport and actor but
not the grant principal's agent/workspace identity. Unit-level port tests did
not exercise the complete server-line-runtime composition, so a valid direct
MSP contract was not enough to prove the application path.

## Why the issue escaped detection

The existing tests constructed the memory port directly and the earlier live
canaries exercised Project/Work tooling without a successful memory-context
receipt. The application composition was therefore not tested with the
production identity fields enabled.

## Proposed prevention

Keep agent and workspace identity explicit at the application-to-MSP boundary,
test the composition rather than only the port, and require a live receipt
showing the resolved workspace before treating memory activation as accepted.
