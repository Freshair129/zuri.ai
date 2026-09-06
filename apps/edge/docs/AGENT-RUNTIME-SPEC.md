---
id: "ZURI-AGENT-RUNTIME"
version: "0.5.0b"
status: "candidate"
owner: "zuri-command-agent"
upstream_contract: "zuri-command-agent-api-v1@0.1.0b"
created_at: "2026-08-10T15:20:00+07:00, ATHER"
last_update: "2026-09-06T11:51:02+07:00,RWANG"
---

# Zuri Command Agent Runtime Specification

> Current transport decision: [Server-owned LINE and optional Edge](SERVER-LINE-OPTIONAL-EDGE.md)
> implements upstream ADR-061. New runtimes are compute-only; the transport behavior below
> applies only to explicitly selected `LEGACY_EDGE` installations during migration.

## Candidate central monorepo and execution contract

The owner requested complete migration documentation on 2026-09-06. In the central Freshair129/zuri.ai documentation branch, ZAI:ADR-062 proposes apps/edge in the monorepo with a separately installed/released runtime; ZAI:ADR-061 and ZAI:FR-148-P4 define the optional executor behavior. These qualified citations refer to the central repository, not this repository's local ADR/FR registry. They do not grant production activation or retire this runtime's existing reply-owner rule.

Target: Edge claims compatible jobs over outbound HTTPS, executes only allowed local capabilities, and returns bounded evidence/results under a current Business-scoped lease. Server owns migrated-account LINE credentials, send intents and provider calls. Edge receives no LINE reply token or Server database access; local-only jobs never silently use cloud inference. Device upgrade compatibility is checked against released protocol ranges, not assumed from a common checkout.

Migration first preserves current behavior while moving source; transport cutover follows separately per account. Existing Stack/local sending paths below remain legacy until the central cutover gate pauses/fences them. Do not remove current device configuration, copy .env/customer files into Git, delete the old repo/workspace, or reinstall device data merely because the source is moving. Root global documentation becomes authoritative after reviewed ID/path mapping; old local requirement IDs keep repository-qualified provenance.


> This document remains the detailed source of record for runtime topology and lifecycle rules.
> [`PRD-SDD-v1.0.md`](PRD-SDD-v1.0.md) §2.1 cross-references it rather than duplicating it — update
> this file first on any change.

## Role

The agent runs locally (normally Docker on the SmartGift workstation). It claims compatible
commands from Zuri, executes only registered read-only DuckDB queries, and returns a typed,
evidence-labelled result. It never owns tenant policy, customer/group authority, Zuri database
credentials, or LINE credentials.

## Runtime components

```text
operator adapters (Codex / Claude Code / Antigravity)
  -> operator CLI -> Zuri Command API

local bridge
  -> bridge registration + heartbeat
  -> leased job client
  -> DuckDB query registry (read-only)
  -> evidence-packet builder
  -> Zuri Command API
```

## Local state rules

- Durable command/run/checkpoint/outbox state lives in Zuri PostgreSQL, not local files.
- Local state is limited to an encrypted device identity, bounded transient job cache, and
  diagnostics. It must be deletable without losing a command.
- A bridge crash is recovered by lease expiry and Zuri requeue; it must not replay delivery.
- DuckDB is opened read-only. The runtime accepts query IDs and validated parameters, never SQL
  text supplied by an operator, model, LINE event, or another agent.

## Adapter rules

All three adapters create the same versioned command envelope. An adapter may request a preview;
it may request `line_reply` or `line_push` delivery, but cannot bypass Zuri policy to cause it.
When the resolved policy snapshot allows automatic delivery for that group/template/capability,
Zuri validates the evidence and sends through its own outbox without a per-message human click.
Interactive Codex/Claude/Antigravity sessions are clients of the operator CLI and are never
exposed as an unattended public responder.

## Required local capabilities

- `bridge.health`: reports registered contract/query/template versions and last successful poll.
- `bridge.claim`: claims exactly one leased compatible job.
- `duckdb.execute`: runs one query registry entry with a parameter/schema/row-cap check.
- `evidence.submit`: posts a typed evidence packet to the Zuri contract endpoint.
- `preview.open`: opens a local/operator preview only; it cannot call LINE.

The bridge may submit delivery intent as part of a typed evidence result. It never receives a
LINE channel token or calls the LINE Messaging API; Zuri owns the final validation, outbox call,
idempotency, and receipt.

### Temporary local demonstration exception

`docs/POC-LINE-DELIVERY.md` defines one explicit beta exception: a local `line-poc` transport can
send only the bounded `information-request.v1` snapshot to one locally configured alias. It cannot
send KPI/customer/pricing/approval data and returns `ACCEPTED_BY_LINE`, never a fabricated
`DELIVERED` state. It is removed from operational use when the canonical Zuri outbox is live.

### Local conversation archive exception

The approved local-only archive in `LINE-HISTORY-ARCHIVE-SPEC.md` receives signed webhook events
for the `leadership` alias, appends normalized UTF-8 JSONL by ISO week, and retains each file for
30 days. It must not retrieve prior LINE history, expose raw group/sender IDs, or automatically
send archive text to a model.

### Direct-message fast POC exception

`LINE-DM-FAST-POC-SPEC.md` defines a separately approved beta exception for one private-chat
demonstration. A signed text event may receive a fixed acknowledgement through its transient LINE
`replyToken`. It creates no profile, no durable DM history, no model prompt, no DuckDB query, and
no action. The exception is controlled by `LINE_DM_POC_ENABLED=true` and must be removed in favour
of Zuri's governed inbound/outbox path before multi-user operation.

## GoVibe relationship

GoVibe creates the governed mission/CR/task and promotion evidence. The agent includes the
approved `policySnapshotId`, `queryVersion`, and `templateVersion` in every result. A local
runtime cannot promote any of them. If no valid snapshot is supplied, it rejects the job.

## Non-goals

- No direct PostgreSQL connection to Zuri.
- No LINE Messaging API access token, except the explicit local POC exceptions above.
- No arbitrary shell command execution through LINE or an adapter.
- No raw chat-history store, scheduler authority, model auto-fallback, or CRM/Calendar write.

Version diff 0.4.0b → 0.5.0b (2026-09-06, RWANG): documented central monorepo candidate and optional executor target; runtime behavior unchanged.
