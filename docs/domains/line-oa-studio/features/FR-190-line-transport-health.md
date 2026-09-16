---
id: ZAI:FR-190-LINE-TRANSPORT-HEALTH
title: LINE transport reachability — silence and endpoint drift
feature: FR-190
parent_requirement: FR-190
domain: line-oa-studio
source: v2-native
version: "0.1.0b"
status: draft
created_at: "2026-09-12T12:40:00+07:00,CLAUDE,base c00997a4"
last_update: "2026-09-12T12:40:00+07:00,CLAUDE"
relations:
  - type: relates_to
    target: ZAI:ADR-061
  - type: references
    target: ZAI:FR-149
  - type: references
    target: ZAI:FR-146
  - type: references
    target: ZAI:FR-142
---

# LINE transport reachability

## Why this exists

Two production failures in two days were invisible to every signal the system had.

1. **2026-09-11.** A redeploy dropped the ADR-061 compose overlay, so `web` answered 503 to
   every LINE delivery and every edge job claim for about eleven hours. `/api/health` stayed
   green the whole time: it checks the database, not the transport.
2. **2026-09-12.** After that fix nothing arrived for another 21 hours, because the provider
   console webhook URL had been pointed at a different application on the same machine. That
   application validates the signature, so LINE received 200 and the console Verify button
   reported success.

Both were found by a person reading the ngrok inspector by hand. Neither would have been found
by waiting. The system cannot currently tell "no customers wrote" from "LINE is delivering
somewhere else", and that is the gap this requirement closes.

## What it computes

Per `LineOaAccount` where `serverEnabled` is true:

| signal | source | states |
|---|---|---|
| inbound silence | age of the newest inbound delivery already recorded (Integration evidence, `LineConversationJob`) | OK, QUIET, SILENT |
| endpoint agreement | the webhook endpoint LINE reports for the channel, compared with this deployment own route for that account | MATCHED, MISMATCHED, DISABLED, UNKNOWN |

Silence alone is ambiguous — a quiet shop is not a broken one — which is exactly why the second
signal matters: MISMATCHED or DISABLED turns "quiet" into "misrouted" without guessing.

## Contract

`GET /api/line-oa/accounts/{id}/transport-health` returns states, timestamps and durations
only. Channel credentials never appear, and neither does the content of whatever other endpoint
LINE is configured with — only that it differs from ours. The LINE OA console shows the state
beside the account. The existing server worker tick logs one structured warning per account
while a state is not OK, so the condition is greppable without a new process.

## Deliberately not in this requirement

- No push channel (email, LINE, webhook out). The log line and the console state are the
  surface; a notification transport is a separate decision.
- No automatic repair. The server never rewrites the provider configuration: an endpoint that
  disagrees is reported, never corrected, because taking a channel back is an owner action.
- No new model, column or migration. Every input already exists.

## Open questions for the owner

- Default thresholds. A first proposal: QUIET after 6 hours of silence during business hours,
  SILENT after 24. Both should be per-Business configurable.
- Whether MISMATCHED should be checked on a schedule (each worker tick is wasteful; LINE
  rate-limits) or only on demand plus once per hour.
- Whether an account that is deliberately paused should report OK or be excluded.
