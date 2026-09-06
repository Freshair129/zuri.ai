# Appendix A — API Spec

| Field | Value |
|-------|-------|
| **Version** | 1.0.0 |
| **Status** | Draft |
| **Author** | Boss |
| **Created** | 2026-08-10 |
| **Last Updated** | 2026-08-10 |
| **Approved By** | — |

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-08-10 | Boss | Initial creation via RWANG doc-architect |
| 1.1.0 | 2026-08-10 | Boss | `preview`/`send`/`status` wired to `MockZuriApiClient` (§A.3); documents the local-persistence design decision (ADR-005) |

Parent: [`../PRD-SDD-v1.0.md`](../PRD-SDD-v1.0.md) §2.3. Canonical upstream contract:
`zuri-command-agent-api-v1@0.1.0b` (`G:\zuri\docs\contracts\zuri-command-agent-api-v1.md`) — this
file documents this repo's *consumption* of that contract, and does not redefine it.

## A.1 CLI surface

| Command | Purpose | Side effect | Req. ID |
|---|---|---|---|
| `zuri-agent config check` | Validate local config presence and readable DuckDB in read-only mode | None | FR-001 |
| `zuri-agent health` | Report bridge registration/contract compatibility and last heartbeat | None | FR-002 |
| `zuri-agent preview <template>` | Create a Zuri `preview` command and print its command id/status | Zuri command record only | FR-003 |
| `zuri-agent send <template> --group <alias>` | Create a governed `line_push` command using a server-resolved group alias | Zuri command record; delivery only if policy admits it | FR-004 |
| `zuri-agent status <command-id>` | Read a redacted command lifecycle/result | None | FR-005 |
| `zuri-agent worker` | Poll/claim compatible jobs, query DuckDB, submit evidence, heartbeat | Zuri lease/evidence calls only | FR-006 |

Supported `<template>` values: `executive-summary`, `channel-performance`, `campaign-breakdown`,
`actions-approval-queue` (FR-007). `<alias>` is an owner-configured, server-resolved group alias —
raw LINE group IDs are never accepted as an authority field (FR-008).

```powershell
zuri-agent preview executive-summary --period yesterday --json
zuri-agent send actions-approval-queue --group leadership --json
zuri-agent status cmd_01H... --json
```

## A.2 Zuri contract client types (`src/zuri-api/types.ts`)

| Type | Purpose |
|---|---|
| `ContractVersion` | Pinned to `'0.1.0b'`; a mismatch fails closed |
| `CommandSource` | `codex \| claude_code \| antigravity \| line` |
| `DeliveryIntent` | `preview \| line_reply \| line_push` |
| `CommandLifecycle` | `ADMITTED → QUEUED → CLAIMED → EVIDENCE_READY → REVIEW_REQUIRED \| DELIVERY_PENDING → DELIVERED \| FAILED \| CANCELLED \| EXPIRED` |
| `SensitivityClass` | `PUBLIC \| INTERNAL \| CONFIDENTIAL \| RESTRICTED` |
| `OperationalState` | `live \| snapshot \| candidate \| unavailable` |
| `CommandEnvelope` | Outbound request shape: contract version, source, tenant/group refs, command, arguments, delivery intent, idempotency key |
| `CommandJob` | Inbound leased-job shape: adds `commandId`, `policySnapshotId`, `lifecycle`, `traceId`, timestamps |
| `Lease` | `leaseId`, `commandId`, `tenantId`, `deviceId`, `expiresAt`, `queryId`, `queryVersion` |
| `CardCtaAction` | `{ label, uri, type: 'uri' }` — see [Appendix E](E-risk-matrix.md) for the CTA domain allow-list |
| `CardViewModel` | `templateId`, `templateVersion`, `title`, `subtitle?`, `operationalState`, `sourceLabel`, `asOf`, `kpis?`, … |

## A.3 Endpoints consumed

`src/zuri-api/client.ts` defines the `IZuriApiClient` interface (`admitCommand`, `claimJob`,
`submitEvidence`, `releaseJob`, `sendHeartbeat`, `getCommandStatus`) and a `MockZuriApiClient` that
implements it in-memory, with **optional local-file persistence** (see ADR-005 in
[`../ARCHITECTURE.md`](../ARCHITECTURE.md)). **No real HTTP implementation of `IZuriApiClient`
exists yet.**

`src/cli/index.ts` now wires `preview`, `send`, and `status` to a shared `MockZuriApiClient`
instance (via `src/cli/commands.ts`: `runPreview`, `runSend`, `runStatus`), persisted to
`defaultMockStatePath()` (an OS temp-dir file, not tracked in Git) so that `preview` in one CLI
invocation and `status` in the next see the same command — this is a local development stand-in,
**not** a real network call to Zuri and **not** a real LINE delivery. `worker` remains unimplemented
(S6).

| Capability | Contract call | Status |
|---|---|---|
| `bridge.health` | reports registered contract/query/template versions and last successful poll | Reported locally (`health` command, no network call); interface exists via `sendHeartbeat` |
| `bridge.claim` | claims exactly one leased compatible job | `IZuriApiClient.claimJob` interface + mock exist; not wired to CLI/worker (pending S6) |
| `duckdb.execute` | runs one query registry entry with parameter/schema/row-cap check | Implemented (`src/queries/duckdb.ts`) |
| `evidence.submit` | posts a typed evidence packet to the Zuri contract endpoint | `IZuriApiClient.submitEvidence` interface + mock exist; not wired to CLI/worker (pending S6) |
| `preview.open` | opens a local/operator preview only; cannot call LINE | **Implemented** — `zuri-agent preview <template>` calls `admitCommand` via the local mock client |
| *(send intent)* | requests a `line_push` delivery intent | **Implemented against the mock only** — `zuri-agent send <template> --group <alias>` calls `admitCommand`; rejects a raw LINE group ID (FR-008), enforced by `src/safety/redact.ts` `isRawLineId`. No real Zuri policy evaluation or LINE delivery exists behind this yet — the S7 entry gate (Zuri Phase 2, G0/CR-003/CR-004) still applies before this can talk to the real contract endpoint. |
| *(status read)* | reads a command's lifecycle/result | **Implemented** — `zuri-agent status <command-id>` calls `getCommandStatus` via the local mock client |

## A.3.1 Current transport implementation (supersedes the mock-only status above)

`HttpZuriApiClient` is now selected by default for CLI `preview`, `send`, and `status`. It calls
the candidate contract's admit and status endpoints using the configured bridge credential,
contract-version header, and idempotency header; malformed, non-JSON, network, and non-2xx
responses fail closed. `MockZuriApiClient` is selected only by explicit
`ZURI_COMMAND_TRANSPORT=mock` for local contract tests.

The worker's claim/evidence/release methods remain blocked rather than guessing a poll endpoint:
the upstream candidate contract specifies command-id-scoped lease paths while the current bridge
interface is poll-shaped. This is an explicit API-shape blocker, not a fake implementation.

`poc verify` and `poc send information-request` are documented separately in
[`../POC-LINE-DELIVERY.md`](../POC-LINE-DELIVERY.md). They are a local-only, single-template
demonstration and do not alter the canonical Zuri contract.

## A.4 Error and output conventions

- `stdout`: machine-readable JSON only (`src/cli/output.ts`: `printJsonSuccess` / `printJsonError`).
- `stderr`: concise human diagnostics (`src/safety/redact.ts`: `logDiagnostic`).
- Never printed: token values, raw PII, raw SQL, hidden group IDs (NFR-001).
- `config check` failure returns non-zero exit with a redacted diagnostic (AC-001).
