# AI Ethics & Data Governance (PDPA)

| Field | Value |
|-------|-------|
| **Version** | 1.0.0 |
| **Status** | Draft — blocking for `TASK-V2-LINE-INTENT` |
| **Last Updated** | 2026-08-12 |

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
| 4 | Consent: what is the user told, when, and how is it recorded per business? | open |
| 5 | Cross-business sharing: a customer known to two businesses in one group — consent is **per business**, never inherited from the group | decided (BR-001) |
| 6 | Right to erasure: deleting a customer must also purge derived AI artefacts | open |

## Standing rules

- Redact before sending where possible: phone numbers, addresses and payment
  details are rarely needed for intent extraction.
- Never send another business's data in the same context window — the isolation
  boundary applies to prompts too.
- Log what was sent to the model (or a hash of it) so a PDPA request can be answered
  truthfully.
