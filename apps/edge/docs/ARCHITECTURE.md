# Architecture Decision Records — Zuri Command Agent

> Current transport decision: [Server-owned LINE and optional Edge](SERVER-LINE-OPTIONAL-EDGE.md)
> implements upstream ADR-061. New runtimes are compute-only; the transport behavior below
> applies only to explicitly selected `LEGACY_EDGE` installations during migration.

## Candidate central monorepo and execution contract

The owner requested complete migration documentation on 2026-09-06. In the central Freshair129/zuri.ai documentation branch, ZAI:ADR-062 proposes apps/edge in the monorepo with a separately installed/released runtime; ZAI:ADR-061 and ZAI:FR-148-P4 define the optional executor behavior. These qualified citations refer to the central repository, not this repository's local ADR/FR registry. They do not grant production activation or retire this runtime's existing reply-owner rule.

Target: Edge claims compatible jobs over outbound HTTPS, executes only allowed local capabilities, and returns bounded evidence/results under a current Business-scoped lease. Server owns migrated-account LINE credentials, send intents and provider calls. Edge receives no LINE reply token or Server database access; local-only jobs never silently use cloud inference. Device upgrade compatibility is checked against released protocol ranges, not assumed from a common checkout.

Migration first preserves current behavior while moving source; transport cutover follows separately per account. Existing Stack/local sending paths below remain legacy until the central cutover gate pauses/fences them. Do not remove current device configuration, copy .env/customer files into Git, delete the old repo/workspace, or reinstall device data merely because the source is moving. Root global documentation becomes authoritative after reviewed ID/path mapping; old local requirement IDs keep repository-qualified provenance.


| Field | Value |
|-------|-------|
| **Version** | 1.3.0b |
| **Status** | Draft |
| **Author** | Boss |
| **Created** | 2026-08-10 |
| **Last Updated** | 2026-09-06 |
| **Approved By** | — |

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-08-10 | Boss | Initial creation via RWANG doc-architect; extracts the decision already recorded in `docs/COMMAND-AGENT-SPEC.md` §3 into ADR form |
| 1.1.0 | 2026-08-10 | Boss | Added ADR-005 (local mock-client persistence) |
| 1.1.1 | 2026-08-23 | (unrecorded) | ADR-006 (GenesisBlock catalog graph v4) was added to the body without a matching entry here — backfilled 2026-08-31 for an accurate version table, not rewritten |
| 1.2.0 | 2026-08-31 | Claude | Added ADR-007…010, lifting decisions already made and shipped since 2026-08-11 (the CR-012 outbox adoption, the three-layer answer stack, deny-by-default identity, and the FR-052 binding-only transport) into this log, closing the gap a system-design review found between this document and `git log`. Numbered from 007 because ADR-006 (above) already claimed that slot |

## Referenced Standards

- IEEE 29148-2018 (Requirements Engineering)
- IEEE 1016-2009 (Software Design Description)

Parent: [`PRD-SDD-v1.0.md`](PRD-SDD-v1.0.md). New architecturally significant decisions should be
appended here as a new ADR rather than edited into an existing one — keep the history append-only.

---

## ADR-001: Build a shared CLI first, not per-agent native integrations

**Status:** Accepted (2026-08-10)

**Context:** Three coding-agent surfaces (Codex, Claude Code, Antigravity) need to request
evidence-backed Zuri cards. Each could get a native integration, or all three could share one
interface.

**Decision:** Build a Node.js 22+ TypeScript CLI (`zuri-agent`) first, with a `worker` subcommand
for the long-running local bridge. `stdout` carries machine-readable JSON; `stderr` carries concise
human diagnostics.

**Alternatives considered:**

| Option | Rejected because |
|---|---|
| Native integration for each coding agent | Three independent integration/credential surfaces create drift |
| Desktop GUI first | Visual Office is the Zuri control plane; a GUI is not needed to validate the bridge |

**Consequences:** Every operator adapter can run the same binary, capture its result, and share one
contract — but any agent-specific UX (progress streaming, rich prompts) is deferred until a real
need appears.

---

## ADR-002: DuckDB is opened read-only with a fixed query registry, never free-text SQL

**Status:** Accepted (2026-08-10)

**Context:** The bridge must read SmartGift business data without becoming a general-purpose SQL
execution surface reachable by an operator, a model, or a LINE event.

**Decision:** Every query is a registry entry (`src/queries/registry.ts`) with a fixed id/version,
parameterized template, column allow-list, row cap, and sensitivity classification. No caller —
human, model, or adapter — can submit raw SQL text.

**Consequences:** New data needs require a registry change (reviewable, versioned) rather than an
ad-hoc query — slower to extend, but the runtime cannot be used as an injection or exfiltration
vector. See [Appendix B](appendices/B-db-schema.md) for the current registry.

---

## ADR-003: This agent never touches the LINE Messaging API or Zuri PostgreSQL directly

**Status:** Partly superseded (2026-09-05) — the LINE half is retired; the PostgreSQL half stands.
See [the reply-ownership decision](LINE-REPLY-OWNERSHIP-DECISION.md).

**Context:** A local, less-trusted runtime could in principle be handed direct delivery and database
credentials for convenience.

**Decision (as taken, 2026-08-10):** The agent submits a *delivery intent* to Zuri; Zuri's own
outbox performs the LINE send after validating policy, recipient, template, PII, and idempotency.
The agent never receives a LINE channel token and never connects to Zuri PostgreSQL — it uses the
canonical Zuri API only.

**What actually happened:** Zuri never built the send. Its own BR-011 makes this runtime the sole
LINE reply owner, `/api/agent/line-delivery` records what was already sent rather than sending, and
that repository contains no call to the LINE Messaging API at all. So the delivery-intent half of
this decision described an arrangement with nothing on the other side of it, and the deployed system
has always implemented the opposite. Retired deliberately rather than left to rot; BR-007 and
BR-009 carry the controls that replace it.

**The PostgreSQL half is unaffected** and still holds: this runtime uses the canonical Zuri API and
opens no database connection to the cloud.

**Consequences:** Delivery is *not* centrally audited today — the outbound half of a conversation
exists only in the local archive under `state/line-history/`, which BR-008 records as an open
obligation. The blast radius of a compromise is correspondingly wider than this ADR assumed.
See [Appendix E](appendices/E-risk-matrix.md).

---

## ADR-004: Durable state lives in Zuri PostgreSQL; the local runtime is stateless-recoverable

**Status:** Accepted (2026-08-10)

**Context:** A local bridge process can crash or restart; command/run/checkpoint state must not be
lost or duplicated when it does.

**Decision:** The agent holds only an encrypted device identity plus a bounded transient work cache,
both deletable at any time. A restart is recovered through Zuri lease expiry/requeue — never through
local replay.

**Consequences:** Simpler local operations model (nothing to back up or migrate locally), at the
cost of full dependency on Zuri's lease/requeue behavior being correct.

---

## ADR-005: `MockZuriApiClient` gets optional local-file persistence, ahead of a real HTTP client

**Status:** Accepted (2026-08-10)

**Context:** `preview`, `send`, and `status` needed to be wired to something before the real HTTP
`IZuriApiClient` implementation exists (S2's real network client is not yet built). The existing
`MockZuriApiClient` (built for `tests/contract/zuri-api.test.ts`) is in-memory only. Each CLI
invocation is a fresh OS process, so a purely in-memory mock would make `zuri-agent status <id>`
always report "not found" for a command created by an earlier `zuri-agent preview` call — the
canonical example workflow in `docs/COMMAND-AGENT-SPEC.md` §4 would not actually work.

**Decision:** Give `MockZuriApiClient` an optional constructor `persistPath`. When supplied, state
hydrates from that file on construction and is written back after every mutating call. The CLI uses
`defaultMockStatePath()` — an OS temp-directory file, not tracked in Git — so sequential CLI
invocations share state. Tests that don't pass `persistPath` remain purely in-memory and
side-effect-free (`tests/contract/zuri-api.test.ts` is unaffected).

**Alternatives considered:**

| Option | Rejected because |
|---|---|
| Ship preview/send/status against the pure in-memory mock as-is | `status` would never find a job created by a prior `preview` invocation — technically wired, practically unusable |
| Build the real S2 HTTP client now to unblock this | Out of scope for this change; S2's real client needs the actual Zuri endpoint, which doesn't exist in this repo's control |
| Persist inside `src/cli/` instead of `src/zuri-api/client.ts` | Would require exposing `MockZuriApiClient`'s private Maps or duplicating its mutation logic in a wrapper; keeping persistence inside the client itself is the smaller, more contained change |

**Consequences:** The mock's job/lease/evidence/idempotency state now has a bounded, deletable,
non-authoritative on-disk footprint (permitted under AGENTS.md's "transient work cache" rule — no
secrets or raw business rows are stored, only command envelopes/lifecycle state already meant to be
visible via `status`). This file must be deleted (or `defaultMockStatePath()` swapped) once the real
HTTP client lands in S2/S6, so the CLI does not keep reading stale mock state; tracked as a known
gap in [Appendix D §D.6](appendices/D-traceability.md#d6-known-gaps-surfaced-by-this-pass).

---

## ADR-006: Product knowledge is a versioned GenesisBlock graph (v4) owned by `zuri-rag-service`; the LINE agent process never opens a store

**Status:** Accepted (2026-08-23) — spec `zuri-edge-device/docs/superpowers/specs/2026-08-23-smartgift-catalog-graph-v4-design.md`

**Context:** Product answers were produced from a flat 994-row catalog by substring search; the
GenesisBlock stores held no vectors; the LINE `answer` callback concatenated raw product rows into
the prompt; `quote_price`/`find_within_budget` used `rmb × markup` estimates. Real LINE logs showed
"ไม่ใช่แก้ว งบ 200" answered with a mug.

**Decision:**
1. The canonical product model is a 5-layer graph — `CategoryGroup(4) → ProductType/Family(32) →
   ProductModel(427) → PhysicalVariant(1,128) → PhysicalSKU` — with `CatalogOffer(1,107)` composed
   of SKUs (`CONTAINS`) and priced by `CommercialSKU(656)` lines parsed from the FlowAccount export
   (`PRICED_AS`). Identity-review `status` is copied verbatim; every node carries a `sourceRef`.
2. Vectors (`intfloat/multilingual-e5-small`, 384-d, collection `e5_v4`) exist only for
   ProductModel and CatalogOffer; prices and component type ids are denormalized onto those nodes so
   filtering never traverses the graph. Search is two-phase: props-only ranking/filtering, then
   `neighbors()` expansion for the returned cards only.
3. `zuri-rag-service` (:8888) is the **only** process that opens the store. Ingest writes a new
   `genesis_smartgift_store_v4/<runId>/` and moves `CURRENT`; the service opens `CURRENT` once at
   start and reports `staleRun` in `/health` — cutover is a restart. The LINE agent reaches product
   data exclusively through `GenesisLocalRag` (HTTP, 3 s timeout) and the `search_products` /
   `quote_price` / `find_within_budget` tools; unavailability is explicit (`503` →
   `{unavailable:true}`), never a silent substring fallback. `src/rag/genesis-native.ts` may be
   imported only from `src/mcp/**` (dev tooling); `tests/unit/v4-adr-guard.test.ts` enforces this.
4. Customer-facing cards are Model/Offer-level (≤ 5), carry colours, the orderable offer code, the
   tier price for the asked quantity and the FlowAccount export date; a budget that nothing meets
   returns `budgetUnmet` + `nearest[]` instead of silence.

**Consequences:** Measured on 2026-08-23 (`data/catalog_eval_v4/`): Recall@5 0.80, negative-constraint
pass 16/16, offer-self recall 0.90, p95 259 ms, price-link coverage 118/118 — versus 0 / 0 / 0 for the
substring baseline. Refreshing data is an explicit `npm run catalog:ingest-v4` + service restart
(ADR-RAG-004). 98 of 216 FlowAccount sets have no price in the export; they surface as "ราคาสอบถาม"
until the business fills them in. The Docker image of `zuri-rag-service` is not supported for v4
(native Windows binding only).

---

*The four ADRs below were added 2026-08-31, lifted from prose that already existed elsewhere
(`ROADMAP-CONVERSATIONAL-AGENT.md`, `.brain/rca/RCA-2026-08-14-phase1-binding-contract-drift.md`,
and the feature specs themselves) into this log's form, after a system-design review found the
decisions behind roughly two-thirds of `src/` — everything in
[Appendix D §D.9](appendices/D-traceability.md#d9-generations-this-prd-does-not-describe) — had
never been recorded here. Each restates a decision already made and shipped; none changes behavior.
Numbered ADR-007…010 rather than continuing at ADR-006, since ADR-006 above (accepted 2026-08-23,
after these four decisions were made) already claimed that slot.*

## ADR-007: Adopt the CR-012 outbox's state machine, not its code

**Status:** Accepted (2026-08-11)

**Context:** Returning a webhook `200` before an answer exists (required once the headless answer
layer's 8–40 second latency exceeded a LINE reply token's ~30-second life) removes LINE's retry as
the safety net between a crash and a lost message. Something durable has to replace it. A governed
outbox already exists for exactly this shape of problem on the SmartGift repo's
`feat/dashboard-v2-sidebar` branch (`line-copilot-runtime/src/outbox.mjs`, built for SPEC-CR-012's
group copilot): content-hash idempotency keys, revision-based optimistic claims, admission checked
at dispatch time, quarantine as a first-class terminal state — proven by its own test suite.

**Decision:** Reuse that state machine's semantics and vocabulary (`PENDING → DISPATCHING →
DELIVERED | QUARANTINED`, the same status names, the same claim-by-revision shape) in a new,
smaller implementation (`src/delivery/outbox.ts`), rather than importing the CR-012 code directly.

**Alternatives considered:**

| Option | Rejected because |
|---|---|
| Import/depend on the CR-012 runtime directly | Its record shape is Zuri's, not this agent's — keys are `tenantRef/workflowId/nodeId` where this path has a conversation hash and a LINE event id, and every row carries governance fields (`policySnapshotRef`, `piiScanRef`, `configSnapshotRef`) with no producer here. Adapting the schema costs about what writing the small version costs, and importing it would couple this repo to a branch with no PR |
| Design a new state machine from scratch | The CR-012 shape is already proven correct by its own tests; re-deriving it invites re-making mistakes it already found |

**Consequences:** `src/delivery/outbox.ts` is roughly 150 lines against CR-012's ~420, exists only
in this repository, and is not automatically compatible with the real CR-012 runtime's storage. The
payoff is named in the code's own header comment: when the CR-012 runtime ships for real, merging
the two is renaming shared vocabulary, not reconciling two independently-invented ones.

---

## ADR-008: Answer inline first, fall back to deterministic, never guess

**Status:** Accepted (2026-08-11)

**Context:** A free-form chat question ("ร่มพับได้ 200 ชุด งบไม่เกิน 400 พอมีไหม") cannot be answered
by a fixed pattern matcher without forcing customers into one recognized phrasing. A model can read
intent, but a model can also invent a number, and every price/cost/margin figure in this system has
to be traceable to the pricing engine, never to a model's guess.

**Decision:** Three answer layers, tried in order, each falling back to the next on any failure —
pattern reader (`answer/parse.ts`, deterministic, always available) → API layer (`answer/llm.ts`,
per-token billing, tool-scoped) → headless layer (`answer/headless.ts`, subscription-billed,
sandboxed coding-agent process, adds web search/file authoring). Two invariants apply regardless of
which layer answers: evidence is cut to the caller's role (`identity/scope.ts`) *before* a model
ever sees it, and every figure ≥100 in the reply must trace to a tool result or the caller's own
text or the reply is discarded and the pattern answer is sent instead.

**Alternatives considered:**

| Option | Rejected because |
|---|---|
| One model layer, no pattern-reader fallback | A key outage, timeout, or failed number check would leave the customer with nothing rather than a plainer but correct answer |
| Let the model compute prices directly rather than calling the pricing engine as a tool | Reintroduces exactly the invented-number risk the number check exists to close — the model must decide *what* was asked, never *what it costs* |
| Skip the headless layer's sandboxing (shared repo checkout, ambient credentials) | The text a customer sends is not vetted the way the customer's identity is; a message can carry an instruction, and a coding agent follows instructions well. The headless child therefore starts outside every repository, with an allow-listed environment, no shell, and one read-only MCP door with role fixed in its own environment rather than a tool parameter |

**Consequences:** A person always gets an answer and never an unverified one, at the cost of the
fallback's quality ceiling being the pattern reader's comprehension, and of `answer/tools.ts` being
the single place a future evidence field must be scoped correctly before it is ever exposed to a
model.

---

## ADR-009: The identity register starts at deny, never at allow

**Status:** Accepted (2026-08-10)

**Context:** A LINE group has one alias and one owner-configured allowlist, resolved server-side. A
direct message has no equivalent boundary — anyone who adds the official account as a friend can
send one, and the sender's claimed identity in a message ("ผมพี่เจี๊ยบ") is text, not proof.

**Decision:** `src/identity/registry.ts` resolves every direct-message sender against a local
register keyed by an HMAC hash of their LINE user id (never the raw id). `resolveIdentity` returns
`null` for anyone not in the `approved` state — pending and revoked included — so a stranger, a
person still waiting, and a person explicitly cut off all receive the identical neutral reply.
`role` (owner/sales) is set only at approval and gates `identity/scope.ts`'s evidence cut.

**Alternatives considered:**

| Option | Rejected because |
|---|---|
| Allow by default, revoke on abuse | A chat surface that answers pricing/business questions cannot afford even a brief allow-everyone window; the cost of a false negative (a real customer waits for approval) is far smaller than a false positive (an unapproved stranger gets a priced answer) |
| Distinguish "pending" and "revoked" in the reply | Tells a stranger whether an account exists and whether it was deliberately turned off — information the register exists partly to not leak |
| Store the raw LINE user id for easier support/debugging | Every other store in this runtime (archive, chat memory, outbox-once-terminal) already keys by the same HMAC hash; an exception here would be the one place a LINE account list could be reconstructed from disk |

**Consequences:** Every new direct-message capability inherits deny-by-default for free, at the cost
of a real approval step (`zuri-agent identity approve`) standing between a new contact and their
first answer — a deliberate trade given what the register decides access to.

---

## ADR-010: The LINE transport verifies and forwards; the stack decides

**Status:** Accepted (2026-08-14, revised from the 2026-08-14 binding-contract-drift RCA)

**Context:** FR-050 first let this repository forward a signed LINE batch to the Zuri V2 stack for
an answer, using client-supplied `tenantId`/`businessId` scope. FR-052 then moved Zuri V2 to
resolving scope only from a server-owned, persisted LINE binding — but the transport contract here
was not updated when that authorization model changed, so a real request was rejected by the real
route while both sides' own tests passed (each mocked the other's shape rather than a shared
fixture) — see `.brain/rca/RCA-2026-08-14-phase1-binding-contract-drift.md`.

**Decision:** The transport (`src/stack/stack-client.ts`, `src/history/webhook-server.ts`) derives
`destination` only from the signature-verified LINE envelope, carries a server-configured
`bindingId`/`bindingBearer` pair, and never selects or forwards Tenant/Business scope or the LINE
reply token. It fails startup rather than falling back to legacy scope
(`ZURI_STACK_LEGACY_SCOPE_FORBIDDEN`) if reply mode is on with the old variables still set.

**Alternatives considered:**

| Option | Rejected because |
|---|---|
| Patch the client-selected-scope contract to also accept a binding, keeping both paths live | Reintroduces exactly the ambiguity that caused the drift — two ways to reach the same route, one of which the server no longer authorizes |
| Trust each repository's own mocked contract tests going forward | This is precisely how the drift escaped detection the first time; `tests/fixtures/fr052-binding-request-v1.json` is now a fixture both repositories can assert against instead |

**Consequences:** A stack outage or misconfiguration fails closed (`ZURI_STACK_BINDING_CONFIGURATION_MISSING`/`_INVALID`) before any model or reply work happens, and legacy observe-only forwarding is kept only as compatibility, explicitly unable to own a reply. The shared fixture is now the thing that must stay in sync across repositories, not the two contracts' prose descriptions of each other.

Version diff 1.2.0 → 1.3.0b (2026-09-06, RWANG): documented central monorepo candidate and optional executor target; runtime behavior unchanged.
