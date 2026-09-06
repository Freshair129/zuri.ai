---
id: "ZURI-COMMAND-AGENT-SPEC"
version: "0.1.1b"
status: "candidate"
owner: "zuri-command-agent"
upstream_feature: "FEAT36-ZURI-COMMAND-AGENT"
upstream_contract: "zuri-command-agent-api-v1@0.1.0b"
created_at: "2026-08-10T16:00:00+07:00, ATHER"
last_update: "2026-08-31T00:00:00+07:00, Claude"
---

# Zuri Command Agent — Implementation Specification

> This document remains the detailed source of record for the CLI surface, components, and
> acceptance criteria. [`PRD-SDD-v1.0.md`](PRD-SDD-v1.0.md) synthesizes it into the 3-Layer +
> Appendix format with requirement IDs; update this file first on any change, then mirror into
> the PRD/SDD and [Appendix D](appendices/D-traceability.md).

## 1. Outcome

Build a standalone, local **TypeScript CLI + bridge worker** that lets Codex, Claude Code, and
Antigravity request evidence-backed Zuri cards through one command interface. It reads approved
SmartGift DuckDB queries locally and submits structured evidence to Zuri. Zuri remains the sole
authority for tenant/RBAC, command state, policy, Flex validation, and LINE OA delivery.

The CLI does **not** call the LINE Messaging API. `send` creates a governed Zuri command with a
delivery intent. If the approved group policy allows automatic delivery, Zuri's outbox sends the
card without another human click. Otherwise Zuri retains a preview/review state.

## 2. Scope and non-goals

### Version 1 scope

- Local CLI usable from Codex, Claude Code, and Antigravity shell sessions.
- Read-only local DuckDB bridge with a versioned query registry.
- Typed evidence packet and Flex `CardViewModel` for four card families.
- Command submission, job lease/claim, evidence submission, health/heartbeat, JSON output, and
  safe error handling.
- Preview first; delivery intent is contract-ready but remains runtime-gated.

### Non-goals

- Direct LINE API, direct Zuri PostgreSQL, raw group history, arbitrary SQL/shell, CRM/Calendar
  writes, model/provider routing, TTS, scheduling, or automatic policy changes.
- Replacing Zuri webhook, outbox, session/RBAC, CR-003 consent/erasure, CR-004 OA onboarding, or
  GoVibe governance.

The only approved beta exception is `LINE-DM-FAST-POC-SPEC.md`: one signed direct-message event
may receive a fixed acknowledgement through its reply token. It does not create a user profile,
store DM history, query DuckDB, call a model, or establish a production delivery path.

## 3. Design decision — build a CLI first

**Decision:** Build a Node.js 22+ TypeScript CLI (`zuri-agent`) first, with a long-running
`worker` subcommand for the local bridge.

| Option | Decision | Rationale |
|---|---|---|
| Native integration for each coding agent | Not in v1 | Three independent integration/credential surfaces create drift |
| Shared CLI with JSON output | Chosen | Every coding agent can run it, capture its result, and share one contract |
| Desktop GUI first | Deferred | Visual Office is the Zuri control plane; a GUI is not needed to validate the bridge |

The CLI uses `stdout` for machine-readable JSON and `stderr` for concise human diagnostics.
It never prints token values, raw PII, raw SQL, or a hidden group ID.

## 4. CLI surface

| Command | Purpose | Side effect |
|---|---|---|
| `zuri-agent config check` | Validate local config presence and readable DuckDB in read-only mode | None |
| `zuri-agent health` | Report bridge registration/contract compatibility and last heartbeat | None |
| `zuri-agent preview <template>` | Create a Zuri `preview` command and print its command id/status | Zuri command record only |
| `zuri-agent send <template> --group <alias>` | Create a governed `line_push` command using a server-resolved group alias | Zuri command record; delivery only if policy admits it |
| `zuri-agent status <command-id>` | Read a redacted command lifecycle/result | None |
| `zuri-agent worker` | Poll/claim compatible jobs, query DuckDB, submit evidence, heartbeat | Zuri lease/evidence calls only |

Supported `<template>` values in v1:

```text
executive-summary
channel-performance
campaign-breakdown
actions-approval-queue
```

Example intended operator flow:

```powershell
zuri-agent preview executive-summary --period yesterday --json
zuri-agent send actions-approval-queue --group leadership --json
zuri-agent status cmd_01H... --json
```

`leadership` is an owner-configured alias resolved by Zuri. The CLI must never accept a raw LINE
group ID as an authority field.

## 5. Components

```text
src/
  cli/                 # command parsing, stdout/stderr, exit codes
  zuri-api/            # typed client for the canonical Zuri contract
  bridge/               # heartbeat, lease claim, retry/release
  queries/              # registry ids, parameter schemas, read-only DuckDB execution
  evidence/             # normalized aggregate facts + source/as_of/sensitivity
  cards/                # four CardViewModel builders; no raw Flex JSON delivery
  config/               # env loading, OS/Docker secret reference adapter
  safety/               # redaction, validation, error mapping
tests/
  unit/
  contract/
  fixtures/
```

## 6. State and data contract

### Durable state — Zuri PostgreSQL

`Command`, `Run`, `Lease`, `PolicySnapshot`, `EvidencePacket` metadata, `AuditEvent`, and
`DeliveryOutbox` are owned by Zuri. The CLI receives only the data scoped to its registered
device and current lease.

### Local state

The agent keeps only an encrypted device credential/reference and bounded transient cache. Its
cache can be deleted at any time. Lease expiry causes Zuri to requeue work, preventing a bridge
crash from losing a command or duplicating delivery.

### DuckDB query registry

Each query has a fixed id/version, allowed parameter schema, column allow-list, row cap,
sensitivity classification, and output schema. The worker opens DuckDB read-only. It rejects SQL
text, unknown query ids, unbounded periods, and a result outside its expected schema.

## 7. Configuration and credentials

`.env` is permitted only for local development and is Git-ignored. The tracked
`.env.example` contains names only:

```text
ZURI_COMMAND_API_BASE_URL
ZURI_AGENT_DEVICE_ID
ZURI_AGENT_DEVICE_TOKEN
SMARTGIFT_DUCKDB_PATH
BRIDGE_POLL_INTERVAL_SECONDS
BRIDGE_MAX_CONCURRENT_JOBS
```

For long-running Docker use, device credentials are loaded via Docker secret or Windows
Credential Manager. Do not use a plaintext `.credential.json`. LINE access tokens/secrets stay
encrypted in Zuri's tenant integration store; verified LINE group bindings stay in Zuri
PostgreSQL.

## 8. Requirements and acceptance criteria

1. WHEN an operator runs `config check`, THEN the CLI SHALL return a non-zero exit with a
   redacted diagnostic if config, device identity, contract version, or read-only DuckDB access
   is invalid.
2. WHEN an operator runs `preview`, THEN the CLI SHALL create one idempotent preview command and
   SHALL not call the LINE Messaging API.
3. WHEN an authorized operator runs `send ... --group <alias>`, THEN the CLI SHALL request a
   governed delivery intent; Zuri SHALL decide send versus review from its policy snapshot.
4. WHEN a bridge claims a job, THEN it SHALL accept only a matching lease, tenant, contract,
   query version, and expiry.
5. WHEN a query returns evidence, THEN the bridge SHALL include source, `as_of`, query version,
   sensitivity, and a typed CardViewModel; it SHALL not submit raw SQL or unbounded rows.
6. IF Zuri rejects an evidence packet or the bridge is offline, THEN the CLI SHALL return a clear
   unavailable/failed state and SHALL not retry delivery indefinitely.
7. WHEN a command completes, THEN `status` SHALL show command state and trace ids without
   credentials, hidden group IDs, raw transcript, or PII.
8. WHEN automatic delivery is not admitted, THEN no LINE message SHALL be sent and the command
   SHALL remain preview/review-only.

## 9. Build order

*Checkboxes corrected 2026-08-31 to match `git log` and [Appendix D](appendices/D-traceability.md)
— this file is the stated source of truth for this table (see the note at the top of this
document), and it had never been updated to reflect S1–S5 landing.*

- [x] **S1 — Repository foundation:** initialize Git, Node/TypeScript tooling, `.env.example`,
  config parser, JSON/error conventions, and unit-test runner.
- [x] **S2 — Contract client:** typed request/response models and mocked Zuri API contract tests.
- [x] **S3 — DuckDB safety slice:** read-only opener, query registry, schema/parameter/row-cap
  validator, and fixture-driven evidence tests.
- [x] **S4 — Card slice:** four CardViewModel builders and Zuri contract-validation fixtures.
- [x] **S5 — CLI preview/status:** implement `config check`, `health`, `preview`, and `status`
  (against `MockZuriApiClient`, per ADR-005 — not yet the real HTTP client S2 anticipates).
- [ ] **S6 — Worker:** heartbeat, leased claim, evidence submission, retry/release, crash recovery.
- [ ] **S7 — Governed delivery intent:** implement `send` contract client only after Zuri Phase 2
  and G0/CR-003/CR-004 gates are verified.
- [ ] **S8 — Operational verification:** redacted end-to-end preview, offline bridge, cross-tenant,
  stale lease, invalid template, and no-direct-LINE tests.

**S6–S8 status:** unstarted, not merely unchecked — no work against them began after 2026-08-11,
and none is currently scheduled; development effort went instead into two generations this spec
does not cover (see [PRD-SDD-v1.0.md §2.8](PRD-SDD-v1.0.md) and
[Appendix D §D.9](appendices/D-traceability.md#d9-generations-this-prd-does-not-describe)). Whether
to build them as scoped, rescope them now that a Zuri V2 stack transport exists as an alternative
delivery path, or formally deprioritize them is an open scheduling decision, not resolved here.

## 10. Entry gates

- The Zuri Phase 2 atomic proposals and Phase 3 blueprint must be accepted before code that calls
  the new Zuri API is implemented.
- G0, CR-003, and CR-004 must be deployed and verified before any real LINE delivery is enabled.
- A Zuri owner must register the bridge device, approved group aliases, query/template versions,
  and automatic-delivery policy.

## 11. References

- `../AGENTS.md`
- `AGENT-RUNTIME-SPEC.md`
- `G:\zuri\gks\phase1_docs\FEAT36-ZURI-COMMAND-AGENT.md`
- `G:\zuri\docs\contracts\zuri-command-agent-api-v1.md`
