---
domain: crm
feature: FR-246
module: crm
source: adr-093-evidence-gap
version: "0.1.0b"
created_at: "2026-09-16T00:00:00+07:00,Claude Sonnet 5"
last_update: "2026-09-16T00:00:00+07:00,Claude Sonnet 5"
status: "beta"
---

# FR-246 — Staff replies

## Why this exists

[ADR-093](../../../decisions/ADR-093-SWEPT-CHAT-CONTENT-MOVES-TO-AN-ENCRYPTED-LOCAL-COLD-ARCHIVE.md)
was written to answer a dispute two years from now: a customer says the business
once promised a discount of X baht, and the business needs to prove what was
actually said. That archive can only hold what the record already has — and the
record, per [FR-091](FR-091-conversation-inbox.md) Decision 2, held only one side
of every conversation once a human, rather than the automatic stack, answered a
customer from LINE Official Account Manager. That reply never reached `zuri-ai`
at all. The owner chose, in writing, to close this evidence gap before building
the archive itself: "the evidence gap the owner chose to close first" (ADR-093 D0).

This is that closure — not a chat feature for its own sake, but the other half
of what the archive needs to be complete.

## Decision — a second writer, not a wider one

`recordLineReply` (FR-093) exists to record what the edge runtime already sent
automatically, keyed on the one inbound message it answers — one stack reply per
`replyToken`, matching LINE's own Reply API rule. A human composing from the
Inbox is a different shape of event entirely: no `replyToken` (LINE's Push API,
not Reply), no one-message ceiling (a person may send several messages in a row
with no new inbound between them), and a real actor to name (BR-001's audit
trail, not a system label).

Rather than stretch `recordLineReply` to cover both, `sendStaffReply` is a
second, separate writer:

- **Authorization first.** `assertDomainVisible` then `ownsBusiness` — the same
  order and gate FR-103's consent attestation already uses — before anything is
  attempted, so a viewer without CRM ownership of the Business learns nothing
  about whether the conversation exists.
- **Idempotent on `clientRequestId`, not on the inbound message.** A
  caller-supplied UUID, doubling as LINE's own retry key, so a dropped response
  and a browser retry neither double-send nor double-record, and a second staff
  message minutes later is simply a second message, not a collision.
- **Records only what LINE accepted.** A push that fails or times out leaves no
  row — a retry with the same key tries again cleanly.
- **Answers no `replyToken`, races nothing.** [BR-011](../../../PRD-SDD-v1.0.md)
  gives the *automatic* reply to exactly one owner, the edge runtime, because two
  owners would race the same expiring token. Push carries no token to race, so
  this second writer is not the second owner that rule exists to prevent — it is
  a different kind of write BR-011 was never written about.

## What changed on the page FR-091 built

FR-091 Decision 2 said, absolutely, "the inbox cannot reply... the module
therefore exports no writer at all." That absolute claim no longer holds — see
the reopening note in [FR-091](FR-091-conversation-inbox.md). What it was
protecting still holds exactly as written: the automatic reply still has one
owner, and this page still makes no status transition and no read-receipt.

The Inbox thread gains one composer, visible only to a Business OWNER, and one
sentence next to it: replies typed directly in LINE Official Account Manager are
not recorded here. That sentence is not a caveat to be fixed later — it is a
boundary this requirement does not attempt to cross. Only what already flows
through `zuri-ai`, automatically or from this composer, becomes part of the
record the archive can later hold.

## What is deliberately not here

- **Rich content.** Text only, matching the Push message shape this writer
  sends; no images, stickers or quick replies.
- **Editing or unsending a staff reply.** Once accepted by LINE it is delivered;
  there is no recall path on the console side, matching how a stack reply is
  final too.
- **A second RBAC role for "CRM write access."** No narrower role exists yet, so
  this uses the same per-Business OWNER gate FR-103's consent and FR-022's
  erasure already use on this exact page. A `LINE_OA_PUBLISHER`-shaped role for
  CRM, if one is ever needed, is a separate decision.
