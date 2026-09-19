---
version: "1.1.0"
created_at: "2026-09-14T15:00:00+07:00,Claude Opus 5"
last_update: "2026-09-14T15:00:00+07:00,Claude Opus 5"
status: "accepted"
superseded_by: null
attributes:
  domain: "agent"
  doc_type: "architecture-decision"
  scope: "which store holds a LINE conversation for which role (CRM business record, MSP session ledger, episodic and passport memory, GKS knowledge, GenesisBlockDB substrate), retention windows and consent per tier, non-text content, erasure propagation, memory projection policy, and the Context Composer that assembles every model prompt"
---

# ADR-091 — The chat record and agent memory are split by role, and a Context Composer assembles every prompt

**Status:** Accepted on the owner's instruction of 2026-09-14 ("ใช้ค่าที่เสนอทุกข้อ"). Phase 0
(declaration) only: no model, column, sweep, receipt, module or migration exists yet, and MSP projection
stays switched off.

**Amended by:** [ADR-093](ADR-093-SWEPT-CHAT-CONTENT-MOVES-TO-AN-ENCRYPTED-LOCAL-COLD-ARCHIVE.md) — `MESSAGE_BODY_AND_ATTACHMENTS` content past its D2 window moves to an encrypted local archive before it is tombstoned; the other three classes stay delete-only. **Refined by:** [ADR-094](ADR-094-A-LINE-CONVERSATION-IS-SPLIT-INTO-IDLE-BOUNDED-SESSIONS.md) — D1's CRM record owns the conversation session id; MSP's chat session stays the memory unit.

**Decided by:** the owner, 2026-09-14, accepting decisions 7, 8, 9, 17C, 18, 19 and 20 of the
consolidated decision table of the LINE OA platform design.

**Reconciles:** [PHASE-04 MSP Episodic Memory](../roadmap/line-oa-business-agent/PHASE-04-MSP-EPISODIC-MEMORY.md)
("Raw transcript stays in MSP storage") with [ADR-061](ADR-061-SERVER-LINE-AND-OPTIONAL-EDGE.md) D1 and
D5 (CRM owns conversations and messages). Neither is rewritten; PHASE-04 carries a pointer here. D1 says
how both are true.

**Relates to:** ADR-022, ADR-041, ADR-043, ADR-044, ADR-045, ADR-061, ADR-068, ADR-070, ADR-072, ADR-089,
ADR-090, FR-022, FR-023, FR-057, FR-091, FR-093, FR-103, FR-127, FR-148, FR-149, FR-171, FR-229, FR-230,
FR-231, FR-232, FR-233, FR-234, FEAT-037, SEC-005, SEC-031, SDD-100,
`docs/roadmap/PLAN-MSP-MEMORY-OS-LINE-AGENT.md`,
`docs/plans/LINE-OA-CREDENTIAL-VAULT-ONBOARDING-AND-CHAT-HISTORY-DESIGN.md`.

## Context

Evidence: [the credential vault and chat-history design](../plans/LINE-OA-CREDENTIAL-VAULT-ONBOARDING-AND-CHAT-HISTORY-DESIGN.md)
§2.3–2.4 and §6, [the MSP memory-OS plan](../roadmap/PLAN-MSP-MEMORY-OS-LINE-AGENT.md), and MSP's
`docs/DESIGN-SESSION-EPISODIC-INSTANCE-MEMORY.md` v0.2.3b §4, §10, §11 (read in the MSP main clone).

- **Two documents name two owners for the raw conversation.** PHASE-04 (candidate, 2026-08-14): "Raw
  transcript stays in MSP storage." ADR-061 (active, 2026-09-06): CRM owns conversations and messages,
  and admission writes the CRM inbound row and the job in one transaction. The code follows ADR-061:
  `Message.body` holds the full text; the inbox, receipts (FR-093) and erasure read it.
- **MSP's own design already tiers memory.** Tier 1 session (`sessions`, `conversation_events`, full
  text, per thread, content tombstoned by a retention tick, default `event_content_ttl_days` 90);
  Tier 2 episodic (summaries and facts per principal × agent × workspace, decays, default 365 days);
  Tier 3 passport (pinned facts per principal, all chats); Tier 4 canonical knowledge is GKS, outside
  MSP. MSP calls no model. Its per-turn context resolution (§10) keeps a priority order, a reported
  budget, provenance on every item, a reference-only receipt and "denied is empty, not partial".
- **MSP main does not have the thread surface zuri-ai calls.** `msp-thread-memory-port.js` calls six
  `msp_thread_*` tools; they exist only on an unmerged MSP branch with two CRITICAL findings, and thread
  erasure (TASK-MEMOS-004) is the gate for any production opt-in. The opt-in today is one deployment
  variable captured per job (`ZURI_MSP_THREAD_MEMORY_ENABLED`, `line-conversation-jobs.js`), not tied to
  any account policy or `Customer.consentStatus`.
- **Admission skips every non-text event** after capturing its evidence; `Message` has no content kind,
  attachment or event record.
- **Retention is an open question** (`docs/domains/agent/ethics-governance.md` #3) and no sweep exists.
- **Erasure stops at Tier 1.** `erase-principal.js` tombstones CRM bodies, jobs, trace inputs and raw
  payloads in one transaction and calls nothing outside.
- **Context assembly has no owner node.** AuthContext, memory packet, knowledge evidence and the model
  call all live inside `createServerLineAnswer`; the proof that a prompt used a packet is split between
  MSP's injection receipt and the trace's `EVIDENCE_SELECTED`; nothing enforces the agent charter's
  "ERP state is operational truth".

## Decision

### D1 — One conversation, four roles, each in one place

| Store | Role | Holds | Lifetime | Consent |
|---|---|---|---|---|
| **CRM** `Conversation` / `Message` (+ attachments and events, D5) | the **business record**: what was received and sent, receipts, the inbox, commerce linkage, legal retention | full text | the business retention class (D2) | not required — needed to answer the message |
| **MSP Tier 1 session** `sessions` / `conversation_events` | the **agent's conversation ledger** and the buffer before consolidation | full text | content tombstoned at 90 days | account `memoryPolicy` not OFF (D4) |
| **MSP Tier 2 episodic** | session summaries and facts for this person with this agent | summaries, facts, provenance | decays (MSP default 365 days) | consent GRANTED and DIRECT (D4) |
| **MSP Tier 3 passport** | durable facts about the person across all chats | pinned facts | until erasure | consent GRANTED and DIRECT (D4) |
| **GKS** | semantic and canonical knowledge that passed a gate | entities, relations, source snapshots | permanent (withdrawable) | no personal data (ADR-090 D6) |
| **GenesisBlockDB** | graph and vector index substrate under GKS | six lanes | as GKS | — |

Rules that make the table true:

1. **CRM is written first**, in the ADR-061 admission transaction. MSP receives a projection after the
   CRM row exists, never instead of it.
2. **The same text is duplicated between CRM and MSP for at most 90 days.** After that MSP holds only
   summaries and facts with provenance pointing back.
3. **On session close MSP consolidates Tier 1 into Tier 2 and Tier 3**, under MSP's consolidation policy.
4. **MSP calls no model.** The consolidation summary is produced by the Tier 1 agent lane's model call
   and sent back to MSP.
5. **MSP does not persist into GenesisBlockDB** (PHASE-04 out of scope, restated). Knowledge reaches GKS
   only through ADR-090 D6.
6. **The GenesisBlockDB write-ahead log is engine-internal** — folded at checkpoint, unreachable from
   Tier 1 (ADR-043 D2.1) — and is never used as a chat buffer.

So PHASE-04's sentence reads, from this decision on: the **agent's** transcript stays in MSP storage,
under MSP's retention; the **business record** of the conversation is CRM's.

### D2 — Retention is declared per data class, and a Tenant may only shorten it

| Data class | Installation default |
|---|---|
| Raw LINE payload text (`RawExternalRecord.payloadJson`) | 90 days, then tombstone; envelope columns kept |
| CRM `Message` body and attachments | 24 months, unless erased earlier |
| `AgentTraceEvent` payloads (exact input snapshots) | 90 days |
| MSP session event content | 90 days (MSP's default) |

A per-Tenant override may shorten a window, never lengthen it. A nightly sweep tombstones by window,
skips rows a non-terminal LINE job still references, and writes one audit event per run with counts per
class. The trace retention honours ADR-070 D3's rule that retention is reported truthfully.

### D3 — MSP projection stays off until MSP can hold and erase it; plumbing first

The policy, consent capture and projection receipts are built first. Projection itself stays **OFF**
— the projector refuses with `MSP_THREAD_CONTRACT_UNAVAILABLE` — until MSP main ships the thread tools
**and** an erase tool (TASK-MEMOS-002 and TASK-MEMOS-004 of the MSP memory-OS plan). The deployment
variable `ZURI_MSP_THREAD_MEMORY_ENABLED` stops being the opt-in and becomes a kill switch.

Every projection MSP acknowledges is recorded as a `MemoryProjectionReceipt` (agent lane) in the same
local transaction that settles its delivery state, so erasure always has a durable list of what MSP holds.

### D4 — Consent is per tier: the session tier needs policy, memory beyond it needs consent

- The **MSP session tier** — thread-scoped, 90 days — needs only the account's `memoryPolicy` not OFF.
  It is the context of a conversation the customer started; it does not follow them anywhere else.
- **Episodic memory, passport memory and cross-thread recall** need the Customer's consent **GRANTED**
  (FR-103, SEC-005) **and** a **DIRECT** audience.
- A group or room turn never reaches private memory; its slices never cross threads (MSP design §10).
- Admission captures both answers immutably per job, as it captures the opt-in today.

### D5 — Non-text content is recorded now; media bytes are fetched later

Admission stops skipping non-text events. Stickers, locations and media become CRM `Message` rows with a
content kind and a placeholder body; media get a `MessageAttachment` **without bytes**; follow,
unfollow, join, leave, membership changes, postbacks and unsends become `ConversationEvent` rows. None
creates an answer job (replies stay bounded text, ADR-061 D8). An unsend tombstones the referenced
message. Fetching bytes into `FileAsset` within LINE's retention window is a later phase; until then only
the event is recorded. The inbox gains read-model columns and a search reader in the same phase (FR-233).

### D6 — Erasure is transactional inside Tier 1 and acknowledged outside it

One transaction tombstones everything Tier 1 holds (CRM bodies, previews and attachments; LINE job
fields; raw payloads; trace inputs; knowledge candidates per ADR-090 D8). The same transaction leaves
durable work: one MSP erase call per projection receipt, retried with backoff, and a knowledge-source
withdrawal for any candidate already admitted. The Customer's erasure status reads **`PENDING_MSP`**
until MSP acknowledges. An external tier is never assumed erased (SEC-031). A consent change to DECLINED
erases that customer's memory projections without a full principal erasure.

### D7 — The Context Composer is a formal node in the agent lane

A **module**, `src/modules/agent/context-composer.js`, not a service. The agent lane stays the turn
orchestrator (agent charter, ADR-022); MSP resolves memory; GKS orchestrates knowledge RAG, not turns.

| Aspect | Rule |
|---|---|
| Inputs | the server-built AuthContext; MSP packet slices with provenance; knowledge evidence with `citationId` (ADR-090); CRM and ERP operational facts through their read ports; the account's policy |
| Priority | **authorization first**; then CRM/ERP record **>** GKS evidence **>** MSP memory. Memory that conflicts with a record is dropped with reason **`SUPERSEDED_BY_RECORD`** |
| Budget | one prompt-wide budget, split per slice; every trim is reported |
| Scope | group slices never cross threads; a non-DIRECT turn gets no passport or recall slice; **denied means an empty packet**, never a partial one |
| Receipt | exactly **one `ContextReceipt` per model invocation** — references, hash and budget, never content — recorded on `AgentTraceEvent`; MSP's injection receipt references it by id |
| No evidence | no evidence and no facts means **no model call**; the deterministic reply is sent |
| Lineage | a follow-on to FR-171-P2's memory-provenance envelope |

SDD-100 records placement and the receipt shape.

### Planned persistence (not in any schema yet)

| Lane | Planned | Purpose |
|---|---|---|
| crm | `MessageAttachment`, `ConversationEvent`; `Message` content kind, sender channel identity, expiry; `Conversation` last-message time, preview, retention class | D5, D2 |
| agent | `MemoryProjectionReceipt` | D3, D6 |
| line-oa-studio | `LineOaAccount.memoryPolicy` | D3, D4 |
| (decided with the Phase 3 slice) | per-Tenant retention overrides | D2 |

## Requirement map

| Design placeholder | Id | Subject |
|---|---|---|
| vault FR-NEW-5 | FR-229 | Non-text LINE content in the CRM record |
| vault FR-NEW-8 + decision 18 | FR-230 | Chat record and agent memory split with declared retention |
| vault FR-NEW-6 + decision 19 | FR-231 | LINE memory projection policy and receipts |
| vault FR-NEW-7 + GKS FR-NEW-5 | FR-232 | Erasure propagation beyond Tier 1 |
| vault FR-NEW-9 | FR-233 | Conversation inbox read models and search |
| decision 20 | FR-234 | Context Composer |
| vault SEC-NEW-2 | SEC-031 | Every copy of a person's conversation content has a retention window and an erasure path |
| decision 20 | SDD-100 | Context Composer placement and receipt |
| vault FEAT-NEW-2 | FEAT-037 | Chat record, memory tiers and retention |

## Consequences

- **The inbox, receipts and legal retention never depend on MSP being reachable.** MSP stays a
  stdio child, not a daemon the record needs.
- **Customers who have not consented still get in-thread continuity** once projection is on; nothing
  about them persists beyond the thread's 90 days or reaches episodic or passport memory.
- **Chat history becomes complete in the record** (non-text events, media references), which adds a
  second PII surface for media once bytes are fetched — the reason bytes wait for a later phase.
- **The agent lane gains a module and, later, one model** (`MemoryProjectionReceipt`); crm gains two
  models and columns; line-oa-studio one column. Charter prose now; `owns_models` when each model exists.
- **Retention numbers are product policy, not law.** PDPA sets no number; these are the owner's, and a
  Tenant can only tighten them.
- **Erasure status gains a visible pending state** that may last as long as MSP is unavailable.

## Required proof

1. Admission writes CRM before any MSP call; with MSP down, inbox, receipts and replies are unaffected.
2. With projection off, no MSP thread tool is called for any policy or consent value.
3. Session tier with policy on and consent PENDING: in-thread recall only; no episodic, passport or
   cross-thread slice; a group turn never reaches private memory.
4. A non-text event produces its CRM row and no answer job; an unsend tombstones its message.
5. The retention sweep tombstones exactly the rows past each window, skips rows a live job references,
   and a Tenant override cannot lengthen a window.
6. Erasure: one local transaction; `PENDING_MSP` until acknowledged; after acknowledgement the MSP
   context no longer returns the text (the three-repository test of the ADR-068 pattern).
7. Context Composer: a record beats conflicting memory with `SUPERSEDED_BY_RECORD`; a denied scope yields
   an empty packet; every trim is reported; one `ContextReceipt` per model call referenced by the MSP
   injection receipt; no evidence and no facts means no model call.

## Delivery phases (shared numbering with ADR-089 and ADR-090)

| Phase | Content | Gate |
|---|---|---|
| 0 | This ADR, FR-229..FR-234, SEC-031, SDD-100, FEAT-037, PHASE-04 pointer | `govern` green; owner approval 2026-09-14 |
| 3 | `MessageAttachment`, `ConversationEvent`, inbox read models and search, retention sweep and Tenant overrides | proof 4–5 |
| 3b | Context Composer out of `createServerLineAnswer`, truth order, budget, `ContextReceipt`; before phases 4 and 6 | proof 7 |
| 6 | `memoryPolicy`, consent capture, `MemoryProjectionReceipt`, MSP erase worker and `PENDING_MSP`; media byte fetch | **blocked on MSP main** (TASK-MEMOS-002, -004); proof 1–3 and 6 |

## Alternatives rejected

**MSP as the primary store of chat, CRM holding metadata only.** Rejected: it would reverse ADR-061, make
the inbox and receipts depend on MSP, and require MSP to become a daemon.

**MSP stores observations only, never full text.** Withdrawn during the design: MSP's own tiering already
bounds full text to the session tier with a tombstone, then consolidates.

**Consent required for every MSP tier.** Rejected by the owner: in-thread context of a conversation the
customer started is operational, and denying it degrades every answer to unconsented customers.

**Context assembly left inside `createServerLineAnswer`.** Rejected: no enforceable truth order, two
receipts for one prompt, and no reuse by the legacy turn.

**A Context Composer service.** Rejected: a module in the orchestrating lane is enough; a service would
add a transport with nothing to isolate.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.1.0 | 2026-09-16 | accepted | Amended by ADR-093 (archive before tombstone for message bodies) and refined by ADR-094 (the record owns the session id); D1–D7 otherwise unchanged | working-tree | Claude Opus 5 |
| 1.0.0 | 2026-09-14 | accepted | CRM is the business record and MSP's session tier the agent's 90-day ledger consolidated into episodic and passport memory; retention defaults with downward-only Tenant overrides; MSP projection off until MSP main ships thread and erase tools; session tier needs policy, memory beyond it consent and DIRECT; non-text content recorded without bytes; erasure transactional inside Tier 1 and acknowledged outside; the Context Composer as an agent-lane module with one `ContextReceipt` per model call; reconciles PHASE-04 with ADR-061; Phase 0 declaration only | working-tree | Claude Opus 5 |
