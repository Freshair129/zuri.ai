# AI Ethics & Data Governance (PDPA)

| Field | Value |
|-------|-------|
| **Version** | 1.1.0 |
| **Status** | Draft — question #4 closed at MVP scope (FR-103); #1, #2, #3, #6 still block `TASK-V2-LINE-INTENT` |
| **Last Updated** | 2026-08-26 |

## Why this exists now

`SEC-004` in the module PRD says "the MVP holds no customer PII". That is true only
until LINE lands: **customer messages are personal data**. ADR-003 makes LINE the
primary surface, so this document must be settled before the first message is
processed, not after.

`SEC-005` (PDPA consent per business, in `CustomerBusinessProfile`) was written as
"later, CRM phase". It is now P0 of `PHASE-V2-REPLACE`.

## Decisions required

| # | Question | Status |
|---|---|---|
| 1 | What leaves the machine? Full message text, or a redacted extraction? | open |
| 2 | Which provider, and under which data-processing terms? | open |
| 3 | Retention: how long are raw messages kept, and where? | open |
| 4 | Consent: what is the user told, when, and how is it recorded per business? | **decided at MVP scope (FR-103, 2026-08-26)** — see below |
| 5 | Cross-business sharing: a customer known to two businesses in one group — consent is **per business**, never inherited from the group | decided (BR-001) |
| 6 | Right to erasure: deleting a customer must also purge derived AI artefacts | open |

### #4 at MVP scope (FR-103)

What shipped: a Business **owner** attests in the CRM console that a Customer's
PDPA consent was captured — `GRANTED` or `DECLINED`, timestamped, with the
attesting Person recorded (`src/modules/crm/customer-consent-service.js`).
Every Customer created from here on defaults to `PENDING`; rows that predate
this column backfill to `GRANDFATHERED` rather than being retroactively
blocked — see the migration comment for why.

What this deliberately does **not** answer:

- **How the customer themselves is told**, or when — this is owner attestation
  (the business asserts it captured consent some other way — a signed form, a
  verbal agreement, an existing policy), not an automated LINE opt-in flow. That
  is a real product decision (in-flow message vs. a static policy notice vs.
  something else) still to be made, not implemented here on a guess.
- **Whether anything is gated on the result.** `consentStatus` is recorded and
  readable; nothing in the LINE/agent pipeline currently branches on it. Wiring
  a block into `assembleAgentContext`/`turn.js` needs questions #1–#3 answered
  first — you cannot correctly refuse "send to the model" without already
  knowing what "send to the model" means (full text vs. redacted extraction)
  and under what provider terms.
- Questions #1 (redaction), #2 (provider terms) and #3 (retention) remain open
  and now sit directly upstream of turning this from a record into a gate.

## Standing rules

- Redact before sending where possible: phone numbers, addresses and payment
  details are rarely needed for intent extraction.
- Never send another business's data in the same context window — the isolation
  boundary applies to prompts too.
- Log what was sent to the model (or a hash of it) so a PDPA request can be answered
  truthfully.
