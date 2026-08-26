---
domain: crm
feature: FR-103
module: crm
source: v2-native
version: "0.1.0b"
created_at: "2026-08-26T00:00:00+07:00,Claude Fable 5"
last_update: "2026-08-26T00:00:00+07:00,Claude Fable 5"
status: "beta"
---

# FR-103 — SEC-005 PDPA consent attestation (MVP scope)

## Why this exists

SEC-005 was raised to P0 of `PHASE-V2-REPLACE` on 2026-08-12
([PRD-SDD-v1.0.md](../../../PRD-SDD-v1.0.md) version history 1.0.3): LINE-first
means customer messages — PII — enter the system from the first turn, and
nothing recorded whether a business had told its customer that. This closes
[ethics-governance.md](../../agent/ethics-governance.md)'s open question #4
("consent: what is the user told, when, and how is it recorded per
business?") at MVP scope, and only that question.

## Decision 1 — on `Customer`, not a new `CustomerBusinessProfile` table

SEC-005's own registry text named `CustomerBusinessProfile` — a table that has
never existed in this schema. Building it would mean a `(Customer, Business)`
join keyed for genuine cross-business sharing, where one Person could carry a
different consent record per Business relationship.

The FR-023 docstring on `Customer` already settles what that table would be
for:

> businesses in one tenant share the customer (the CRM-sharing decision)

`Customer` **is** the CRM-sharing unit BR-001 describes — one row, visible to
every Business in its Tenant through `getConversationInbox`'s tenant-wide
scope. A second table keyed by `(Customer, Business)` would duplicate a scope
this row already carries, for a capability (a *different* consent answer per
Business) nothing has asked for yet. `consentStatus` lives directly on
`Customer`.

## Decision 2 — owner attestation, not an automated LINE opt-in flow

Question #4 asks two things at once: what the customer is told, and how it's
recorded. This closes only the second half.

`recordCustomerConsent` is a Business **owner** asserting "we have this
customer's consent, captured some other way" — a signed form, a verbal
agreement, an existing privacy policy the business already runs under. It is
not a customer-facing flow: no LINE message is sent, no opt-in state machine
exists, and there is no evidence baked in that the business actually asked.

That is a real product gap, not an oversight. Designing an automated LINE
consent flow means deciding what it says, when it fires (first message?
first AI-processed message? never, if a business already has consent under
existing terms?), and how a customer revokes it — none of which this change
had standing to invent. `CONSENT_LABEL`'s copy in the UI says "ยืนยันว่าลูกค้า
ยินยอมแล้ว" (confirm the customer has consented) rather than "ขอความยินยอม"
(ask for consent) on purpose: the control is honest about being an
attestation, not a request.

## Decision 3 — a record, not yet a gate

Nothing in `turn.js` / `assembleAgentContext` branches on `consentStatus`.
Recording status and building enforcement are two different pieces of work,
and conflating them here would mean answering questions #1–#3
(redaction, provider terms, retention) under time pressure to ship *this*
change, rather than answering them because they were actually settled.

The value shipped now: a PDPA request today — "prove you had consent for this
customer" — is answerable truthfully, which is exactly what
ethics-governance.md's standing rules ask for. The value not yet shipped:
refusing to process a customer whose consent is `PENDING` or `DECLINED`. That
follow-up needs its own FR once #1–#3 are decided, because *what* gets gated
(the raw message? a redacted extraction? nothing, if the business's own terms
already cover it?) depends on those answers.

## Decision 4 — backfill to `GRANDFATHERED`, never `PENDING`

Every `Customer` row already in the database predates this column and was
already being served. Backfilling them to `PENDING` — the same value a brand
new, never-attested Customer gets — would make "not yet attested" and
"created before this feature existed" indistinguishable, and would be the
correct-looking setup for a *future* gate to retroactively cut off a live
conversation the day someone flips it on. `GRANDFATHERED` is a distinct,
permanent value: it is never written by `customer-consent-service`, only by
the one-time migration backfill, so it can never be produced by anything an
owner does in the UI.

## What is deliberately not here

- **A customer-facing consent flow.** See Decision 2. `CONSENT_LABEL`'s "ลูกค้าเก่า
  (ก่อนมีระบบนี้)" for `GRANDFATHERED` is the only customer-facing-adjacent copy,
  and it renders to staff in the console, never to the customer.
- **Any enforcement.** See Decision 3.
- **A `note` field in the UI.** The service accepts an optional `note` (max
  1000 chars) for exactly this reason — a future UI can ask "where was this
  consent captured?" without a schema change — but the first console pass
  ships two buttons, not a form, to keep the P0 slice small.
- **Revocation.** `DECLINED` records that a customer said no; there is no flow
  yet for a `GRANTED` customer to withdraw consent later. That is closer to
  question #6 (erasure) than to #4.
