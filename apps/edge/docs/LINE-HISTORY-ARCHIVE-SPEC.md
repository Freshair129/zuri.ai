---
id: "ZURI-LINE-HISTORY-ARCHIVE"
version: "0.1.0b"
status: "beta"
owner: "zuri-command-agent"
scope: "local-only conversation archive"
created_at: "2026-08-11T00:00:00+07:00, ATHER"
last_update: "2026-08-11T00:00:00+07:00, ATHER"
---

# LINE conversation archive — local POC

## Decision

Archive **new signed LINE webhook events only** from the approved `leadership` alias. Store full
text messages locally as weekly JSONL files for 30 days. LINE's Messaging API does not expose a
general history-read API, so messages from before webhook activation are out of scope.

## Boundary

- Bind only a webhook event whose raw `source.groupId` matches the existing local `leadership`
  binding and `LINE_HISTORY_GROUP_LEADERSHIP=true`.
- Verify `x-line-signature` against `LINE_CHANNEL_SECRET` before JSON parsing or writing.
- Never write raw group IDs, raw sender IDs, channel credentials, or webhook signatures. Sender
  and message ids are HMAC-SHA256 values using the local `LINE_HISTORY_HASH_KEY`.
- Store text only for `message.type=text`; retain non-text event metadata without fetching media.
- Do not automatically send archive contents to a model. A future retrieval command needs its own
  scope, consent, and data-minimization contract.

## Storage and lifecycle

```text
state/line-history/
  .dedupe.json                       # event-id replay protection, max 30 days
  leadership/2026-W33.jsonl          # one normalized event per line
```

Each archive record has `webhookEventId`, timestamps, group alias, hashed sender/message IDs,
event/message type, and text when applicable. The writer appends only after dedupe succeeds.
On each archive write it deletes only `YYYY-Www.jsonl` files under the resolved history root whose
mtime is older than `LINE_HISTORY_RETENTION_DAYS`; default is 30 days.

## Configuration and operation

```dotenv
LINE_WEBHOOK_ENABLED=true
LINE_CHANNEL_SECRET=<channel-secret>
LINE_HISTORY_HASH_KEY=<locally-generated-secret>
LINE_WEBHOOK_PORT=8787
LINE_HISTORY_ROOT=state/line-history
LINE_HISTORY_RETENTION_DAYS=30
LINE_HISTORY_GROUP_LEADERSHIP=true
```

Start the local listener:

```powershell
node dist/cli/index.js webhook serve
```

It listens only on `127.0.0.1`. A separately operated HTTPS tunnel may forward the verified public
LINE webhook URL to `/webhook/line`; the tunnel is not created or persisted by the agent.

## Acceptance criteria

1. Invalid/missing LINE signatures receive HTTP 401 and create no file.
2. An event for an unbound or disabled group receives HTTP 200 but is ignored and not archived.
3. Repeated `webhookEventId` records exactly once.
4. A text event is appended to its ISO-week `.jsonl` file as UTF-8.
5. Files older than 30 days are pruned only inside the configured archive root.
6. `.env` and `state/` never enter Git.

## CHANGELOG

| Version | Date | Status | Summary | Agent |
|---|---|---|---|---|
| 0.1.0b | 2026-08-11 | beta | Approved local-only 30-day leadership conversation archive | ATHER |
