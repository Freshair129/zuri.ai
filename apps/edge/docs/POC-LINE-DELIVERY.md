---
id: "ZURI-POC-LINE-DELIVERY"
version: "0.2.1b"
status: "beta"
owner: "zuri-command-agent"
scope: "local demonstration only"
created_at: "2026-08-11T00:00:00+07:00, ATHER"
last_update: "2026-09-03T04:10:00+07:00, ATHER"
---

# Local LINE delivery POC

## Purpose and boundary

`poc` is a local demonstration path for showing Zuri's approved **information-request** Flex
card in a single pre-configured LINE group while the canonical Zuri Command API is still a
candidate contract. It is deliberately separate from the governed production path.

It does not make the local agent a tenant authority, does not claim that Zuri policy/outbox exists,
and must not be used for KPI, customer, pricing, approval, or transcript-derived cards.

## Local setup

The ignored `.env` contains only local configuration:

```dotenv
ZURI_COMMAND_TRANSPORT=line-poc
LINE_POC_ENABLED=true
LINE_POC_CHANNEL_ACCESS_TOKEN=<freshly-rotated-token>
LINE_POC_GROUP_LEADERSHIP=<verified-LINE-group-id>
```

`LINE_POC_GROUP_LEADERSHIP` is a local binding for the alias `leadership`. The CLI accepts only
the alias and rejects raw group IDs. `poc verify --group leadership` first calls LINE Bot Info;
a subsequent successful push proves only that LINE accepted this OA's request for that configured
target. It is not a server-verified Zuri tenant/OA binding and it is not recipient delivery proof.

## Commands

```powershell
npm run build
node dist/cli/index.js config check
node dist/cli/index.js poc verify --group leadership
node dist/cli/index.js poc send information-request --group leadership
```

The final command emits `ACCEPTED_BY_LINE` only after the LINE Messaging API returns 2xx. It never
emits `DELIVERED`, because the push API does not provide a group read receipt.

## Measured: the ack-and-push path, end to end (2026-09-03)

The promotion gate below asks for "governed outbox with idempotency and retry". This is what that
path actually did when driven with a signed webhook event, an approved identity, and Codex
answering against the real catalog.

**Why the queue exists at all.** Answering took ~60s. A LINE reply token expires at about 30. There
is no configuration that makes those numbers agree, so the webhook cannot hold the connection open
and answer inside it — it acknowledges, and something else delivers later.

| Step | Observed |
|---|---|
| Signed webhook accepted | **HTTP 200 in 32 ms** |
| Enqueued | `PENDING`, attempts 0 |
| Worker claimed it | `DISPATCHING`, attempts 1 |
| Answer generated (Codex → MCP → rag-service) | ~60 s |
| Push to LINE | `401` — the token was deliberately invalid |
| Retry | 1 → 2 → 3, then `QUARANTINED` with `lastError` kept |

32 ms is the number that matters: LINE gets its 200 immediately and never waits on the model.

### What this run proves, and what it does not

Proven: fast acknowledgement, enqueue, claim, answer generation, bounded retry, and quarantine with
the failure preserved rather than discarded. Also proven is the redaction: the worker's own
diagnostics carry `sha256:2e61d71dd0e[REDACTED]…` and `recipientRedacted: true`, so neither a LINE
user id nor customer text reaches a log line.

**Not proven by that run: delivery.** The push used an invalid token on purpose, so LINE rejected it
at authentication. Everything up to that boundary was exercised; the final hop needed a real
`LINE_POC_CHANNEL_ACCESS_TOKEN`.

### Delivery, proven separately (same day, real token, real group)

With the real credentials the transport was verified in three steps, smallest blast radius first:

| Step | Result |
|---|---|
| `poc verify --group leadership` — reads Bot Info, sends nothing | OA `Zuri` (`@949xcfau`) |
| `poc send information-request --group leadership --dry-run` | the exact Flex payload, still nothing sent |
| `poc send information-request --group leadership` | **`ACCEPTED_BY_LINE`**, requestId `eb4254b0-6b7b-4f89-838c-3bc07c88bd8a` |

The alias was temporarily repointed at `LINE_TEST_GROUP_ID` for the send and restored afterwards, so
the message landed in the test group rather than the leadership one. Both are real groups with real
people in them; a card that reads like a business report is worth aiming at the harmless one.

**What this closes, and what it does not.** It closes "does LINE accept a push from this OA with
this token" — the one step the invalid-token run could not reach. It does **not** close the outbox's
own delivery hop: that pushes to a *user id* taken from the webhook event, and the send above went
to a group through `poc send`. The two share the same LINE client and the same token, so the
transport is proven; the outbox's last hop is inferred from that rather than observed. Finishing it
needs a real user who has messaged the OA, and messaging a person is not something to do for a test.

And it remains, per the boundary at the top of this document, a *push acknowledgement* — LINE
accepted the request. It is not a recipient delivery receipt, and no amount of a valid token makes
it one.

### Prerequisites, in the order the server enforces them

Each is refused separately, one message at a time, so they are easy to hit one at a time:

1. `LINE_WEBHOOK_ENABLED=true` + `LINE_CHANNEL_SECRET` + `LINE_HISTORY_HASH_KEY`
2. At least one `LINE_HISTORY_GROUP_<ALIAS>=true` — with none, the server exits rather than starts
3. `LINE_DM_POC_ENABLED=true`, which additionally requires `LINE_POC_ENABLED=true` and a channel
   access token: the direct-message path calls LINE to acknowledge and to push, so it will not start
   without one
4. `ZURI_OUTBOX_ENABLED=true` — `config check` refuses headless + webhook without it, for the
   30s-vs-60s reason above

A first-time sender is not answered. The webhook records them as `pending`
(`identity list`), replies "not registered", and stays that way until
`identity approve --hash <h> --role sales --email <address>`. A profile lookup that returns nothing
still registers the request — the identity simply carries `(ไม่ทราบชื่อ)` as its display name.

## Promotion exit gate

Remove this POC transport from operational use once Zuri implements and approves the canonical
contract: signed webhook-derived group binding; tenant/policy/consent/runtime gates; governed
outbox with idempotency and retry; audit and delivery receipt; registered device credentials; and
the approved template/query promotion record. The agent then uses `ZURI_COMMAND_TRANSPORT=zuri-api`.

### The gate's premise no longer holds — resolved 2026-09-05

**This gate is void.** See `docs/LINE-REPLY-OWNERSHIP-DECISION.md`: BR-003 has been retired and
reply ownership now sits with this runtime by decision, not by exception. The operational content
below still applies; the promotion boundary does not, because there is nothing to be promoted to.

The original finding, kept for the record:

This gate assumes Zuri will eventually own the send. As of zuri-ai `5393f99` it has decided not to.
There is no route in that repository that calls the LINE Messaging API — `grep` for `api.line.me`,
`pushMessage` and `replyMessage` returns only a UI page — and its own rules say so directly:

- `BR-011`: "zuri-cli is the sole LINE reply owner when stack answering is enabled"
- `FR-050`: the cloud returns reply text to "the sole LINE transport owner" *without receiving or
  consuming the LINE replyToken*
- `/api/agent/line-delivery` is `FR-093`, a receipt sink: "the transport owner reports what it
  actually sent". It records; it does not send.

So this repository's `BR-003` ("the agent never receives a LINE channel token") and zuri-ai's
`BR-011` are in direct conflict, and the deployed system implements `BR-011`. Removing the token
from `.env` today does not promote anything — it silences the OA, which keeps receiving messages
and stops answering.

Left as a recorded conflict rather than a documentation fix, because which rule wins is a charter
decision for the owner. The two available resolutions are to retire `BR-003` in favour of an edge
that legitimately owns the send and is hardened accordingly, or to build the send path in zuri-ai
that `BR-003` has always assumed. Until one is chosen, the token stays and lives in an
ACL-protected file, never in `.env`.

## Security rules

- Never commit `.env`, a channel token, raw group ID, or a LINE secret.
- Rotate every token that was pasted into a conversation before it is used again.
- Do not store Google/LINE passwords in `.env`; Google integrations use OAuth and LINE uses a
  channel token.
- POC has one template and an evidence-free snapshot only. It must fail closed for all other
  template names.

## CHANGELOG

| Version | Date | Status | Summary | Agent |
|---|---|---|---|---|
| 0.1.0b | 2026-08-11 | beta | Explicit local LINE POC exception and promotion boundary | ATHER |
| 0.2.0b | 2026-09-03 | beta | Measured the ack-and-push path end to end: 32 ms ack, bounded retry, quarantine; delivery itself still unproven | ATHER |
| 0.2.1b | 2026-09-03 | beta | Delivery proven with a real token: verify -> dry-run -> send, ACCEPTED_BY_LINE to the test group; outbox's own user-id hop still inferred | ATHER |
