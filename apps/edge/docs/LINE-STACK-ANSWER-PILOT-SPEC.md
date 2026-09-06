---
version: "0.3.0b"
created_at: "2026-08-14T02:18:06+07:00,ATHER"
last_update: "2026-09-06T11:51:02+07:00,RWANG"
status: "beta"
superseded_by: null
attributes:
  domain: "line-ai"
  scope: "FR-050 Phase 1 transport"
---

# LINE stack-answer pilot

> Current transport decision: [Server-owned LINE and optional Edge](SERVER-LINE-OPTIONAL-EDGE.md)
> implements upstream ADR-061. New runtimes are compute-only; the transport behavior below
> applies only to explicitly selected `LEGACY_EDGE` installations during migration.

## Candidate central monorepo and execution contract

The owner requested complete migration documentation on 2026-09-06. In the central Freshair129/zuri.ai documentation branch, ZAI:ADR-062 proposes apps/edge in the monorepo with a separately installed/released runtime; ZAI:ADR-061 and ZAI:FR-148-P4 define the optional executor behavior. These qualified citations refer to the central repository, not this repository's local ADR/FR registry. They do not grant production activation or retire this runtime's existing reply-owner rule.

Target: Edge claims compatible jobs over outbound HTTPS, executes only allowed local capabilities, and returns bounded evidence/results under a current Business-scoped lease. Server owns migrated-account LINE credentials, send intents and provider calls. Edge receives no LINE reply token or Server database access; local-only jobs never silently use cloud inference. Device upgrade compatibility is checked against released protocol ranges, not assumed from a common checkout.

Migration first preserves current behavior while moving source; transport cutover follows separately per account. Existing Stack/local sending paths below remain legacy until the central cutover gate pauses/fences them. Do not remove current device configuration, copy .env/customer files into Git, delete the old repo/workspace, or reinstall device data merely because the source is moving. Root global documentation becomes authoritative after reviewed ID/path mapping; old local requirement IDs keep repository-qualified provenance.


## Approved behavior

When `ZURI_STACK_REPLY_ENABLED=true`, the signed direct-message webhook delegates answer policy to
Zuri V2 and remains the sole LINE Reply API owner. It never runs the legacy local answer path for
the same event.

The transport verifies `x-line-signature`, filters durable duplicates, derives `destination` only
from the verified LINE envelope, and forwards fresh events with a server-configured binding UUID
and bearer. It never sends or selects Tenant/Business scope and never forwards `replyToken`.

```json
{
  "bindingId": "<server-configured UUID>",
  "destination": "<signature-verified LINE destination>",
  "events": []
}
```

Authorization is `Bearer <binding bearer>`. Message content, aliases and caller-supplied identifiers
are never authorization evidence.

## Configuration

```text
ZURI_STACK_REPLY_ENABLED=false
ZURI_STACK_URL=
ZURI_STACK_BINDING_ID=
ZURI_STACK_BINDING_BEARER=
ZURI_STACK_TIMEOUT_MS=15000
```

Legacy `ZURI_TENANT_ID`, `ZURI_BUSINESS_ID`, and `ZURI_STACK_TOKEN` are invalid in reply mode.
Observe-only compatibility cannot authorize a Phase 1 answer.

## Activation gates

1. The dedicated runtime database login passes positive, cross-scope and read-only probes.
2. One approved model provider credential passes a bounded health call.
3. Wrong binding UUID, bearer and destination fail before persistence/model/reply work.
4. The binding changes from `PENDING` to `ACTIVE` only for the positive canary window.
5. One signed direct-message canary produces one grounded answer and one LINE receipt.
6. A failed gate restores `PENDING` and both reply/agent kill switches to false.

## Failure and rollback

- Invalid signature returns `401` before stack/reply work.
- A duplicate returns `200` without another stack/model/reply call.
- A missing destination or rejected binding spends no LINE reply token.
- Rollback is `ZURI_STACK_REPLY_ENABLED=false`; LINE credentials do not change.

## CHANGELOG

| Version | Date | Status | Summary | Agent |
|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | beta | Owner-approved FR-050 single-reply transport | ATHER |
| 0.2.0b | 2026-08-14 | beta | Binding-only transport implemented and activation kept gated | ATHER |

Version diff 0.2.0b → 0.3.0b (2026-09-06, RWANG): documented central monorepo candidate and optional executor target; runtime behavior unchanged.
