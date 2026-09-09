---
id: "ZURI-CONVERSATIONAL-ANSWER"
version: "0.1.1b"
status: "candidate"
owner: "zuri-command-agent"
scope: "reading a free-form chat question and phrasing the reply"
created_at: "2026-08-11T07:45:00+07:00, ATHER"
last_update: "2026-08-31T00:00:00+07:00, Claude"
---

# Conversational answers

> Current transport decision: [Server-owned LINE and optional Edge](SERVER-LINE-OPTIONAL-EDGE.md)
> implements upstream ADR-061. New runtimes are compute-only; the transport behavior below
> applies only to explicitly selected `LEGACY_EDGE` installations during migration.


## Outcome

A person can ask in their own words — "ร่มพับได้ 200 ชุด งบไม่เกิน 400 พอมีไหม", "แล้วถ้าสั่ง 500 ล่ะ",
"ส่งเรือกับส่งรถต่างกันเท่าไหร่" — and get an answer, instead of having to type the one shape a
pattern matcher recognises.

## What decides what

The model decides **what was asked** and **how to say the answer**. It decides nothing about what
anything costs.

| Decision | Made by |
|---|---|
| Which product, quantity, budget, or topic the person means | Model |
| Whether the answer needs a price, a search, a lead time, or a term | Model |
| Every price, cost, margin, day count and match count | Pricing engine, through a tool call |
| Which of those figures the caller is allowed to see | `identity/scope.ts`, before the model sees them |
| Whether the finished reply may be sent | The number check, after the model writes it |

## The three things that keep that true

**Scoped evidence.** Tool results are cut to the caller's role in `answer/tools.ts` before they are
returned, so a sales conversation has no cost, markup or margin in the model's context to leak. The
protection is absence, not instruction: an instruction can be argued with by whatever the customer
types into the chat, an absent field cannot.

**The number check.** Every figure of 100 or more in the reply must appear in a tool result or in
what the person themselves typed. Rounding to a whole baht is tolerated; anything else counts as
invented, and the reply is discarded. See `unverifiedNumbers` in `answer/llm.ts`.

**A real fallback — but only when it has something to read.** No key, model disabled, an API error,
a timeout, no text, or a failed number check all end in the same place: the pattern-based answer
from `answer/parse.ts`, computed first on every turn and never guessing. That reader is honest only
about a catalogue it actually loaded — with no catalogue on disk, it cannot tell a real "we do not
carry that code" from "nothing was ever checked," so it no longer tries to. `conversation/executor.ts`
refuses to complete a job whose only answer is the pattern reader talking against an empty catalogue;
the turn fails instead, which is truthful, rather than completing with a denial nobody verified. A
populated catalogue is unaffected: a genuine "code not found" or "nothing matches that search" is
still exactly what it says, and the model path is unaffected too, since it answers from the RAG
index rather than the local catalogue file. A person gets an answer whenever there is real data
behind it, and never one dressed up to look like there was.

## Two providers

| | API layer (`answer/llm.ts`) | Headless layer (`answer/headless.ts`) |
|---|---|---|
| Billing | Per token, needs `ANTHROPIC_API_KEY` | The signed-in **subscription plan** |
| Continuity | We replay the last turns | `claude --resume`, keyed by conversation |
| Tools | The five pricing calls | Pricing calls **+ web search + file authoring** |
| Latency | Seconds | Tens of seconds |
| Delivery | Fits a LINE reply token | **Needs push** |

The headless layer wins when both are configured. It runs `claude --print --output-format
stream-json`, which is what makes the number check possible on this path too: the tool results
scroll past on that stream and are harvested in the parent.

To keep the work on the plan, `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` are removed from the
child's environment. A key left in place would silently move the cost onto per-token billing.

## The cage around the headless layer

The person on the other end of the chat has been approved. The *text they send* has not — a message
can carry an instruction, and a coding agent follows instructions well. So the child gets:

- **a working directory outside every repository**, so nothing above it is readable and no
  `CLAUDE.md` is discovered up the tree;
- **an environment built from an allow-list** — no LINE token, no Vercel token, no database path,
  no API key exists in it to be read or spent;
- **no shell**, ever: `Bash` is absent from the allow-list *and* named in `--disallowedTools`;
- **one door to company data** — the pricing MCP server (`src/mcp/pricing-server.ts`), which is
  registered read-only calls, started with the caller's role already fixed in its environment. Role
  is not a tool parameter, so a message cannot ask to change it;
- **`--strict-mcp-config`**, so no other MCP server on the machine is picked up;
- **the message passed as an argument**, never through a shell, so punctuation stays punctuation.

`ZURI_HEADLESS_WEB_SEARCH` and `ZURI_HEADLESS_FILES` are each off by default. Each is an outward
capability and should be a decision.

## Memory

`answer/memory.ts` keeps the last twelve turns per person so a follow-up has something to refer back
to. Keyed by the same HMAC of the LINE user id that the identity register and the archive use — a
raw LINE id is never written here. Message text *is* stored, because a conversation the agent cannot
re-read is not a conversation; retention is therefore **24 hours** rather than the archive's 30 days.
Files live under the git-ignored `state/` tree. `zuri-agent chat prune` clears what has expired.

*Updated 2026-09-06 (BR-010).* Short-lived memory is no longer the only place a direct message's
text is kept. The LINE archive now records both halves of a direct conversation under
`_dm/<hash>/`, on its own retention — **7 days** by default (`LINE_HISTORY_DM_RETENTION_DAYS`),
against the group archive's 30 and memory's 24 hours. A deliberate widening past memory, because an
archive that held only group conversations could not show what the OA said to anyone who wrote in
privately, and a deliberate shortening against the group clock, because a private conversation is
not group history. The hashing rule is unchanged and applies to the archive too: the
directory is derived from the keyed hash, and a raw LINE id is written on neither side.

## Configuration

| Variable | Default | Note |
|---|---|---|
| `ZURI_LLM_ENABLED` | `false` | Off means the pattern reader answers |
| `ANTHROPIC_API_KEY` | — | Required only when enabled |
| `ZURI_LLM_MODEL` | `claude-opus-5` | |
| `ZURI_LLM_EFFORT` | `low` | Reading a question and phrasing an answer is not deep reasoning |
| `ZURI_LLM_TIMEOUT_MS` | `12000` | Must stay under the ~30s life of a LINE reply token |
| `ZURI_LLM_MAX_ITERATIONS` | `4` | Ceiling on the tool loop |
| `ZURI_CHAT_RETENTION_HOURS` | `24` | |

`zuri-agent config check` reports the layer's state and refuses a timeout that would outlive a reply
token.

## Trying it without LINE

```
zuri-agent chat say --text "TJS23-2 100 ชุด" --role sales
zuri-agent chat say --text "แล้วถ้าสั่ง 500 ล่ะ" --role sales
```

The output names which path answered (`model` or `rules`), why the fallback was used when it was,
and which tools were called. The reply itself deliberately says none of that.

## Governance note

This is the first path in the runtime that calls an external model provider. `AGENTS.md` places
model and provider changes behind approval, so enabling `ZURI_LLM_ENABLED` is an owner's decision,
not a default. **Resolved 2026-08-31:** `AGENTS.md` v0.5.0b's permission matrix now carries explicit
rows for the model-API call, the headless agent spawn, and the outbox push this spec introduces —
the gap this note was tracking is closed. Whether the spec itself is ready to leave candidate status
is a separate, still-open decision the owner has not made.

## Delivery

Answering outlasts a LINE reply token — 8.6 seconds for a trivial question on the headless layer,
20–40 with tools, against a token that lives about 30 seconds and is single-use. So with
`ZURI_OUTBOX_ENABLED=true` the webhook stops waiting for an answer:

1. The question is accepted onto a queue (`src/delivery/outbox.ts`) and the `200` goes back — 27 ms
   in the end-to-end check.
2. The reply token is spent on an acknowledgement, because thirty seconds of silence reads as
   broken and that token is the only chance to say otherwise.
3. A worker beside the server answers and pushes (`src/delivery/worker.ts`).

The queue is the CR-012 state machine: `PENDING → DISPATCHING → DELIVERED | QUARANTINED`, keyed by
a content hash of conversation and event id, claimed by revision so two workers cannot both take
one item, with one answer in flight per person.

**Why it has to be durable.** Before this, a reply that threw left the event id out of the seen set
and LINE re-delivered it — the retry was the safety net. Once the `200` goes out first, LINE
considers the message handled and never sends it again, so the queue is now the only thing between
a crash and a customer who never got an answer. A claim whose lease expires is taken back; work
that exhausts its attempts is **quarantined rather than dropped**, because someone has to be able
to find out that a question went unanswered. `zuri-agent outbox list` is that view.

**The raw LINE id.** A push cannot be addressed without it, so unlike everything else on disk here
the queue holds one. It is bounded rather than excused: cleared the moment the record reaches a
terminal state, so it exists only while a delivery is actually in flight.

## Known limits

- **An acknowledgement costs a message.** With the queue on, a fast pattern answer arrives as two
  messages where it used to be one. Racing the answer against the token would avoid that, and adds
  a mode where crash-safety depends on which branch won — not worth it yet.
- Group messages are untouched by this: only direct messages route through the queue.
- A remembered figure is accepted by the number check for the life of the conversation, on the
  grounds that the engine produced it. If the exchange rate or the ladder changes mid-conversation,
  a stale figure would still pass. Retention bounds it to a week.
- The tunnel that carries the webhook is still an ephemeral Cloudflare Quick Tunnel.
