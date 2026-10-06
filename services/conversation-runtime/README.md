# Conversation Runtime

Independent Node process for Conversation Runtime orchestration. It does not import
Next.js, Prisma, Edge, or another repository. Shared authority and side effects are
accessed through the private `conversation-runtime.v1` core contract.

Canonical [service boundary](../../docs/services/conversation-runtime/SERVICE.md)
and [testing guide](../../docs/services/conversation-runtime/TESTING.md) explain
ownership, consumers and evidence limits. `verification.json` participates only in
the [shadow pilot](../../docs/architecture/VERIFICATION-POLICY.md); it does not
authorize CI omissions.

## Local commands

Run from this directory:

```powershell
npm test
npm run build
npm start
```

The process exposes `GET /healthz` for liveness and `GET /readyz` for configuration
readiness. It needs `CONVERSATION_RUNTIME_CORE_URL` and
`CONVERSATION_RUNTIME_TOKEN` to run. A missing core route or unreachable core stops
claiming and is reported as unavailable; the service never falls back to the Next
worker endpoint.

Memory-sync opt-in turns use the core `memory` operation (`read`, `append`,
`receipt`). The service never talks to MSP: Core reads the thread context, records
the MSP injection receipt states around the model call, and appends the answer under
the job's stable `${jobId}:memory-*` identities, so a reclaimed process replays
receipts instead of repeating them.

The model credential comes from a claim-bound core operation and stays in memory
only. Do not add provider keys or channel credentials to this service's environment,
logs, image or trace. Production cutover remains a separately gated operation.
