# RCA — TASK-ZAI-001 live memory canary stops before MSP context commit

## Symptom

A signed synthetic LINE webhook is captured and admitted with
`memorySyncOptIn=true`, but the server worker ends the job as `EXECUTION_FAILED`
before it records `CONTEXT_COMMITTED` or an MSP injection receipt.

## Evidence

- The native signed webhook returned HTTP 200 and captured one event.
- The admitted job persisted `memorySyncOptIn=true`.
- The authenticated worker endpoint returned HTTP 200, but the job traces were
  limited to `TURN_RECEIVED`, `EXECUTION_STARTED` and `EXECUTION_FAILED`.
- Read-only inventory for the target Tenant/Business found no active primary
  `MODEL_PROVIDER` connection and no active primary `PHASE1_LINE_LLM`
  connection.
- The configured private-runtime `/v1/models` endpoint returned HTTP 502 from
  both the web container and the host network.
- The dedicated LINE runtime role now passes an atomic alter-and-login check;
  this is a separate database-boundary proof and does not prove model readiness.

## Root Cause

The live Business has no usable model-provider configuration. Production model
resolution correctly fails closed before the MSP context and injection stages;
the configured private runtime is also unavailable, so a PRP key/model cannot
be validated or provisioned through the approved path.

## Why the issue escaped detection

Repository and direct MSP contract tests prove transport, authorization and
memory boundaries, but they do not provision a live Business model provider or
prove the private runtime's availability. The earlier canary stopped at the
database-role credential, so model resolution was not reached until that
credential was repaired.

## Proposed prevention

Make model-provider readiness a preflight gate before enabling a live memory
canary: require exactly one active primary Business model connection, validate
the selected provider/model against the configured runtime, and require a
sanitized `ANSWER_READY` plus `CONTEXT_COMMITTED` receipt before changing the
roadmap status. Keep production Ollama fallback disabled and do not create a
connection with an unvalidated or placeholder key.
