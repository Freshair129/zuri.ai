---
domain: crm
feature: FR-091
module: crm
source: v2-native
version: "0.1.0b"
created_at: "2026-08-20T00:00:00+07:00,ATHER"
last_update: "2026-08-20T00:00:00+07:00,ATHER"
status: "beta"
---

# FR-091 — CRM Conversation Inbox

## Why this exists

`Customer`, `Conversation` and `Message` have been in the schema since FR-023,
and the LINE ingest seam has been filling them on every turn. FR-081 then said,
deliberately and in writing, that **no reader surface was in scope**.

The consequence was never argued for, only inherited: a business owner whose
LINE OA is live has no way to see a single message their business received. The
integration is provably correct — `LINE_OA_EXIT_GATE = PASS`, with a cross-repo
round trip behind it — and completely invisible. This slice is only that:
the surface that makes the existing pipeline observable.

## Decision 1 — scope is the Tenant, not the selected Business

The obvious reading of a Business-scoped console is "show conversations where
`businessId` = the open Business". It is wrong twice.

It contradicts **BR-001**, which states that businesses inside one tenant share
CRM; and it would render an empty page in the normal case, because a LINE
binding that carries no business writes `businessId: null` and every one of
those conversations would be filtered away.

So the query is the **Tenant of the selected Business**, narrowed to
conversations whose owner is either nobody (`null` — tenant-shared) or a
Business already in the viewer's `visibleBusinessIds`. That last clause is the
part that matters: tenant-sharing is a CRM rule, not a licence to hand someone
a Business they cannot open. Each row is labelled with its owning Business (or
`ทั้ง tenant`) so the reader is never guessing which one they are looking at.

## Decision 2 — the inbox cannot reply

There is no reply box, and adding one is not a small follow-up.

**BR-011 gives the reply to exactly one owner**, and that owner is the edge
runtime holding the LINE channel credentials and the reply token — which
expires in about thirty seconds. A console reply would be a second reply owner
racing an expired token, which is precisely the failure BR-011 is written to
prevent. When outbound-from-console is wanted it is an *outbound request to the
edge runtime*, not a write from this page, and it gets its own requirement.

The module therefore exports no writer at all. That is enforcement, not
etiquette: a reader that exports only readers cannot quietly grow a write path.

## Decision 3 — the read model exists to keep the query count flat

The list shows, per row, a message count and the last message. Done naively
that is two queries per conversation. `SDD-047` already recorded what this
costs on the Projects Dashboard, and the answer is the same one: group over the
page's conversation ids once, join in memory. The query count does not move
whether the tenant holds three conversations or three thousand.

## What this surface made visible

Opening the page answered a question nobody had asked out loud.

**Nothing anywhere writes an `OUTBOUND` message.** `MESSAGE_DIRECTIONS` has held
both values since FR-023 and `ingestLineMessage` accepts either, but a search
across both `zuri-ai` and the edge runtime finds no caller that passes
`OUTBOUND`. The reply the edge runtime sends to LINE is delivered to the
customer and then forgotten: the webhook returns the text, the runtime sends it,
and no row records that it happened.

So the Dashboard reads `ข้อความที่ตอบออกไป: 0`, and will keep reading zero no
matter how many customers are answered. The inbox shows one side of every
conversation.

That figure stays on the page. Removing it would hide the gap; showing it is how
the gap became visible in the first place. Closing it is a **write** — the reply
would have to be recorded by whoever owns it (BR-011 says that is the edge
runtime, not this console), which is a different requirement with a real design
question inside it: whether the runtime reports its reply back for recording, or
`zuri-ai` records what it handed over at the moment it hands it over, accepting
that a send can still fail afterwards.

## What is deliberately not here

- **Reply / outbound** — Decision 2.
- **`Conversation.status` transitions.** Nothing writes the field in this
  slice, so no enum is declared for it. Declaring `CONVERSATION_STATUSES`
  against values no code writes would put a guess in the one file the repo
  treats as the source of truth.
- **Search and pagination beyond a limit.** The tenant has hundreds of
  conversations, not millions; a limit plus ordering by recency is honest at
  this size, and a search box that scans message bodies is a PII surface that
  deserves its own decision (SEC-005 is still open).
- **Realtime.** The page reads on load. A LINE message arriving while it is
  open needs a refresh — stated on the page rather than implied by a spinner.
