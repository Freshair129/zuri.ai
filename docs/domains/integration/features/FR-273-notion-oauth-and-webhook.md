---
id: ZAI:FR-273-NOTE
title: "Notion OAuth installation and webhook ingress"
domain: integration
feature: FR-273
module: integration
source: v2-native
version: "0.1.2b"
status: candidate
created_at: "2026-09-26T00:00:00+07:00,Codex GPT-6"
last_update: "2026-09-26T00:00:00+07:00,Codex GPT-6"
relations:
  - type: references
    target: ZAI:FR-273
  - type: relates_to
    target: ZAI:FR-274
  - type: relates_to
    target: ZAI:ADR-109
---

# FR-273 — Notion OAuth installation and webhook ingress

## Behavior and ownership

The Integration lane owns the Notion public-connection OAuth flow, Business-scoped
connection metadata, opaque token reference and public webhook receiver. OAuth is
started by an authenticated Business OWNER at AAL2. The callback is bound to the
same actor and scope by one-time state. A successful code exchange stores the
Notion access/refresh token through the existing typed secret-store lifecycle and
redirects to the Integration page without returning credential material.

Notion webhook events are authenticated against the raw body before parsing. The
initial verification token is app-level, encrypted at rest and available once to
an installation operator at AAL2 so the administrator can complete Notion's verification
screen. Accepted event receipts contain only identifying metadata needed for
idempotency and operations; the webhook does not persist page or comment content.

## Input, output and failures

- OAuth connect input: trusted `businessId`; callback input: provider `code` and
  opaque `state`, or a provider denial.
- OAuth output: redirect to Notion during authorization, then a safe success or
  error redirect to the Integration page. Tokens remain in the server vault.
- Webhook input: a bounded Notion verification challenge or a bounded event body
  with `X-Notion-Signature`.
- Webhook output: success acknowledgment after encrypted challenge capture or
  valid idempotent receipt; unauthenticated, malformed or oversized input fails
  closed.
- A failed token exchange consumes the OAuth state and requires a new connect
  attempt. The raw code and provider response are not logged.

## Acceptance criteria

1. A non-owner, stale AAL2 proof, foreign Business, expired state, replayed state
   or mismatched callback actor cannot create a Notion connection.
2. Token exchange uses the fixed Notion token endpoint, Basic authentication,
   configured redirect URI, `grant_type=authorization_code` and the pinned
   `Notion-Version` header.
3. Access/refresh tokens are stored only as `NOTION_OAUTH_TOKEN` secret material;
   metadata and callback responses contain no token bytes.
4. The first webhook challenge is encrypted, never logged, and can be revealed
   once only to an installation operator at AAL2. A retry of the same challenge
   is idempotently acknowledged; a different challenge cannot replace it without
   an audited AAL2 reset by that operator.
5. Every event is verified over the original raw body before JSON parsing. Bad or
   absent signatures do not create receipts.
6. A valid event creates at most one receipt keyed by event ID; stored columns
   contain no raw payload or page/comment content.
7. Schema migrations and generated governance outputs are written but are not
   applied to a production database by this change.
8. OAuth state is not exported; minimal webhook receipts are exported for
   idempotency; encrypted webhook verification material is excluded, so a restored
   installation must reverify its Notion webhook subscription.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-26 | approved-design | Scope the Notion OAuth and receipt-only webhook feature under ADR-109 | uncommitted | Codex GPT-6 |
| 0.1.1b | 2026-09-26 | approved-design | Match installation-operator authority and recovery behavior to existing secret backup policy | uncommitted | Codex GPT-6 |
| 0.1.2b | 2026-09-26 | approved-design | Specify idempotent retry of the pinned webhook challenge and preserve LINE rate-limit scope | uncommitted | Codex GPT-6 |
