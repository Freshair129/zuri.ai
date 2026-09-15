---
version: "0.1.0"
created_at: "2026-09-15T23:40:00+07:00,Claude Opus 5"
last_update: "2026-09-15T23:40:00+07:00,Claude Opus 5"
status: "proposed"
superseded_by: null
attributes:
  domain: "crm"
  doc_type: "architecture-decision"
  scope: "a session id that splits one long-lived LINE conversation into sittings by idle time, which store owns it, the timeout, what it bounds in a prompt, and what it does and does not do for local model memory"
---

# ADR-094 — A LINE conversation is split into idle-bounded sessions

**Status:** Proposed on 2026-09-15 at the owner's request. Not accepted. Nothing is built, declared or pinned beyond this ADR's own id until the owner answers the open decisions below.

**Would refine, on acceptance:** ADR-091 D1, by naming which store owns the session id of the business record.

**Relates to:** FR-093, FR-148, FR-171, FR-229, FR-230, FR-233, FR-234, ADR-061, ADR-091.

## Context

On 2026-09-15 the owner asked for a session id that separates each sitting of a conversation, since one customer may have several in a day. The owner gave two purposes: tracing a conversation back to its origin, and giving resources back to the system instead of keeping model memory cached all the time: "เพิ่มระบบ session id ด้วย เพื่อแยกครั้งการคุย วันนึงอาจมีหลาย session".

What exists today:

- **The CRM record has no session.** One `Conversation` row exists per LINE user per Official Account for ever, unique on tenant, channel, account and external thread id. `Message`, `ConversationEvent` and `MessageAttachment` carry no session. `LineConversationJob` and `AgentTraceEvent` carry a `correlationId` per turn only. Nothing groups turns into a sitting.
- **MSP already has sessions, off in production.** MSP main (`d33a433`) keeps `chat_sessions` with `OPEN`, `CLOSING` and `CLOSED` and an `idle_deadline`. `MSP_THREAD_IDLE_TIMEOUT_MINUTES` defaults to 30. An append opens a new session when the previous one is idle, and `msp_session_sweep` closes idle sessions and queues their compaction into a session summary. A caller cannot mint a session id; it can only name an open one. Production does not set `ZURI_MSP_THREAD_MEMORY_ENABLED`, so no MSP session exists.
- **A LINE prompt carries no conversation history today.** With MSP thread memory off, `server-line-answer.js` receives an empty memory packet, so every turn is answered without earlier turns.
- **Local model memory is pinned on purpose.** The edge worker loads the model with Ollama `keep_alive: -1` (`apps/edge/src/answer/providers/model-warmer.ts`). Measured on the RTX 3060 12 GB host, a cold load costs 21.2 s for `qwen3.5:4b`, 37.7 s for `pathumma-thaillm-8b` and 91.1 s for `qwen3.5:9b`, against a LINE reply token that expires in about 30 s. The warmer also has an unload call (`keep_alive: 0`).
- **VRAM is not held per conversation.** Ollama allocates VRAM when a model loads, for the weights and a context buffer sized by `num_ctx` (8192 by default here), and holds it for as long as the model stays loaded, whichever conversations use it. Closing a session frees none of it. What a session bounds is the prompt: fewer history tokens per turn, which is less compute and a faster answer.

## Decision (proposed)

### D1 — The CRM record owns the business session id; MSP's session stays the memory unit

A new crm model, `ConversationSession`, is the session of the business record, used by the inbox, tracing, receipts and the ADR-093 archive. It follows ADR-091's rule that the record never depends on MSP being reachable, and it works today while MSP is off. When MSP thread memory is on, MSP keeps its own `chat_sessions` as the unit it compacts, and zuri-ai stores the MSP `session_id` that each append returns next to its own. Both use the same idle timeout from one setting. A divergence, for example after MSP's late-delivery reconciliation, is recorded and visible, never silently merged.

### D2 — The rule: idle time between messages, decided inside the admission transaction

- **Inbound.** A message joins the conversation's latest session when the previous message in that conversation is newer than the idle timeout, measured by message time rather than wall clock. Otherwise it opens a new session. The decision runs inside the ADR-061 admission transaction, serialized per conversation, so two webhook deliveries cannot open two sessions at once.
- **Replies.** A reply joins the session of the inbound message it answers, which `reply-record-service.js` already resolves. A late reply therefore never opens a session of its own.
- **Events.** A follow, unfollow or other `ConversationEvent` takes the open session, or none.
- **No sweeper.** A session is closed when its last message is older than the timeout. `closedAt` is written when the next session opens, so nothing has to run on a schedule to close sessions.
- **Backfill.** Existing messages are assigned to sessions by the same rule, 235 messages on production on 2026-09-15.

### D3 — Timeout: 30 minutes idle by default, set per Official Account

The default is 30 minutes without a message, the same as MSP's default and the usual convention for a chat or web visit. Each LINE Official Account may set 10 to 120 minutes. There is no midnight cut: a session active across midnight stays one session. The same value is passed to MSP per call as `idle_timeout_minutes` when MSP memory is on.

### D4 — What carries the session id

- **Session row.** Internal UUID and a human code such as `S-20260915-0003` (BR-002), with conversation, Customer, Business, Tenant and account ids, `openedAt`, `lastMessageAt`, `closedAt`, inbound and outbound counts and, when present, the MSP session id.
- **Rows that reference it.** `Message`, `ConversationEvent` and `LineConversationJob`. `AgentTraceEvent` rows reach the session through their `turnId`, and so does the ContextReceipt the trace records, so the trace model needs no new column.
- **Where people see it.** The inbox shows a divider between sessions. The trace view filters by session. ADR-093 archive lines carry the session id, so a dispute can be retrieved sitting by sitting.

### D5 — A prompt's history is bounded by the session

Once memory is on, a LINE prompt may carry the current session's exchanges and summaries of earlier sessions, never raw messages from a closed session. Today the prompt carries no history, so this is a ceiling for later, not a saving now.

### D6 — Freeing VRAM is a residency schedule, not a session effect

Because a session closing frees no VRAM, model residency is decided separately:

- **Option A, business hours.** Pin the model during each account's business hours and unload it with `keep_alive: 0` at closing time. A message outside hours is answered by a fixed reply, and the model loads at opening.
- **Option B, idle across all sessions.** Unload the model when no session on the device has been open for 45 minutes, and warm it on the next inbound message. With `qwen3.5:4b` the 21.2 s cold load may still beat the 30 s reply token; with `pathumma-thaillm-8b` or `qwen3.5:9b` it cannot, and that first message gets no model answer.
- **Option C, today.** Keep the model pinned at all times.

## Open decisions for the owner

| Decision | Proposed default | Alternatives |
|---|---|---|
| D3 idle timeout | 30 minutes | 15, 60 or 120 minutes |
| D3 per-account override | allowed between 10 and 120 minutes | one value for the installation |
| D4 inbox dividers | show a divider between sessions | trace view only |
| D6 model residency | option A, business hours | option B idle-based, option C always pinned |
| D6 outside business hours | fixed reply, model loads at opening | cold load and possibly no answer |

## Consequences

- **Tracing works before MSP.** Every turn, trace and archived line can be grouped by sitting from the first deploy, without MSP memory.
- **Two session ids when MSP is on.** They normally agree because they use one timeout. A disagreement is data to inspect, not an error to hide.
- **One more write on the hottest path.** The admission transaction reads the conversation's last message time and may insert a session row. The admission latency budget must be measured after the change.
- **VRAM is only saved if D6 changes.** Sessions alone do not unload the model.

## Requirements to declare on acceptance

One FR for session derivation and the ids on the record, job and trace. One FR for model residency on the edge, if D6 is not option C. One SDD for the session rule, the per-conversation serialization and the MSP id mapping. The ids are taken at acceptance.

## Delivery phases

| Phase | Scope | Gate |
|---|---|---|
| 0 | Owner answers the open decisions, the ADR is accepted and the requirements are declared | owner |
| 1 | `ConversationSession` model and migration, assignment in admission and reply recording, backfill | concurrent deliveries open one session; replies never open one |
| 2 | Session id on job and trace, inbox dividers, trace filter | e2e shows two sessions for a gap past the timeout |
| 3 | MSP alignment: idle minutes per call, MSP session id stored | after the MSP canary (TASK-MEMOS-006) |
| 4 | Edge model residency per D6 | measured first reply after an unload |

## Alternatives considered

- **MSP as the only session authority.** Rejected for the record: production has no MSP session today, and ADR-091 keeps the inbox and receipts independent of MSP.
- **Calendar-day sessions.** Rejected, because one customer can hold several unrelated sittings in a day, which is the owner's own example.
- **A sweeper that closes sessions on a timer.** Rejected, because closure is derivable from the last message time and a timer adds a job that can fail.
- **Unloading the model when each session closes.** Rejected, because VRAM is shared by every conversation on the device and a cold load can outlast the reply token.

## CHANGELOG

| Version | Date | Status | Change |
|---|---|---|---|
| 0.1.0 | 2026-09-15 | proposed | First draft at the owner's request, with production facts, MSP's existing session model, the VRAM measurements and six proposed decisions |
