---
doc_type: intake-note
title: TASK017 official FlowAccount MCP connector v1
status: approved
superseded_by: null
version: "0.1.2"
date: "2026-10-18"
complexity: C-4
risk: HIGH
---

# TASK-ZAI-017 — Official FlowAccount MCP connector v1

## Decision and authority

The current product direction is to consume FlowAccount's existing official
hosted MCP connector. Do not build the superseded REST Client Credentials pull
engine or a second MCP server. This bounded design and local implementation
scope are approved by the Sol root under the user's standing backlog-first
delivery delegation. This is an agent decision, not a claim that the user
authored this document.

Approval covers an additive reviewed requirement and isolated server-side
connector code tested only against a local protocol fixture. It does not grant
access to FlowAccount, authorize provider requests or OAuth login, supply
credentials, activate a provider, or authorize production/Supabase changes.
The MCP tool catalog and business data remain unavailable until a verified
provider contract and the separate required grants exist.

## Evidence and known limits

The official [FlowAccount connector guide](https://flowaccount.com/help-center/category/ai-connector-mcp/flowaccount-connector-in-claude)
publishes `https://mcp.flowaccount.com/mcp`, describes OAuth 2.0 and selection
of one authorized company, and says the connected company can be changed by
disconnecting and reconnecting. Public guidance does not establish the MCP
transport/version, OAuth metadata and client registration, scopes or token
lifecycle, tool identifiers/schemas, stable result identities, or pagination
semantics. Those facts must remain unknown until supported by an authorized
provider contract; no REST endpoint or third-party MCP implementation supplies
that evidence.

The existing Zuri integration platform provides trusted viewer/Business
resolution, connection lifecycle and an opaque `SecretStorePort`. It does not
currently provide an outbound FlowAccount MCP client, a FlowAccount-specific
MCP token secret kind, an approved FlowAccount tool manifest, or a verified
result mapper. Reuse those ports; add a separately typed secret kind rather
than reusing a credential kind with different semantics. Use the existing
FR-081 raw-evidence path only after a tool schema, company binding, lane and
stable external identity have an explicit reviewed mapping.

## Bounded v1 contract

1. The connector targets only the fixed HTTPS FlowAccount MCP endpoint. It
   rejects caller-supplied hosts, non-HTTPS URLs, redirects, and endpoint
   overrides. No REST Client Credentials, REST resource catalog, duplicate
   pagination/cursor engine, or separate MCP server is introduced.
2. Connection and request handling resolve the trusted viewer and Business
   server-side before reading a connection or resolving its secret. One selected
   FlowAccount company binds to exactly one Zuri Business. Client-supplied
   tenant, Business, connection, or company IDs never grant access. An unknown
   or mismatched company binding fails closed.
3. OAuth state is a short-lived, hashed, single-use capability bound to the
   initiating actor, tenant, and Business. The callback must prove the same
   authenticated actor and current Business ownership, validate tenant and
   Business bindings, and atomically consume unexpired state before any code
   exchange or credential storage. Mismatch, expiry, or replay fails closed
   and makes no provider request. Fixture tests cover actor/scope mismatch,
   expiry, replay, and concurrent callback consumption. Follow the existing
   Notion OAuth state pattern; do not copy Notion endpoint or token semantics.
4. OAuth and MCP transport behavior follow only provider metadata and a
   documented MCP protocol/version that have been verified for this endpoint.
   The implementation does not invent authorization URLs, scopes, client
   registration behavior, headers, or protocol-version fallback. Unsupported
   metadata or protocol is a typed unavailable result, not a guessed request.
5. OAuth access/refresh material, if the verified contract issues it, is held
   only through a distinct `FLOWACCOUNT_MCP_OAUTH_TOKEN` typed opaque
   `SecretStorePort` credential. It must not reuse `OAUTH_CLIENT` or
   `NOTION_OAUTH_TOKEN`; unsupported secret-store backends fail closed until
   their typed implementation is available. It never enters
   ordinary database fields, browser storage, URLs, responses, logs, telemetry,
   or audit payloads. Only safe connection state and an opaque reference are
   persisted or returned.
6. Capability discovery records a bounded, redacted manifest and schema digest.
   Discovery does not authorize execution. The initial read allow-list is
   empty; each callable tool requires an explicitly reviewed mapping of its
   exact provider tool identifier and schema digest. MCP annotations such as
   `readOnlyHint` are advisory and never grant Zuri authority.
7. The strict FR-081 envelope has no capability-provenance field, so do not
   overload `sourceUri`, `entityType`, `schemaVersion`, or payload content to
   carry it. Add an immutable Integration-owned provenance sidecar with a real
   FK to the ingested `RawExternalRecord`, storing only the reviewed capability
   identifier, provider-manifest and tool-schema digests, connection scope,
   and correlation reference. The additive requirement and migration must own
   this model and its generated projections. The raw record and provenance
   sidecar commit atomically in one database transaction; failure of either
   write acknowledges neither. An idempotent replay verifies both records and
   returns the matching pair; missing or mismatched provenance fails closed
   and is quarantined for reconciliation. A read is refused unless this
   complete pair can be committed; audit events link the same correlation
   without duplicating payload or secrets.
8. Unknown or unmapped tools, and every create, edit, delete, status, payment,
   attachment, or other mutating capability, are unreachable through Zuri even
   if the provider advertises them. Tool invocation remains disabled when no
   reviewed read mapping exists.
9. A mapped read is ingested only through the existing FR-081
   `zIngestionEnvelope` and `ingestRawExternalRecord` path, with trusted tenant,
   Business and connection scope, verified provider/lane/entity/schema, safe
   capability provenance, external identity, and payload hash. Unknown schema
   or unstable identity is refused rather than coerced into a guessed record.
   Results remain external evidence; no Accounting, CRM, Sales, or Inventory
   truth is asserted.
10. Before enabling any live tool read or persisting live provider payloads, a
    separate reviewed privacy and data-lifecycle acceptance must define the
    returned data categories and purpose, Business/tenant isolation, retention
    and deletion schedule, data-subject erasure mapping through raw and derived
    records, legal-hold behavior, and backup/export/restore treatment. Until
    that gate is accepted, only local fixtures may exercise the connector and
    live read execution remains disabled. Provider/tool access grants are a
    separate prerequisite; this document does not supply them.
11. Discovery, read, refusal, failure, and disconnect events have safe
    correlation-linked audit evidence. Logs and audit exclude OAuth material
    and raw provider financial/PII payloads. Retry is permitted only when the
    verified read contract proves it safe. Health is computed from current
    credential, company-binding, discovery/read, and disconnect evidence; no
    REST cursor or unverified completeness is displayed.
12. Isolated tests use a local fixture server to verify protocol framing,
   host/redirect refusal, bounded responses/timeouts, owner and company binding,
   OAuth state mismatch/replay/expiry and consume-once behavior, secret
   redaction, empty-by-default allow-list, mutation denial, FK-backed FR-081
   capability provenance, audit, and disconnect. They do not call FlowAccount.

## Additive identity and implementation order

Do not rewrite the pinned REST-first FR-125 row, its historical acceptance
criteria, or ADR-053 decision history. FR-288 is already issued by the
Task048 binary-parsing branch (`codex/roadmap/task048-binary-parsing-20261018`,
commit `875e77b4`) and is burned for this task even while its PR remains open.
At preparation on base `ffff6b04070e43aa5c02374d853b0565d0ba83c9`, a read-only
scan found no FR-289 declaration or reservation across 122 local Git refs and
113 registered worktrees. FR-289 is therefore the current candidate for the
additive MCP requirement, not a permanent reservation or issued identity. The
sanctioned record-migration writer must recheck the accepted base, all
branches/reservations, IDs, subjects, and hashes before issuance; if any changed
or conflicts, stop and reassess instead of reusing an ID. Never hand-edit the
ledger, canonical index, or generated exports.

Implementation follows the issued requirement and uses local fixtures only.
Provider OAuth, protocol, selected-company identity, tool schemas, mappings,
the FK-backed provenance sidecar, privacy/data-lifecycle acceptance, live
reads, and production acceptance stay separate open gates. Task017 and its
roadmap dependency wave must not be marked done from a design, local fixture,
or partial connector implementation.

## Version diff

0.0 → 0.1.0: approves an additive official-MCP connector contract and bounded
local implementation path while preserving REST-first FR-125 history and
leaving provider access and live acceptance open.
0.1.0 → 0.1.1: adds atomic actor/tenant/Business-bound OAuth state, a distinct
FlowAccount token kind, FK-backed capability provenance, and a privacy and
data-lifecycle gate before live reads.
0.1.1 → 0.1.2: records that FR-288 is already issued on the Task048 branch and
pins FR-289 only as a collision-scan candidate pending the writer's exact-base
recheck.
