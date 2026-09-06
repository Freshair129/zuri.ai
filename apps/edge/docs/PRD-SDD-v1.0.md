# Zuri Command Agent — PRD & SDD

## Candidate central monorepo and execution contract

The owner requested complete migration documentation on 2026-09-06. In the central Freshair129/zuri.ai documentation branch, ZAI:ADR-062 proposes apps/edge in the monorepo with a separately installed/released runtime; ZAI:ADR-061 and ZAI:FR-148-P4 define the optional executor behavior. These qualified citations refer to the central repository, not this repository's local ADR/FR registry. They do not grant production activation or retire this runtime's existing reply-owner rule.

Target: Edge claims compatible jobs over outbound HTTPS, executes only allowed local capabilities, and returns bounded evidence/results under a current Business-scoped lease. Server owns migrated-account LINE credentials, send intents and provider calls. Edge receives no LINE reply token or Server database access; local-only jobs never silently use cloud inference. Device upgrade compatibility is checked against released protocol ranges, not assumed from a common checkout.

Migration first preserves current behavior while moving source; transport cutover follows separately per account. Existing Stack/local sending paths below remain legacy until the central cutover gate pauses/fences them. Do not remove current device configuration, copy .env/customer files into Git, delete the old repo/workspace, or reinstall device data merely because the source is moving. Root global documentation becomes authoritative after reviewed ID/path mapping; old local requirement IDs keep repository-qualified provenance.


| Field | Value |
|-------|-------|
| **Version** | 1.2.0b |
| **Status** | Draft |
| **Author** | Boss |
| **Created** | 2026-08-10 |
| **Last Updated** | 2026-09-06 |
| **Approved By** | — |

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-08-10 | Boss | Initial creation via RWANG doc-architect; consolidates `AGENTS.md`, `docs/COMMAND-AGENT-SPEC.md`, and `docs/AGENT-RUNTIME-SPEC.md` into the 3-Layer + Appendix format |
| 1.1.0 | 2026-08-31 | Claude | Re-baselined after a system-design review found this document described only the original Command Agent CLI while two further generations (conversational answer, Zuri V2 stack transport) had shipped under their own specs since 2026-08-11. Added SDD-009…017 for the missing components (§2.2), clarified S6–S8 status as deferred rather than ambiguously "pending" (§2.8), and pointed to Appendix D §D.9 for the generations this PRD's own requirements (§1.4–1.7) still do not cover. No requirement, acceptance criterion, or scope statement in Layers 1–3 was changed |

## Referenced Standards

- IEEE 29148-2018 (Requirements Engineering)
- IEEE 1016-2009 (Software Design Description)

## Document authority

This file is the **entry point** for product and design intent. It synthesizes and cross-references
three living source documents, which remain the detailed record and are not deleted:

- [`../AGENTS.md`](../AGENTS.md) — persona, permission matrix, and stateful-runtime rules (source for Layer 1 §2–3 and Layer 2 §5)
- [`AGENT-RUNTIME-SPEC.md`](AGENT-RUNTIME-SPEC.md) — runtime component topology (source for Layer 2 §4)
- [`COMMAND-AGENT-SPEC.md`](COMMAND-AGENT-SPEC.md) — CLI surface, components, and acceptance criteria (source for Layer 1 §4 and Layer 2 §2–6)
- [`appendices/F-glossary.md`](appendices/F-glossary.md) — term definitions for Zuri/Flex/GoVibe/CardViewModel and related vocabulary used throughout

If this document and a source spec disagree, treat the more detailed source spec as authoritative
until the discrepancy is resolved and this document is updated — do not silently prefer one.
The canonical external boundary remains `G:\zuri\docs\contracts\zuri-command-agent-api-v1.md`;
this repository must not fork or alter that contract unilaterally.

---

# Layer 1 — Product Requirements (PRD)

## 1.1 Executive summary

Zuri Command Agent is a standalone, local TypeScript CLI + bridge worker that lets Codex, Claude
Code, and Antigravity request evidence-backed Zuri Flex cards through one command interface. It
reads approved SmartGift DuckDB queries locally and submits structured evidence to Zuri. **Zuri
remains the sole authority** for tenant/RBAC, command state, policy, Flex validation, and LINE OA
delivery — this repository is a governed consumer, not a replacement control plane.

**Product promise:** *Your steady partner. Always in your corner.*

## 1.2 Use cases

| Actor | Use case | Outcome |
|---|---|---|
| Operator (via Codex/Claude Code/Antigravity) | Preview a card before sending | `zuri-agent preview <template>` creates an idempotent preview command; no LINE call |
| Operator | Send a governed card to a group | `zuri-agent send <template> --group <alias>` creates a `line_push` delivery-intent command; Zuri decides send vs. review |
| Operator | Check delivery status | `zuri-agent status <command-id>` returns a redacted lifecycle/result |
| Local bridge (unattended) | Claim and execute a leased job | `zuri-agent worker` polls, claims, queries DuckDB, submits evidence, heartbeats |
| Operator / ops | Verify local readiness | `zuri-agent config check` / `zuri-agent health` report config, contract, and DuckDB read-only status |

## 1.3 Scope

**In scope (v1):** local CLI usable from three coding-agent shells; read-only DuckDB bridge with a
versioned query registry; typed evidence packet and `CardViewModel` for four card families; command
submission, job lease/claim, evidence submission, health/heartbeat, JSON output, safe error
handling; preview-first flow with delivery intent contract-ready but runtime-gated.

**Non-goals:** direct LINE API access, direct Zuri PostgreSQL access, raw group history, arbitrary
SQL/shell execution, CRM/Calendar writes, model/provider routing, TTS, scheduling, or automatic
policy changes. See `SDD-xxx` in [Appendix D](appendices/D-traceability.md) for the full non-goal
boundary. The separately approved `LINE-DM-FAST-POC-SPEC.md` is a temporary fixed-
acknowledgement exception; it does not broaden this production scope.
list mapped from `COMMAND-AGENT-SPEC.md` §2.

## 1.4 Functional requirements

| ID | Requirement | Source |
|---|---|---|
| FR-001 | `config check` validates local config, device identity, contract version, and read-only DuckDB access | COMMAND-AGENT-SPEC §4, §8.1 |
| FR-002 | `health` reports bridge registration/contract compatibility and last heartbeat | COMMAND-AGENT-SPEC §4 |
| FR-003 | `preview <template>` creates one idempotent preview command; never calls the LINE Messaging API | COMMAND-AGENT-SPEC §4, §8.2 |
| FR-004 | `send <template> --group <alias>` requests a governed delivery intent; Zuri decides send vs. review | COMMAND-AGENT-SPEC §4, §8.3 |
| FR-005 | `status <command-id>` returns redacted command lifecycle/result without credentials or PII | COMMAND-AGENT-SPEC §4, §8.7 |
| FR-006 | `worker` polls/claims compatible leased jobs, queries DuckDB, submits evidence, heartbeats | COMMAND-AGENT-SPEC §4, §8.4 |
| FR-007 | Four supported card templates: `executive-summary`, `channel-performance`, `campaign-breakdown`, `actions-approval-queue` | COMMAND-AGENT-SPEC §4; `src/cards/builders/` |
| FR-008 | Group targeting uses only an owner-configured, server-resolved alias — never a raw LINE group ID | COMMAND-AGENT-SPEC §4 |

## 1.5 Non-functional requirements

| ID | Requirement | Source |
|---|---|---|
| NFR-001 | CLI never prints token values, raw PII, raw SQL, or a hidden group ID | COMMAND-AGENT-SPEC §3 |
| NFR-002 | `stdout` carries machine-readable JSON; `stderr` carries concise human diagnostics | COMMAND-AGENT-SPEC §3 |
| NFR-003 | A bridge crash recovers via Zuri lease expiry/requeue without duplicate delivery | AGENT-RUNTIME-SPEC "Local state rules"; AGENTS.md "Stateful-runtime rules" |
| NFR-004 | Delivery does not retry indefinitely on rejection/offline bridge | COMMAND-AGENT-SPEC §8.6 |
| NFR-005 | Every result is traceable to command id, policy snapshot id, query version, template version, source, and `as_of` | AGENTS.md "Stateful-runtime rules" |

## 1.6 Business rules

| ID | Rule | Source |
|---|---|---|
| BR-001 | DuckDB is opened read-only; only registered query IDs with validated parameters are accepted — never operator/model/LINE-supplied SQL text | AGENT-RUNTIME-SPEC "Local state rules"; AGENTS.md permission matrix |
| BR-002 | Each registered query has a fixed id/version, allowed-column list, row cap, and sensitivity class (see [Appendix B](appendices/B-db-schema.md)) | COMMAND-AGENT-SPEC §6; `src/queries/registry.ts` |
| BR-003 | ~~The agent never receives a LINE channel token and never calls the LINE Messaging API directly~~ — **retired 2026-09-05**. It described a cloud send path zuri-ai never built and has decided not to build | `docs/LINE-REPLY-OWNERSHIP-DECISION.md` |
| BR-007 | *(renumbered 2026-09-05 out of the retired sub-letter scheme, where each rule was BR-003 plus a letter. A sub-lettered id is a strict prefix of its parent, which no unbounded parser can disambiguate; `rwang:validate-graph` refuses it as RWG-106.)* This runtime is the LINE reply owner (zuri-ai BR-011). Its channel token is set through the device's own settings page, which requires the operator key; the token is never committed, never logged, and the `_FILE` form is available where an operator prefers OS permissions to `.env` | `docs/LINE-REPLY-OWNERSHIP-DECISION.md`; AGENTS.md permission matrix |
| BR-009 | Every route that reads or changes this device's configuration, or that can send as the OA, requires the operator key. Only `/` (liveness) and `/webhook/line` (authenticated by LINE signature) are open | `src/history/admin-auth.ts`; `tests/unit/admin-auth.test.ts` |
| BR-008 | Every outbound reply must be reported to Zuri as a delivery receipt (FR-093) — the reply-turn lane, never the Studio job lane (ADR-060 D5; see the receipt-path table in the decision record). **Edge side implemented; blocked on a cloud binding.** The worker quotes the inbound row id and reports after a successful push; without `ZURI_STACK_*` configured nothing is forwarded, so no row id exists and the worker records that instead of guessing | `src/delivery/worker.ts`; `tests/unit/delivery.test.ts` |
| BR-010 | Every place a message leaves this runtime offers it to the local archive, and the archive records both halves of a conversation. A group conversation is filed under its owner-configured alias; a direct one under `_dm/<16 hex of the keyed sender hash>/`, which is derived rather than stored — a raw LINE id never reaches the disk on either side. A group id that is not allow-listed is refused rather than filed as if it were a person. Same weekly file and same keyed hashing, with retention on two clocks: group history for `LINE_HISTORY_RETENTION_DAYS` (30 by default) and a private conversation for `LINE_HISTORY_DM_RETENTION_DAYS` (7, or the group value when that is shorter). Every outbound record carries the inbound event id it answers | `src/history/archive.ts`; `src/history/webhook-server.ts`; `src/delivery/worker.ts` |
| BR-004 | `.env` is local-development-only and Git-ignored; `.env.example` documents variable names with blank values | COMMAND-AGENT-SPEC §7 |
| BR-005 | Response is sent once per idempotency key; no internal progress messages are posted to a LINE group | AGENTS.md "Command and response policy" |
| BR-006 | A local runtime cannot self-promote `policySnapshotId`, `queryVersion`, or `templateVersion`; a job without a valid snapshot is rejected | AGENT-RUNTIME-SPEC "GoVibe relationship" |

## 1.7 Acceptance criteria

Mirrors `COMMAND-AGENT-SPEC.md` §8 verbatim, given requirement IDs for traceability. See
[Appendix D](appendices/D-traceability.md) for the AC ↔ code mapping.

| ID | Criterion |
|---|---|
| AC-001 | WHEN an operator runs `config check`, THEN the CLI SHALL return a non-zero exit with a redacted diagnostic if config, device identity, contract version, or read-only DuckDB access is invalid |
| AC-002 | WHEN an operator runs `preview`, THEN the CLI SHALL create one idempotent preview command and SHALL not call the LINE Messaging API |
| AC-003 | WHEN an authorized operator runs `send ... --group <alias>`, THEN the CLI SHALL request a governed delivery intent; Zuri SHALL decide send versus review from its policy snapshot |
| AC-004 | WHEN a bridge claims a job, THEN it SHALL accept only a matching lease, tenant, contract, query version, and expiry |
| AC-005 | WHEN a query returns evidence, THEN the bridge SHALL include source, `as_of`, query version, sensitivity, and a typed `CardViewModel`; it SHALL not submit raw SQL or unbounded rows |
| AC-006 | IF Zuri rejects an evidence packet or the bridge is offline, THEN the CLI SHALL return a clear unavailable/failed state and SHALL not retry delivery indefinitely |
| AC-007 | WHEN a command completes, THEN `status` SHALL show command state and trace ids without credentials, hidden group IDs, raw transcript, or PII |
| AC-008 | WHEN automatic delivery is not admitted, THEN no LINE message SHALL be sent and the command SHALL remain preview/review-only |

---

# Layer 2 — Software Design Description (SDD)

## 2.1 Architecture overview

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

Full runtime rules and lifecycle (`ADMITTED → QUEUED → CLAIMED → EVIDENCE_READY →
REVIEW_REQUIRED|DELIVERY_PENDING → DELIVERED|FAILED|CANCELLED|EXPIRED`) are recorded in
[`AGENT-RUNTIME-SPEC.md`](AGENT-RUNTIME-SPEC.md) and `AGENTS.md` §"Stateful-runtime rules" — not
duplicated here to avoid drift.

## 2.2 Components (SDD-xxx)

| ID | Component | Path | Responsibility |
|---|---|---|---|
| SDD-001 | CLI entry | `src/cli/` | Command parsing, stdout/stderr, exit codes |
| SDD-002 | Zuri API client | `src/zuri-api/` | Typed request/response models for the canonical contract |
| SDD-003 | Bridge | `src/bridge/` *(planned S6)* | Heartbeat, lease claim, retry/release |
| SDD-004 | Query registry | `src/queries/` | Registry ids, parameter schemas, read-only DuckDB execution |
| SDD-005 | Evidence builder | `src/evidence/` | Normalized aggregate facts + source/`as_of`/sensitivity |
| SDD-006 | Card builders | `src/cards/` | Four `CardViewModel` builders; no raw Flex JSON delivery |
| SDD-007 | Config | `src/config/` | Env loading, Docker-secret (`${NAME}_FILE`) adapter — see `secret.ts`; an OS-credential-store adapter (Windows Credential Manager) is not yet built |
| SDD-008 | Safety | `src/safety/` | Redaction, validation, error mapping |

The nine components above are what this PRD's original 2026-08-10 scope covers. Development since
then added two further generations this document does not describe — see
[§D.9 of Appendix D](appendices/D-traceability.md#d9-generations-this-prd-does-not-describe) —
whose components are listed here for completeness, not because this PRD's requirements (§1.4–1.7)
cover them; they have their own feature specs instead:

| ID | Component | Path | Responsibility |
|---|---|---|---|
| SDD-009 | Identity register | `src/identity/` | Deny-by-default 1:1 chat register and role-based evidence scoping (`registry.ts`, `scope.ts`) |
| SDD-010 | Conversational answer | `src/answer/` | Three-layer answer stack (pattern/API/headless), short-lived memory, and the number check — `docs/CONVERSATIONAL-ANSWER-SPEC.md` |
| SDD-011 | Delivery outbox | `src/delivery/` | Durable push-delivery queue and worker; the CR-012-vocabulary state machine — `docs/CONVERSATIONAL-ANSWER-SPEC.md` "Delivery" |
| SDD-012 | LINE history/webhook | `src/history/` | Signed webhook transport, signed group archive, direct-message routing — `docs/LINE-HISTORY-ARCHIVE-SPEC.md` |
| SDD-013 | LINE POC transport | `src/line-poc/` | The bounded local demonstration transport — `docs/POC-LINE-DELIVERY.md` |
| SDD-014 | Pricing engine | `src/pricing/` | SmartGift quote calculation — `docs/PRICING-ENGINE-SPEC.md` |
| SDD-015 | Pricing MCP server | `src/mcp/` | Read-only MCP door the sandboxed headless answer layer calls |
| SDD-016 | Catalog store | `src/catalog/` | Extracted factory-catalog loader the pricing/answer layers read |
| SDD-017 | Zuri V2 stack transport | `src/stack/` | FR-050/052 binding-only forward/report client — `docs/LINE-STACK-ANSWER-PILOT-SPEC.md` |

## 2.3 API — see Appendix A

CLI surface and the Zuri contract client are detailed in
[Appendix A — API Spec](appendices/A-api-spec.md).

## 2.4 Data — see Appendix B

DuckDB query registry (query ids, parameters, column allow-lists, row caps, sensitivity) is
detailed in [Appendix B — DB Schema](appendices/B-db-schema.md).

## 2.5 Security requirements (SEC-xxx)

| ID | Requirement | Source |
|---|---|---|
| SEC-001 | Zuri PostgreSQL access is denied to this agent; use the canonical Zuri API only | AGENTS.md permission matrix |
| SEC-002 | Arbitrary SQL, shell, or filesystem command execution is denied; query registry and declared local diagnostics only | AGENTS.md permission matrix |
| SEC-003 | ~~Direct LINE Messaging API calls are denied; the agent never receives a channel token or secret~~ — **retired 2026-09-05**, with BR-003, which stated the same rule. This runtime is the reply owner: it holds the channel secret and token and calls the Messaging API itself (ADR-060 D5, `transportMode: EDGE`). What replaces it is BR-009, which gates every route that can send as the OA behind the operator key | `docs/LINE-REPLY-OWNERSHIP-DECISION.md`; `src/history/admin-auth.ts` |
| SEC-004 | Secrets, access tokens, raw credentials, and OTPs are redacted; never logged or repeated | AGENTS.md permission matrix |
| SEC-005 | Bridge device identity/token lives in local OS credential store or Docker secret — never a plaintext `.credential.json` | COMMAND-AGENT-SPEC §7 |
| SEC-006 | ~~LINE channel access token/secret stay in the Zuri tenant integration store, encrypted at rest~~ — **retired 2026-09-05**, for the reason that retired SEC-003. Under `transportMode: EDGE` the device is the credential holder; the Zuri Vault holds them only for `CLOUD` accounts. The edge-side control is SEC-005 (OS credential store, never a plaintext file) plus BR-009 | AGENTS.md "Credential topology"; ADR-060 D5 |

Full permission matrix and credential topology are detailed in
[Appendix E — Risk Matrix](appendices/E-risk-matrix.md).

## 2.6 Testing

| Layer | Location |
|---|---|
| Unit | `tests/unit/queries.test.ts`, `tests/unit/cards.test.ts` |
| Contract | `tests/contract/zuri-api.test.ts` |
| Fixtures | `tests/fixtures/cards.fixture.ts`, `tests/fixtures/duckdb.fixture.ts` |

Run via `npm test` (`node --import tsx --test ...`).

## 2.7 Deployment

Normally Docker on the SmartGift workstation (per `AGENT-RUNTIME-SPEC.md` "Role"). No CI/CD is
configured yet — flagged as a gap in the preflight check.

## 2.8 Build order (traceability to delivery phases)

Reproduced from `COMMAND-AGENT-SPEC.md` §9 for a single source of sequencing truth; update there,
this table follows:

| Phase | Summary |
|---|---|
| S1 | Repository foundation: Git, Node/TS tooling, `.env.example`, config parser, JSON/error conventions, unit-test runner |
| S2 | Contract client: typed request/response models and mocked Zuri API contract tests |
| S3 | DuckDB safety slice: read-only opener, query registry, schema/parameter/row-cap validator, fixture-driven evidence tests |
| S4 | Card slice: four `CardViewModel` builders and Zuri contract-validation fixtures |
| S5 | CLI preview/status: `config check`, `health`, `preview`, `status` |
| S6 | Worker: heartbeat, leased claim, evidence submission, retry/release, crash recovery |
| S7 | Governed delivery intent: `send` contract client, gated on Zuri Phase 2 and G0/CR-003/CR-004 |
| S8 | Operational verification: redacted end-to-end preview, offline bridge, cross-tenant, stale lease, invalid template, no-direct-LINE tests |

Per repo history, S1–S4 are implemented (commit `07407f5`). S5 (`config check`, `health`,
`preview`, `send`, `status`) is also implemented, against `MockZuriApiClient` rather than a real
Zuri endpoint — see ADR-005.

**Status of S6–S8, updated 2026-08-31:** not "pending" in the sense of being next up — no work
against them has started since this document's original date, and none is currently scheduled.
Development effort since 2026-08-11 went into two capabilities this PRD does not describe at all
(the local conversational-answer runtime and the FR-050/052 stack transport; see
[Appendix D §D.9](appendices/D-traceability.md#d9-generations-this-prd-does-not-describe)), not
into the worker/real-client/governed-send phases this table lists. Whether S6–S8 should still be
built as originally scoped, rescoped now that Zuri V2 exists as an alternative delivery path, or
formally deprioritized is an open scheduling decision for the owner — this note only makes the
current, actual state legible; it does not resolve that decision.

---

# Layer 3 — AI System

Not applicable as a first-class layer in v1: the runtime is deterministic (routing for admission,
query selection, validation, and delivery decisions). Per `AGENTS.md` §"Command and response
policy": *"An optional model may improve wording only from a bounded evidence packet."* No model
training, fine-tuning, or agent-autonomy logic exists in this repository. If a model integration is
added later that goes beyond wording assistance, promote this section to a full
`ai-system/` directory (agent architecture, model cards, ethics/governance) per the AI/ML template
and re-run `rwang:doc-architect` to re-score the fit.

Version diff 1.1.0 → 1.2.0b (2026-09-06, RWANG): documented central monorepo candidate and optional executor target; runtime behavior unchanged.
