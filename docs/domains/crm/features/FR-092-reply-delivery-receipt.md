---
domain: crm
feature: FR-092
module: crm
source: v2-native
version: "0.1.0b"
created_at: "2026-08-20T00:00:00+07:00,ATHER"
last_update: "2026-08-20T00:00:00+07:00,ATHER"
status: "beta"
---

# FR-092 — LINE reply delivery receipt

## Why this exists

FR-091 shipped the inbox and immediately exposed something nobody had said out
loud: **no code anywhere had ever written a `Message` with `direction:
'OUTBOUND'`.** `MESSAGE_DIRECTIONS` had held both values since FR-023 and
`ingestLineMessage` accepted either, but no caller ever passed the second one.

The reply was assembled here, handed to the edge runtime, sent to the customer
and then forgotten. So the Dashboard read `ตอบออกไป: 0` and would have kept
reading zero forever, and the inbox showed one side of every conversation.

## Decision 1 — the receipt comes from the sender, after the send

There were two ways to close this, and they are not equivalent.

**Record at hand-over** — `zuri-ai` writes the OUTBOUND row when it returns the
answer to the transport — is one line of code and is wrong. Reading
`handleStackReplies` in the edge runtime settles it:

> when the stack's result is not `ok`, or its text is empty, the transport sends
> `STACK_UNAVAILABLE_REPLY` — **its own text, not ours**.

So the text this side produces and the text the customer receives are different
strings on exactly the path that matters most: the one where something went
wrong. Recording at hand-over would write a message nobody ever read, and it
would look right in the inbox.

**Record on receipt** — the transport posts back what it actually sent — costs a
round trip and an endpoint, and is the only version that is true. BR-011 already
says the reply owner is the transport; this is the same rule applied to the
record of the reply. `source` distinguishes `STACK` from `TRANSPORT_FALLBACK`,
so a fallback is visible as a fallback rather than passing as an answer.

## Decision 2 — a second writer, not `direction: 'OUTBOUND'`

`ingestLineMessage` creates a Person, a Customer and a Conversation when they
are absent. That is right for an inbound message from someone new, and exactly
wrong here: a receipt naming a conversation that does not exist is a transport
bug to surface, never a reason to invent a customer.

So `recordLineReply` is a separate, narrower writer. It **never takes a
conversation from the request**: it resolves the inbound `Message` the reply
answers and derives the conversation from that row. Cross-tenant attachment is
therefore unsayable rather than refused — the only conversation the function can
reach is the one already holding the message the caller named.

## Decision 3 — idempotent on the inbound message, not on a provider id

The external id of a reply is `reply:<inboundMessageId>`, derived from our own
row rather than from anything the caller supplies.

LINE returns a message id for a sent reply, and the transport may pass it — but
requiring it would make idempotency depend on the transport still remembering
it across a restart. Keying on the inbound message means a redelivered receipt
lands on the same row unconditionally, and it encodes the real constraint: one
reply token, one reply. The provider id is recorded as evidence on the audit
event.

A retry carrying different text does **not** rewrite the stored body. What was
sent was sent.

## What building it turned up

The failed-turn result carried no `eventId`.

The transport matches stack results to its own events by that field. With it
absent, `results.find(...)` returned `undefined` for every failed turn — and the
customer still got a reply, because `result?.ok` on `undefined` is falsy and
falls through to the fallback exactly as a genuine `ok: false` does. Two
different situations produced the right behaviour for two different reasons, and
nothing distinguished them.

That accident became load-bearing here: without the match, the transport cannot
pair `inboundMessageId` with the event it answered, so the reply sent after a
failed turn — the case this whole requirement most needs to record — would go
unrecorded. The failure branch now carries `eventId`, and the ids alongside it.

Ingest is step 1 of a turn, so by the time anything else fails the row exists.
It travels out on the error rather than being lost with the stack frame. Where
the failure *was* the ingest, both ids are null and nothing is invented.

## What is deliberately not here

- **Push messages.** This records a reply to an inbound message. A message the
  business sends unprompted has no inbound message to name and needs its own
  contract — including who is allowed to send one.
- **Multi-message replies.** The Reply API accepts up to five messages per
  token; the runtime sends one. When that changes, the key changes with it.
- **Retrying a failed record.** A receipt that fails is reported to the
  transport with its stage; nothing here queues it. The transport already owns
  retry for the send, and a queue on this side would be a second one.
