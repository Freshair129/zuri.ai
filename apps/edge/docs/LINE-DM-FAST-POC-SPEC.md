---
id: "ZURI-LINE-DM-FAST-POC"
version: "0.2.0b"
status: "superseded"
owner: "zuri-command-agent"
scope: "one signed private-chat acknowledgement"
created_at: "2026-08-11T06:45:00+07:00, ATHER"
last_update: "2026-08-31T00:00:00+07:00, Claude"
superseded_by: "CONVERSATIONAL-ANSWER-SPEC.md, LINE-STACK-ANSWER-PILOT-SPEC.md"
---

# LINE direct-message fast POC

> **Superseded 2026-08-31.** This spec's own "Explicit exclusions" — no context retrieval, no
> model call, no proactive push — describe a state the runtime has since moved past on purpose:
> `CONVERSATIONAL-ANSWER-SPEC.md` and `LINE-STACK-ANSWER-PILOT-SPEC.md` are the current specs for
> the direct-message answering path, and `AGENTS.md` v0.5.0b's permission matrix now has explicit
> rows for the model, headless-agent, outbox-push, and stack-forwarding capabilities those specs
> introduced. Kept below for its original acceptance criteria and history, not as an active
> boundary.

## Outcome

Prove the end-to-end path for one private LINE conversation: a signed text event reaches the
local agent through an operator-run HTTPS tunnel and receives a fixed acknowledgement through its
event `replyToken`.

## Scope

- Accept only `POST /webhook/line` with a valid `x-line-signature`.
- Process only `type=message`, `source.type=user`, `message.type=text`, and a present reply token.
- Reply once per webhook event during the listener lifetime with fixed Thai copy.
- Return a JSON count of archived group events and direct replies without raw identifiers/text.

## Explicit exclusions

- No user profile, CRM/contact mapping, RBAC, multi-user routing, or raw user-ID storage.
- No durable direct-message history, context retrieval, DuckDB query, model call, tool/action, or
  proactive push message.
- No claim that LINE displayed or the recipient read the acknowledgement; a 2xx means only
  `ACCEPTED_BY_LINE`.

## Configuration

```dotenv
LINE_WEBHOOK_ENABLED=true
LINE_POC_ENABLED=true
LINE_DM_POC_ENABLED=true
LINE_CHANNEL_SECRET=<LINE channel secret>
LINE_POC_CHANNEL_ACCESS_TOKEN=<LINE channel access token>
LINE_WEBHOOK_BIND_HOST=127.0.0.1
```

The values remain local and Git-ignored. `LINE_DM_POC_ENABLED=false` disables all direct replies
without disabling the signed group-archive listener.

## Data boundary

The only recipient value passed to the reply client is the transient `replyToken`. The source user
ID and inbound text are neither persisted nor included in the acknowledgement. The listener holds
webhook event IDs only in memory to prevent replay replies during its lifetime.

## Acceptance criteria

1. Missing or invalid signature returns HTTP 401 before payload handling.
2. A valid direct text event calls the Reply API once and returns HTTP 200 with `replied: 1`.
3. Repeating its `webhookEventId` in the same listener process returns `replyDuplicate: 1` and
   does not call the Reply API again.
4. No `dm-poc` history file or user/message content is written.
5. A failed Reply API call returns HTTP 502 so LINE may retry; the event is not marked handled.
6. The POC is removed from use before a second user, business analysis, or any customer context is
   introduced.

## Operation

Start the listener, keep the Quick Tunnel container running, and set the public URL plus
`/webhook/line` in LINE Developers. Send a new private text message after the webhook is enabled.
For a Docker listener, set `LINE_WEBHOOK_BIND_HOST=0.0.0.0` inside the container and publish its
port only to `127.0.0.1` on the Windows host.

## CHANGELOG

| Version | Date | Status | Summary | Agent |
|---|---|---|---|---|
| 0.1.0b | 2026-08-11 | beta | Approved fixed-acknowledgement direct-message POC | ATHER |
| 0.2.0b | 2026-08-31 | superseded | Superseded by `CONVERSATIONAL-ANSWER-SPEC.md` and `LINE-STACK-ANSWER-PILOT-SPEC.md`, which govern the direct-message path this spec's exclusions no longer describe; per its own governance note, `AGENTS.md` gained the permission-matrix rows this superseding was waiting on | Claude |
